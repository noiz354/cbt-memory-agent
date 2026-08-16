import { apiClient, setUnauthorizedHandler, notifyUnauthorized } from "./apiClient";
import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
