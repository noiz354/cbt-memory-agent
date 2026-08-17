/**
 * LLM Client — unified interface untuk semua provider + fallback chain.
 *
 * Fallback order:
 *   1. On-device (WebLLM) — default, zero-cloud, gratis
 *   2. Backend proxy — jika device low-end atau on-device gagal
 *   3. BYOK (user's API key) — jika user setup key sendiri
 *
 * Semua provider bicara via HTTP fetch. Tidak ada SDK eksternal.
 * Request/response di-normalisasi ke interface yang sama.
 */

import type { LLMProviderId } from "@/shared/lib/llmRegistry";
import { getProvider, getModel } from "@/shared/lib/llmRegistry";
import { getApiKey } from "@/shared/lib/byokKeyManager";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { notifyUnauthorized, RateLimitError, parseRetryAfterMs, isRateLimitError } from "@/shared/lib/apiClient";
import { generateOnDevice } from "@/shared/lib/onDeviceLLM";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  providerId: LLMProviderId;
  modelId: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /**
   * Raw user utterance sent as `userMessage` to the backend-proxy `/chat/turn`.
   * Defaults to the joined user-message content; chatStore passes the real user
   * text here so backend memory-recall runs against the actual message instead of
   * the wrapped CBT prompt (which would crash plainto_tsquery).
   */
  backendUserText?: string;
}

export interface LLMResponse {
  content: string;
  providerId: LLMProviderId;
  modelId: string;
  tokensUsed?: number;
  latencyMs: number;
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  /** Memory IDs the backend injected into this turn (from the final SSE event). */
  injectedMemoryIds?: string[];
  /** Titles of the memories the backend recalled for this turn (final SSE event). */
  recalledTitles?: string[];
}

export type LLMStreamCallback = (chunk: LLMStreamChunk) => void;

/** True when a fetch/stream was cancelled via AbortSignal (not a real failure). */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException
      ? err.name === "AbortError"
      : (err as { name?: string } | null)?.name === "AbortError"
  );
}

// ─────────────────────────────────────────────
// CBT System Prompt
// ─────────────────────────────────────────────

const CBT_SYSTEM_PROMPT = `You are a CBT (Cognitive Behavioral Therapy) assistant running in a zero-cloud, on-device-first application. 

Guidelines:
- Use evidence-based CBT techniques: cognitive restructuring, behavioral activation, thought records.
- Identify cognitive distortions: catastrophizing, all-or-nothing thinking, mind reading, emotional reasoning, should statements.
- Help users reframe automatic thoughts with evidence-based alternatives.
- Be warm, non-judgmental, and collaborative.
- NEVER claim to be a therapist or provide medical advice.
- If user expresses suicidal intent or self-harm language, IMMEDIATELY respond with crisis guidance and direct them to emergency resources (988 Suicide & Crisis Lifeline, or 119 in Indonesia).
- Keep responses concise (200-400 words).
- Use Markdown formatting. KaTeX is supported for formulas.
- This app processes everything on-device. No data is uploaded unless the user explicitly exports it.`;

// ─────────────────────────────────────────────
// Unified LLM client
// ─────────────────────────────────────────────

/**
 * Call LLM dengan fallback chain: on-device → backend → BYOK.
 *
 * @param request LLM request (providerId/modelId optional — akan diisi default)
 * @param onStream Optional streaming callback
 * @param signal Optional AbortSignal — membatalkan request/stream yang sedang berjalan
 * @returns LLMResponse
 */
export async function callLLM(
  request: Partial<LLMRequest> & { messages: LLMMessage[] },
  onStream?: LLMStreamCallback,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  const started = Date.now();

  // Resolve provider + model
  const providerId = request.providerId ?? "local-webllm";
  const provider = getProvider(providerId);
  const modelId = request.modelId ?? provider.defaultModel;
  const model = getModel(providerId, modelId);

  if (!model) {
    throw new Error(`Model ${modelId} not found for provider ${providerId}`);
  }

  // Build full request
  const fullRequest: LLMRequest = {
    providerId,
    modelId,
    messages: [{ role: "system", content: CBT_SYSTEM_PROMPT }, ...request.messages],
    temperature: request.temperature ?? 0.7,
    maxTokens: request.maxTokens ?? 2048,
    stream: request.stream ?? (onStream !== undefined),
    backendUserText: request.backendUserText,
  };

  // Route by provider type
  if (providerId === "local-webllm") {
    return callOnDeviceLLM(fullRequest, onStream, started, signal);
  }

  if (providerId === "backend-proxy") {
    return callBackendProxy(fullRequest, onStream, started, signal);
  }

  // BYOK: ambil key dari IndexedDB → call provider API
  return callBYOK(fullRequest, onStream, started, signal);
}

