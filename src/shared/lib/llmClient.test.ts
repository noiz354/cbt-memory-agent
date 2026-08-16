import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const auth = vi.hoisted(() => ({ getAuthHeaders: vi.fn() }));

vi.mock("@/shared/lib/authSession", () => ({ getAuthHeaders: auth.getAuthHeaders }));

import { callLLM, type LLMStreamChunk } from "@/shared/lib/llmClient";

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

  it("throws on non-ok HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse("nope", 502)));
    await expect(
      callLLM({ providerId: "backend-proxy", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/502/);
  });
});
