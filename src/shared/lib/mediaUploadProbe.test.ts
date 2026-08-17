import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEDIA_UPLOAD_HOST,
  MediaUploadProbeResult,
  combineBackendStatus,
  llmDetailMessage,
  probeMediaUploadReachability,
} from "./mediaUploadProbe";

describe("probeMediaUploadReachability", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats a resolved response (browser reaches S3, 403 from anonymous GET) as reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(probeMediaUploadReachability("https://s3.example/")).resolves.toEqual({
      reachable: true,
      status: 403,
    } satisfies MediaUploadProbeResult);
  });

  it("treats a resolved 200 response as reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const result = await probeMediaUploadReachability("https://s3.example/");
    expect(result).toEqual({ reachable: true, status: 200 });
  });

  it("classifies TypeError 'Failed to fetch' (CORS preflight/CSP/network block) as cors_blocked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(probeMediaUploadReachability("https://s3.example/")).resolves.toEqual({
      reachable: false,
      reason: "cors_blocked",
    });
  });

  it("classifies a generic rejection as network_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const result = await probeMediaUploadReachability("https://s3.example/");
    expect(result).toEqual({ reachable: false, reason: "network_error" });
  });

  it("uses MEDIA_UPLOAD_HOST default when no url passed, with GET + cors mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await probeMediaUploadReachability();
    expect(fetchMock).toHaveBeenCalledWith(
      MEDIA_UPLOAD_HOST,
      expect.objectContaining({ method: "GET", mode: "cors" }),
    );
    expect(result.reachable).toBe(true);
  });
});

describe("combineBackendStatus", () => {
  it("health ok + probe reachable -> ok, no detail", () => {
    expect(combineBackendStatus("ok", { reachable: true, status: 403 })).toEqual({ status: "ok", detail: null });
  });

  it("health ok + CORS/network blocked -> degraded with media upload hint", () => {
    expect(combineBackendStatus("ok", { reachable: false, reason: "cors_blocked" })).toEqual({
      status: "degraded",
      detail: "Media upload diblokir di browser (CORS/CSP/network) — periksa CORS bucket S3.",
    });
    expect(combineBackendStatus("ok", { reachable: false, reason: "network_error" })).toEqual({
      status: "degraded",
      detail: "Media upload diblokir di browser (CORS/CSP/network) — periksa CORS bucket S3.",
    });
  });

  it("health down + anything -> down, probe detail dropped", () => {
    expect(combineBackendStatus("down", { reachable: false, reason: "cors_blocked" })).toEqual({
      status: "down",
      detail: null,
    });
  });

  it("server-side degraded wins over a healthy probe", () => {
    expect(combineBackendStatus("degraded", { reachable: true, status: 200 })).toEqual({
      status: "degraded",
      detail: null,
    });
  });
});

describe("llmDetailMessage", () => {
  it("gives an actionable detail for backend LLM quota exhaustion", () => {
    const detail = llmDetailMessage("quota_exhausted");
    expect(detail).toMatch(/kuota harian/i);
    expect(detail).toMatch(/Settings → LLM/);
  });

  it("gives a terse detail for a generic backend LLM outage", () => {
    expect(llmDetailMessage("unavailable")).toMatch(/tidak tersedia/i);
  });

  it("returns null when the LLM is healthy or unknown", () => {
    expect(llmDetailMessage("available")).toBeNull();
    expect(llmDetailMessage(undefined)).toBeNull();
    expect(llmDetailMessage(null)).toBeNull();
  });
});