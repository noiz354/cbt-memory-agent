import { describe, it, expect } from "vitest";
import {
  ALL_FALLBACKS_FAILED_MESSAGE,
  LLM_QUOTA_MESSAGE,
  RATE_LIMIT_MESSAGE,
  assistantErrorMessage,
  isSpecificLLMFailure,
} from "@/features/chat/lib/chatError";
import { QuotaExceededError } from "@/shared/lib/llmClient";
import { RateLimitError } from "@/shared/lib/apiClient";

describe("assistantErrorMessage", () => {
  it("renders the actionable quota message for an OpenRouter quota-exhaustion error", () => {
    const quota = new QuotaExceededError("Kuota harian model gratis OpenRouter habis.");
    expect(assistantErrorMessage(quota)).toBe(LLM_QUOTA_MESSAGE);
    expect(LLM_QUOTA_MESSAGE).toMatch(/Kuota harian model gratis backend habis/i);
    expect(LLM_QUOTA_MESSAGE).toMatch(/Settings → LLM/);
  });

  it("renders the rate-limit message for a local 429 RateLimitError", () => {
    expect(assistantErrorMessage(new RateLimitError("rate limited", 5000))).toBe(RATE_LIMIT_MESSAGE);
  });

  it("renders the generic all-fallbacks message for any other failure", () => {
    expect(assistantErrorMessage(new Error("BOOM"))).toBe(ALL_FALLBACKS_FAILED_MESSAGE);
    expect(ALL_FALLBACKS_FAILED_MESSAGE).toMatch(/LLM unavailable/);
  });
});

describe("isSpecificLLMFailure", () => {
  it("is true for quota exhaustion and rate limit", () => {
    expect(isSpecificLLMFailure(new QuotaExceededError("quota"))).toBe(true);
    expect(isSpecificLLMFailure(new RateLimitError("limited", 1))).toBe(true);
  });

  it("is false for generic failures", () => {
    expect(isSpecificLLMFailure(new Error("boom"))).toBe(false);
  });
});