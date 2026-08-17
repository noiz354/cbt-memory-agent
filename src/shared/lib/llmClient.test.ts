import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const auth = vi.hoisted(() => ({ getAuthHeaders: vi.fn() }));
const byok = vi.hoisted(() => ({ getApiKey: vi.fn() }));
const onDevice = vi.hoisted(() => ({ generateOnDevice: vi.fn() }));

vi.mock("@/shared/lib/authSession", () => ({ getAuthHeaders: auth.getAuthHeaders }));
vi.mock("@/shared/lib/byokKeyManager", () => ({ getApiKey: byok.getApiKey }));
vi.mock("@/shared/lib/onDeviceLLM", () => ({ generateOnDevice: onDevice.generateOnDevice }));

import {
  callLLM,
  callLLMWithFallback,
  isAbortError,
  isQuotaExceededError,
  type LLMStreamChunk,
} from "@/shared/lib/llmClient";

function sseResponse(body: string, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

/** SSE response whose chunks arrive over time, so a mid-stream abort can fire. */
function sseResponseChunked(chunks: string[], chunkDelayMs: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk, i) => {
        setTimeout(() => {
          controller.enqueue(encoder.encode(chunk));
          if (i === chunks.length - 1) controller.close();
        }, chunkDelayMs * (i + 1));
      });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

