/**
 * Unit tests — OpenRouter client quota classification + chat availability probe.
 *
 * - streamChat/chat melempar OpenRouterQuotaError saat HTTP 429/402 dengan pesan
 *   kuota (free-models-per-day / insufficient credits) — ini beda dari rate-limit
 *   sementara, dipakai chatTurn untuk frame SSE llm.quota_exhausted.
 * - checkChatAvailability probe 1-token dengan cache TTL supaya tidak boros kuota.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OpenRouterClient, CHAT_MODEL, OpenRouterQuotaError } from "../lib/openrouter";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenRouter quota classification", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streamChat throws OpenRouterQuotaError on 429 free-models-per-day", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(429, {
        error: {
          message:
            "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
          code: 429,
        },
      }),
    );
    const client = new OpenRouterClient("sk-test");
    const iter = client.streamChat([{ role: "user", content: "hi" }]);
    const err = await iter.next().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OpenRouterQuotaError);
    expect((err as OpenRouterQuotaError).quotaExhausted).toBe(true);
    expect((err as Error).name).toBe("OpenRouterQuotaError");
  });

  it("chat() throws OpenRouterQuotaError on 402 insufficient credits", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(402, { error: { message: "Insufficient Credits. Please add credits to your account." } }),
    );
    const client = new OpenRouterClient("sk-test");
    const err = await client.chat([{ role: "user", content: "hi" }]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OpenRouterQuotaError);
    expect((err as OpenRouterQuotaError).quotaExhausted).toBe(true);
  });

  it("plain 429 rate-limit (non-quota) stays a generic error, not quota", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(429, { error: { message: "Rate limit exceeded: requests-per-minute." } }),
    );
    const client = new OpenRouterClient("sk-test");
    const err = await client.chat([{ role: "user", content: "hi" }]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(OpenRouterQuotaError);
    expect((err as Error).message).toContain("HTTP 429");
  });

  it("500 upstream stays a generic error with the HTTP status surfaced", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, { error: { message: "boom" } }));
    const client = new OpenRouterClient("sk-test");
    const err = await client.chat([{ role: "user", content: "hi" }]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(OpenRouterQuotaError);
    expect((err as Error).message).toContain("HTTP 500");
  });
});

describe("OpenRouter chat availability probe (checkChatAvailability)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports available when a tiny chat call succeeds", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "pong" } }] }),
    );
    const client = new OpenRouterClient("sk-test");
    const res = await client.checkChatAvailability();
    expect(res).toEqual({ available: true, quotaExhausted: false });
  });

  it("reports quotaExhausted when the probe hits 429 free-models-per-day", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(429, {
        error: { message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock..." },
      }),
    );
    const client = new OpenRouterClient("sk-test");
    const res = await client.checkChatAvailability();
    expect(res).toEqual({ available: false, quotaExhausted: true });
  });

  it("reports unavailable (not quota) on a 5xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(503, { error: { message: "down" } }));
    const client = new OpenRouterClient("sk-test");
    const res = await client.checkChatAvailability();
    expect(res).toEqual({ available: false, quotaExhausted: false });
  });

  it("caches the result within the TTL (no probe burn per health poll)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "pong" } }] }),
    );
    const client = new OpenRouterClient("sk-test");
    await client.checkChatAvailability();
    await client.checkChatAvailability();
    await client.checkChatAvailability();
    // Only one upstream call — the rest served from cache.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("probes the chat model, not the credits endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "pong" } }] }),
    );
    const client = new OpenRouterClient("sk-test");
    await client.checkChatAvailability();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(CHAT_MODEL);
    expect(body.max_tokens).toBe(1);
  });
});