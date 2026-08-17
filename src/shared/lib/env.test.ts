import { describe, it, expect, afterEach, vi } from "vitest";
import { isLocalHostname, isHostedDeployment } from "@/shared/lib/env";

describe("isLocalHostname", () => {
  it("returns true for loopback hostnames", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("::1")).toBe(true);
  });

  it("returns false for deployed / LAN hostnames", () => {
    expect(isLocalHostname("d2sbinyjz34sz4.cloudfront.net")).toBe(false);
    expect(isLocalHostname("192.168.1.10")).toBe(false);
    expect(isLocalHostname("cbt.example.com")).toBe(false);
  });
});

describe("isHostedDeployment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns false when on loopback (local dev / self-host)", () => {
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    expect(isHostedDeployment()).toBe(false);
  });

  it("returns false without window (SSR / tests)", () => {
    const saved = globalThis.window;
    vi.stubGlobal("window", undefined);
    expect(isHostedDeployment()).toBe(false);
    vi.stubGlobal("window", saved);
  });

  it("returns true on a deployed CloudFront hostname", () => {
    vi.stubGlobal("window", { location: { hostname: "d2sbinyjz34sz4.cloudfront.net" } });
    expect(isHostedDeployment()).toBe(true);
  });
});