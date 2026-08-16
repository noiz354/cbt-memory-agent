import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const auth = vi.hoisted(() => ({ getAuthHeaders: vi.fn() }));

vi.mock("@/shared/lib/authSession", () => ({ getAuthHeaders: auth.getAuthHeaders }));

import { callLLM, isAbortError, type LLMStreamChunk } from "@/shared/lib/llmClient";

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
