import { apiClient, setUnauthorizedHandler, notifyUnauthorized, RateLimitError, isRateLimitError, parseRetryAfterMs } from "./apiClient";
import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("apiClient 401 interceptor", () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it("calls the registered handler when an authenticated call returns 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Missing Authorization header" })));

    await expect(apiClient.metrics("tok", "dev")).rejects.toThrow(/401/);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call the handler on success", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { v: 2, northStar: {}, metrics: {}, guardrails: {} })));

    await apiClient.metrics("tok", "dev");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not call the handler on non-401 failures", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" })));

    await expect(apiClient.metrics("tok", "dev")).rejects.toThrow(/500/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("notifyUnauthorized invokes the registered handler even when it throws", () => {
    const handler = vi.fn(() => {
      throw new Error("handler exploded");
    });
    setUnauthorizedHandler(handler);
    expect(() => notifyUnauthorized()).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("apiClient 429 rate limiting", () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it("throws RateLimitError with retryAfterMs from Retry-After seconds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(429, { error: "Throttled" }, { "Retry-After": "30" }),
      ),
    );

    const err = await apiClient.metrics("tok", "dev").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(30000);
    expect(err.message).toContain("30s");
    expect(err.message).toContain("Rate limit reached");
  });

  it("throws RateLimitError with null retryAfterMs when no Retry-After header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { error: "nope" })));

    const err = await apiClient.metrics("tok", "dev").then(
      () => null,
      (e) => e,
    );
    expect(isRateLimitError(err)).toBe(true);
    expect(err.retryAfterMs).toBeNull();
  });

  it("does NOT call the unauthorized handler on 429", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { error: "Throttled" })));

    await expect(apiClient.metrics("tok", "dev")).rejects.toBeInstanceOf(RateLimitError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("parseRetryAfterMs handles seconds, HTTP-date, and garbage", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
    expect(parseRetryAfterMs("Wed, 21 Oct 2037 07:28:00 GMT")).not.toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("abc")).toBeNull();
  });
});