describe("callLLM backend-proxy SSE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getAuthHeaders.mockReturnValue({ token: "tok-1", deviceId: "dev-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("emits a chunk with injectedMemoryIds from the final SSE event", async () => {
    const sse =
      'data: {"t":"Hello"}\n\n' +
      'data: {"t":" there"}\n\n' +
      'data: {"t":"","injectedMemoryIds":["mem-1","mem-2"]}\n\n' +
      "data: [DONE]\n\n";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sse)));

    const chunks: LLMStreamChunk[] = [];
    const result = await callLLM(
      { providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] },
      (chunk) => chunks.push(chunk),
    );

    expect(result.content).toBe("Hello there");
    expect(result.providerId).toBe("backend-proxy");

    const recall = chunks.find((c) => c.injectedMemoryIds);
    expect(recall).toBeDefined();
    expect(recall!.injectedMemoryIds).toEqual(["mem-1", "mem-2"]);
    expect(chunks[chunks.length - 1].done).toBe(true);
  });

  it("sends backendUserText (raw user message) as userMessage — not the wrapped CBT prompt", async () => {
    const sse = 'data: {"t":"Halo!"}\n\n' + "data: [DONE]\n\n";
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(sse));
    vi.stubGlobal("fetch", fetchMock);

    const wrapped =
      'User message: "halo, apa kabar?"\n\nRespond using CBT techniques: identify the automatic thought.';
    const result = await callLLM(
      {
        providerId: "backend-proxy",
        messages: [{ role: "user", content: wrapped }],
        backendUserText: "halo, apa kabar?",
      },
      () => {},
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/chat/turn");
    const body = JSON.parse(String(init.body));
    expect(body.userMessage).toBe("halo, apa kabar?");
    expect(body.userMessage).not.toBe(wrapped);
    expect(result.content).toBe("Halo!");
  });

  it("does not emit injectedMemoryIds when the event is absent", async () => {
    const sse = 'data: {"t":"ok"}\n\n' + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sse)));

    const chunks: LLMStreamChunk[] = [];
    await callLLM(
      { providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] },
      (chunk) => chunks.push(chunk),
    );

    expect(chunks.every((c) => !c.injectedMemoryIds)).toBe(true);
  });

  it("emits a chunk with recalledTitles from the final SSE event", async () => {
    const sse =
      'data: {"t":"Recalling...","injectedMemoryIds":["mem-1","mem-2"],"recalledTitles":["Cemas sebelum tidur","Makan sehat"]}\n\n' +
      "data: [DONE]\n\n";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sse)));

    const chunks: LLMStreamChunk[] = [];
    await callLLM(
      { providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] },
      (chunk) => chunks.push(chunk),
    );

    const recall = chunks.find((c) => c.recalledTitles);
    expect(recall).toBeDefined();
    expect(recall!.recalledTitles).toEqual(["Cemas sebelum tidur", "Makan sehat"]);
  });

  it("throws on non-ok HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse("nope", 502)));
    await expect(
      callLLM({ providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/502/);
  });

  it("throws on a backend error frame instead of streaming it as assistant content", async () => {
    const sse =
      'data: {"error":true,"code":"chat_turn_failed","message":"Terjadi kendala teknis. Coba lagi dalam beberapa saat."}\n\n' +
      "data: [DONE]\n\n";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sse)));

    const chunks: LLMStreamChunk[] = [];
    await expect(
      callLLM(
        { providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] },
        (chunk) => chunks.push(chunk),
      ),
    ).rejects.toThrow(/Terjadi kendala teknis/);

    // The error text must NOT be emitted as streamed content — otherwise it
    // would render as a fake assistant reply and bypass the LLM fallback chain.
    expect(chunks.filter((c) => !c.done).length).toBe(0);
  });

  it("throws a QuotaExceededError on an llm.quota_exhausted frame, never streaming it as content", async () => {
    const sse =
      'data: {"error":true,"code":"llm.quota_exhausted","retriable":false,"message":"Kuota harian model gratis OpenRouter habis. Tambah credit akun OpenRouter atau gunakan API key sendiri (Settings → LLM)."}\n\n' +
      "data: [DONE]\n\n";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sse)));

    const chunks: LLMStreamChunk[] = [];
    await expect(
      callLLM(
        { providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] },
        (chunk) => chunks.push(chunk),
      ),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });

    expect(chunks.filter((c) => !c.done).length).toBe(0);
  });

  it("callLLMWithFallback stops at the backend quota frame and does NOT burn the user's BYOK key", async () => {
    onDevice.generateOnDevice.mockRejectedValue(new Error("WebGPU unavailable"));
    const sse =
      'data: {"error":true,"code":"llm.quota_exhausted","retriable":false,"message":"Kuota harian model gratis OpenRouter habis."}\n\n' +
      "data: [DONE]\n\n";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(sse)));

    await expect(callLLMWithFallback([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    // BYOK must not be attempted — there is nothing a personal key can do when
    // the BACKEND's shared quota is exhausted; falling through would burn the
    // user's key needlessly and then still show a generic failure.
    expect(byok.getApiKey).not.toHaveBeenCalled();
  });

  it("isQuotaExceededError recognizes QuotaExceededError instances and name-matches", () => {
    const quota = new Error("quota");
    quota.name = "QuotaExceededError";
    expect(isQuotaExceededError(quota)).toBe(true);
    expect(isQuotaExceededError(new Error("boom"))).toBe(false);
  });

  it("aborts cleanly when the signal is aborted before the stream resolves", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse("data: [DONE]\n\n")));

    const controller = new AbortController();
    controller.abort();

    await expect(
      callLLM(
        { providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] },
        () => {},
        controller.signal,
      ),
    ).rejects.toThrow(/aborted/i);
  });

  it("aborts during SSE parsing once the signal fires mid-stream", async () => {
    const chunks = ['data: {"t":"Hello"}\n\n', 'data: {"t":" there"}\n\n', "data: [DONE]\n\n"];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponseChunked(chunks, 20)));

    const controller = new AbortController();
    // Abort shortly after the call begins (mid-read loop, before the final chunk).
    const timer = setTimeout(() => controller.abort(), 5);

    await expect(
      callLLM(
        { providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] },
        () => {},
        controller.signal,
      ),
    ).rejects.toThrow(/aborted/i);
    clearTimeout(timer);
  });
});

describe("isAbortError", () => {
  it("recognizes DOMException AbortError", () => {
    expect(isAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
  });

  it("recognizes a plain error object with name AbortError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("returns false for ordinary errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("nope")).toBe(false);
  });
});
