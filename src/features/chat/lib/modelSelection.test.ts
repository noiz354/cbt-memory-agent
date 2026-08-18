import { describe, expect, it } from "vitest";
import {
  formatModelLabel,
  isValidModel,
  resolvePreferred,
  type PreferredModel,
} from "./modelSelection";

describe("isValidModel", () => {
  it("accepts a real provider+model pair from the registry", () => {
    expect(isValidModel({ providerId: "openrouter", modelId: "openai/gpt-4o-mini" })).toBe(true);
  });

  it("rejects null/undefined preference", () => {
    expect(isValidModel(null)).toBe(false);
  });

  it("rejects an unknown provider", () => {
    expect(isValidModel({ providerId: "not-a-provider" as never, modelId: "x" })).toBe(false);
  });

  it("rejects a known provider but unknown model id", () => {
    expect(isValidModel({ providerId: "openrouter", modelId: "nope/non-existent" })).toBe(false);
  });
});

describe("resolvePreferred", () => {
  const fallback = { providerId: "local-webllm" as const, modelId: "Phi-3-mini-4k-instruct-q4f16_1-MLC" };

  it("returns the valid stored preference as-is", () => {
    const pref: PreferredModel = { providerId: "openrouter", modelId: "openai/gpt-4o-mini" };
    expect(resolvePreferred(pref, fallback)).toEqual(pref);
  });

  it("falls back when the stored preference is invalid/stale", () => {
    expect(resolvePreferred(null, fallback)).toEqual(fallback);
    expect(resolvePreferred({ providerId: "openrouter", modelId: "gone/model" }, fallback)).toEqual(fallback);
  });
});

describe("formatModelLabel", () => {
  it("labels on-device and backend providers concisely", () => {
    expect(formatModelLabel("local-webllm", "Phi-3-mini-4k-instruct-q4f16_1-MLC")).toBe("on-device");
    expect(formatModelLabel("backend-proxy", "gpt-4o-mini")).toBe("backend");
  });

  it("shortens openrouter model ids to the tail segment", () => {
    expect(formatModelLabel("openrouter", "openai/gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("uses the provider display name for BYOK providers", () => {
    expect(formatModelLabel("deepseek", "deepseek-chat")).toBe("DeepSeek");
  });

  it("falls back to the raw provider id when unknown", () => {
    expect(formatModelLabel("mystery-provider", "x")).toBe("mystery-provider");
  });

  it("handles missing values gracefully", () => {
    expect(formatModelLabel(undefined, undefined)).toBe("model");
  });
});
