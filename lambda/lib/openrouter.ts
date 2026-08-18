/**
 * OpenRouter Client — LLM chat + embeddings untuk CBT Memory Agent.
 *
 * Menggantikan Amazon Bedrock (keputusan 2026-08-14):
 * - Chat:      meta-llama/llama-3.3-70b-instruct:free (streaming SSE)
 * - Embedding: baai/bge-m3 (1024-dim, verified 2026-08-14)
 *
 * Catatan: snowflake/snowflake-arctic-embed TIDAK ADA di OpenRouter (HTTP 400).
 * baai/bge-m3 = 1024-dim, cocok schema embeddings.embedding vector(1024).
 *
 * API key dari environment: OPENROUTER_API_KEY
 */

const BASE_URL = "https://openrouter.ai/api/v1";

import { logger } from "./logger";
import { context, trace } from "@opentelemetry/api";
import {
  ATTR_GEN_AI_SYSTEM,
  ATTR_GEN_AI_OPERATION_NAME,
} from "@opentelemetry/semantic-conventions/incubating";
import { recordGenAiOperation } from "./telemetry";

export const CHAT_MODEL = "openrouter/free";
export const EMBED_MODEL = "baai/bge-m3";
export const EMBED_DIM = 1024;

/**
 * Kuota model gratis OpenRouter habis (HTTP 429 "free-models-per-day" /
 * HTTP 402 "insufficient credits"). Bukan rate-limit sementara — retry tidak
 * menolong sampai kuota reset (harian) atau credit ditambahkan. Dipakai
 * chatTurn untuk frame SSE llm.quota_exhausted dan health untuk badge jujur.
 */
export class OpenRouterQuotaError extends Error {
  readonly quotaExhausted: boolean;

  constructor(message: string, opts: { quotaExhausted: boolean }) {
    super(message);
    this.name = "OpenRouterQuotaError";
    this.quotaExhausted = opts.quotaExhausted;
  }
}

export function isOpenRouterQuotaError(err: unknown): err is OpenRouterQuotaError {
  return err instanceof OpenRouterQuotaError || (err as { name?: string })?.name === "OpenRouterQuotaError";
}

/** Hasil probe ketersediaan chat + kuota (health badge). */
export interface ChatAvailability {
  available: boolean;
  quotaExhausted: boolean;
}

const FREE_QUOTA_HINTS = [
  "free-models-per-day",
  "free models per day",
  "insufficient credits",
  "add 10 credits",
];

