import { describe, expect, it } from "vitest";
import { formatCount, formatRate, stepProgress } from "./analyticsFormat";

describe("analyticsFormat", () => {
  it("formats rates as percent strings", () => {
    expect(formatRate(0.5)).toBe("50%");
    expect(formatRate(0.123)).toBe("12%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0)).toBe("0%");
  });

  it("renders an em-dash for null or non-finite rates", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(undefined as unknown as null)).toBe("—");
    expect(formatRate(Number.NaN)).toBe("—");
  });

  it("formats counts with thousands separators", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("—");
  });

  it("computes funnel step progress relative to the max", () => {
    expect(stepProgress(50, 100)).toBe(50);
    expect(stepProgress(100, 100)).toBe(100);
    expect(stepProgress(200, 100)).toBe(100);
    expect(stepProgress(0, 0)).toBe(0);
  });
});