/**
 * Call dengan fallback chain otomatis.
 * Coba on-device dulu, kalau gagal → backend, kalau gagal → BYOK.
 *
 * Abort (signal) di-prop secara eksplisit: pembatalan pengguna TIDAK memicu
 * fallback ke provider berikutnya — request yang di-cancel berhenti di situ.
 */
export async function callLLMWithFallback(
  messages: LLMMessage[],
  onStream?: LLMStreamCallback,
  signal?: AbortSignal,
  options?: { backendUserText?: string },
): Promise<LLMResponse> {
  // 1. Coba on-device (WebLLM)
  try {
    return await callLLM({ providerId: "local-webllm", messages }, onStream, signal);
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.warn("[LLM] On-device failed, trying backend:", err);
  }

  // 2. Coba backend proxy
  try {
    return await callLLM({ providerId: "backend-proxy", messages, ...options }, onStream, signal);
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.warn("[LLM] Backend failed, trying BYOK:", err);
  }

  // 3. Coba BYOK (default model dari OpenRouter)
  try {
    return await callLLM({ providerId: "openrouter", messages }, onStream, signal);
  } catch (err) {
    if (isAbortError(err)) throw err;
    // 429 harus muncul apa adanya (rate limit), bukan dibungkus generik —
    // chatStore menampilkan pesan rate-limit yang bermakna.
    if (isRateLimitError(err)) throw err;
    throw new Error(`All LLM fallbacks failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─────────────────────────────────────────────
// On-device (WebLLM placeholder)
// ─────────────────────────────────────────────

async function callOnDeviceLLM(
  request: LLMRequest,
  onStream: LLMStreamCallback | undefined,
  started: number,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  try {
    const result = await generateOnDevice(request.messages, (delta) => {
      // WebLLM tidak punya API cancel langsung — periksa signal tiap delta.
      if (signal?.aborted) return;
      onStream?.({ delta, done: false });
    });
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    onStream?.({ delta: "", done: true });
    return {
      content: result.content,
      providerId: "local-webllm",
      modelId: request.modelId,
      tokensUsed: result.tokensUsed,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    // Fail-closed: any on-device failure (unsupported browser, missing WebGPU,
    // model load error) throws so the fallback chain (backend-proxy → BYOK)
    // actually runs. Never return a placeholder.
    if (isAbortError(err)) throw err;
    throw new Error(
      `On-device LLM unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─────────────────────────────────────────────
// Backend proxy
// ─────────────────────────────────────────────

async function callBackendProxy(
  request: LLMRequest,
  onStream: LLMStreamCallback | undefined,
  started: number,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  const provider = getProvider("backend-proxy");
  const url = `${provider.baseUrl}${provider.apiPath}`;

  const auth = getAuthHeaders();
  if (!auth) {
    throw new Error("Not authenticated — backend proxy requires an active session");
  }

  // Backend (Lambda Function URL) berbicara SSE `data: {"t":"..."}` pada
  // POST /api/v1/chat/turn, bukan OpenAI-format /chat/completions.
  const body = {
    v: 1,
    sessionId: `proxy_${Date.now()}`,
    userMessage:
      request.backendUserText ??
      request.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n"),
    memoryIds: [],
    clientTs: new Date().toISOString(),
    deviceOnly: true,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      "X-Device-Id": auth.deviceId,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      throw new RateLimitError(
        `Backend rate limit reached (429). Please wait and try again.`,
        retryAfterMs,
      );
    }
    throw new Error(`Backend proxy returned ${response.status}: ${response.statusText}`);
  }

  return parseBackendProxySSE(response, onStream, started, signal);
}

async function parseBackendProxySSE(
  response: Response,
  onStream: LLMStreamCallback | undefined,
  started: number,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  if (onStream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";

    try {
      while (true) {
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "data: [DONE]") {
            onStream({ delta: "", done: true });
            return {
              content: fullContent,
              providerId: "backend-proxy",
              modelId: "gpt-4o-mini",
              latencyMs: Date.now() - started,
            };
          }
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(trimmed.slice(6));
            // Structured backend error frames ({error:true}) are NOT content —
            // fail the turn so the LLM fallback chain (backend → BYOK) advances
            // and chatStore renders the correct error message. Never stream the
            // backend's generic text as a fake assistant reply.
            if (json?.error === true) {
              const err = new Error(
                typeof json.message === "string" && json.message
                  ? json.message
                  : "Backend proxy returned an error",
              );
              err.name = "BackendErrorFrame";
              throw err;
            }
            const delta = json.t ?? "";
            // Final event: {"t":"","injectedMemoryIds":[...],"recalledTitles":[...]} —
            // backend recall evidence.
            if (Array.isArray(json.injectedMemoryIds)) {
              onStream({
                delta: "",
                done: false,
                injectedMemoryIds: json.injectedMemoryIds as string[],
                recalledTitles: Array.isArray(json.recalledTitles)
                  ? (json.recalledTitles as string[])
                  : undefined,
              });
            }
            if (delta) {
              fullContent += delta;
              onStream({ delta, done: false });
            }
          } catch (err) {
            // Structured backend error frames must propagate (they fail the
            // turn); malformed SSE lines are still skipped.
            if (err instanceof Error && err.name === "BackendErrorFrame") throw err;
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    onStream({ delta: "", done: true });
    return {
      content: fullContent,
      providerId: "backend-proxy",
      modelId: "gpt-4o-mini",
      latencyMs: Date.now() - started,
    };
  }

  const text = await response.text();
  return {
    content: text,
    providerId: "backend-proxy",
    modelId: "gpt-4o-mini",
    latencyMs: Date.now() - started,
  };
}

// ─────────────────────────────────────────────
// BYOK (User's API Key)
// ─────────────────────────────────────────────

async function callBYOK(
  request: LLMRequest,
  onStream: LLMStreamCallback | undefined,
  started: number,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  const apiKey = await getApiKey(request.providerId, request.modelId);
  if (!apiKey) {
    throw new Error(`No API key configured for ${request.providerId}/${request.modelId}`);
  }

  const provider = getProvider(request.providerId);
  let url = `${provider.baseUrl}${provider.apiPath}`;

  // Special handling untuk Google (API key di URL, bukan header)
  if (request.providerId === "google") {
    url = url.replace("{model}", request.modelId) + `?key=${apiKey}`;
  }

  // Build headers
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.authHeader) {
    headers[provider.authHeader] = `${provider.authPrefix || ""}${apiKey}`;
  }

  // Build body (Anthropic pakai format beda)
  let body: Record<string, unknown>;
  if (request.providerId === "anthropic") {
    const lastUserMessage = request.messages.filter((m) => m.role === "user").pop();
    body = {
      model: request.modelId,
      max_tokens: request.maxTokens,
      system: CBT_SYSTEM_PROMPT,
      messages: lastUserMessage ? [{ role: "user", content: lastUserMessage.content }] : [],
    };
  } else {
    body = {
      model: request.modelId,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: request.stream,
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new RateLimitError(
        `${provider.name} rate limit reached (429): ${errorText.slice(0, 120)}`,
        parseRetryAfterMs(response.headers.get("Retry-After")),
      );
    }
    throw new Error(`${provider.name} API returned ${response.status}: ${errorText.slice(0, 200)}`);
  }

  return parseChatResponse(response, request.providerId, request.modelId, onStream, started, signal);
}

// ─────────────────────────────────────────────
// Response parser (unified)
// ─────────────────────────────────────────────

async function parseChatResponse(
  response: Response,
  providerId: LLMProviderId,
  modelId: string,
  onStream: LLMStreamCallback | undefined,
  started: number,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  // Anthropic response format berbeda
  if (providerId === "anthropic") {
    const data = await response.json();
    return {
      content: data.content?.[0]?.text ?? "",
      providerId,
      modelId,
      tokensUsed: data.usage?.output_tokens,
      latencyMs: Date.now() - started,
    };
  }

  // Google Gemini format
  if (providerId === "google") {
    const data = await response.json();
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      providerId,
      modelId,
      tokensUsed: data.usageMetadata?.totalTokenCount,
      latencyMs: Date.now() - started,
    };
  }

  // OpenAI-compatible format (sebagian besar provider)
  if (onStream && response.body) {
    // Streaming response
    return parseStreamingResponse(response, providerId, modelId, onStream, started, signal);
  }

  // Non-streaming response
  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    providerId,
    modelId,
    tokensUsed: data.usage?.completion_tokens ?? data.usage?.total_tokens,
    latencyMs: Date.now() - started,
  };
}

async function parseStreamingResponse(
  response: Response,
  providerId: LLMProviderId,
  modelId: string,
  onStream: LLMStreamCallback,
  started: number,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body not readable for streaming");
  }

  const decoder = new TextDecoder();
  let fullContent = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            fullContent += delta;
            onStream({ delta, done: false });
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onStream({ delta: "", done: true });

  return {
    content: fullContent,
    providerId,
    modelId,
    latencyMs: Date.now() - started,
  };
}