/** Klasifikasi error OpenRouter: kuota habis vs rate-limit sementara vs upstream. */
function classifyChatError(status: number, bodyText: string): Error {
  if (status === 429 || status === 402) {
    const lower = bodyText.toLowerCase();
    if (FREE_QUOTA_HINTS.some((hint) => lower.includes(hint))) {
      return new OpenRouterQuotaError(
        `OpenRouter quota exhausted (HTTP ${status}): ${bodyText.slice(0, 200)}`,
        { quotaExhausted: true },
      );
    }
  }
  return new Error(`OpenRouter chat: HTTP ${status} — ${bodyText.slice(0, 200)}`);
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResult {
  content: string;
  tokensUsed: number;
}

export class OpenRouterClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!this.apiKey) {
      logger.warn("llm.openrouter_missing_key", "OPENROUTER_API_KEY not set — OpenRouter calls will fail");
    }
  }

  /**
   * Generate embedding vector untuk sebuah teks.
   * bge-m3 = 1024-dim (verified 2026-08-14), cocok schema vector(1024).
   * Jika dimensi tidak cocok, lempar error jelas (jangan simpan ke schema).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const trimmed = text.slice(0, 8000);

    const tracer = trace.getTracer("cbt-memory-agent-backend", "0.1.0");
    const parentCtx = context.active();
    const span = tracer.startSpan("llm.embedding", { attributes: {} }, parentCtx);
    const startedAt = Date.now();

    span.setAttribute(ATTR_GEN_AI_SYSTEM, "openrouter");
    span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, "embeddings");
    span.setAttribute("gen_ai.request.model", EMBED_MODEL);
    span.setAttribute("openinference.span.kind", "EMBEDDING");
    span.setAttribute("input.value", trimmed.slice(0, 30_000));

    try {
      const res = await context.with(trace.setSpan(parentCtx, span), async () => {
        const resp = await fetch(`${BASE_URL}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: EMBED_MODEL, input: trimmed }),
        });

        if (!resp.ok) {
          throw new Error(`OpenRouter embeddings ${EMBED_MODEL}: HTTP ${resp.status} ${resp.statusText}`);
        }

        const data = (await resp.json()) as {
          data?: { embedding?: number[] }[];
        };
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || embedding.length === 0) {
          throw new Error(`OpenRouter embeddings ${EMBED_MODEL}: empty result`);
        }
        if (embedding.length !== EMBED_DIM) {
          throw new Error(
            `Embedding dim ${embedding.length} != ${EMBED_DIM} for ${EMBED_MODEL} — check EMBED_MODEL`,
          );
        }
        return embedding;
      });
      return res;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
      recordGenAiOperation("embeddings", Date.now() - startedAt);
    }
  }

  /**
   * Stream chat response dari OpenRouter.
   * Yields chunk teks per delta; resolve `{ content, tokensUsed }` saat selesai.
   */
  async *streamChat(
    messages: ChatMessage[],
    opts: { maxTokens?: number } = {},
  ): AsyncGenerator<string, ChatResult> {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        stream: true,
        max_tokens: opts.maxTokens ?? 1024,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw classifyChatError(res.status, text);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("OpenRouter chat: response body not readable");

    const decoder = new TextDecoder();
    let content = "";
    let tokensUsed = 0;
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") break;

          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
              usage?: { total_tokens?: number };
            };
            const delta = json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              content += delta;
              tokensUsed += Math.max(1, Math.ceil(delta.length / 4));
              yield delta;
            }
            if (json.usage?.total_tokens) tokensUsed = json.usage.total_tokens;
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { content, tokensUsed };
  }

  /**
   * Chat non-streaming — return `{ content, tokensUsed }` lengkap.
   * Dipakai untuk tugas batch (mis. reflection/agentic memory) yang butuh
   * seluruh respons sekaligus, bukan streaming.
   */
  async chat(messages: ChatMessage[], opts: { maxTokens?: number } = {}): Promise<ChatResult> {
    const tracer = trace.getTracer("cbt-memory-agent-backend", "0.1.0");
    const parentCtx = context.active();
    const span = tracer.startSpan("llm.openrouter", { attributes: {} }, parentCtx);
    const startedAt = Date.now();

    span.setAttribute(ATTR_GEN_AI_SYSTEM, "openrouter");
    span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, "chat");
    span.setAttribute("gen_ai.request.model", CHAT_MODEL);
    span.setAttribute("openinference.span.kind", "LLM");
    span.setAttribute("gen_ai.request.input", JSON.stringify(messages).slice(0, 30_000));

    try {
      const res = await context.with(trace.setSpan(parentCtx, span), async () => {
        const resp = await fetch(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: CHAT_MODEL,
            messages,
            stream: false,
            max_tokens: opts.maxTokens ?? 1024,
          }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw classifyChatError(resp.status, text);
        }

        const data = (await resp.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { total_tokens?: number };
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        span.setAttribute("gen_ai.response.text", content.slice(0, 30_000));
        span.setAttribute("gen_ai.usage.total_tokens", data.usage?.total_tokens ?? 0);
        return { content, tokensUsed: data.usage?.total_tokens ?? 0 };
      });
      return res;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
      recordGenAiOperation("chat", Date.now() - startedAt);
    }
  }

  /** Health check — verifikasi API key valid + service reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/credits`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Chat availability (kuota) — badge jujur ──────────────────────────
  // /credits mengembalikan 200 bahkan saat total_credits=0 (bug-3: badge
  // "Backend ok" padahal chat 429 free-models-per-day). Probe chat 1-token
  // memberi sinyal kuota yang sebenarnya. Hasil di-cache agar health poll
  // 60s tidak membakar kuota itu sendiri (1 probe / interval, bukan tiap poll).

  /** Cached probe outcome — module-level, scoped per Lambda container. */
  private availabilityCache: ChatAvailability | null = null;
  private availabilityCheckedAt = 0;

  private static readonly AVAILABILITY_CACHE_MS = 10 * 60 * 1000; // 10 menit

  async checkChatAvailability(): Promise<ChatAvailability> {
    const now = Date.now();
    if (
      this.availabilityCache &&
      now - this.availabilityCheckedAt < OpenRouterClient.AVAILABILITY_CACHE_MS
    ) {
      return this.availabilityCache;
    }

    let result: ChatAvailability;
    try {
      const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
      });
      if (resp.ok) {
        result = { available: true, quotaExhausted: false };
      } else {
        const text = await resp.text().catch(() => "");
        if (isOpenRouterQuotaError(classifyChatError(resp.status, text))) {
          result = { available: false, quotaExhausted: true };
        } else {
          result = { available: false, quotaExhausted: false };
        }
      }
    } catch {
      result = { available: false, quotaExhausted: false };
    }

    this.availabilityCache = result;
    this.availabilityCheckedAt = now;
    return result;
  }
}
