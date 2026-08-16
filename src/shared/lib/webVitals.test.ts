import { describe, expect, it } from "vitest";
import { vitalsRating, VITALS_THRESHOLDS } from "./webVitals";

describe("vitalsRating", () => {
  it("classifies CLS at good / needs-improvement / poor boundaries", () => {
    expect(vitalsRating("CLS", 0.05)).toBe("good");
    expect(vitalsRating("CLS", 0.1)).toBe("good");
    expect(vitalsRating("CLS", 0.15)).toBe("needs-improvement");
    expect(vitalsRating("CLS", 0.24)).toBe("needs-improvement");
    expect(vitalsRating("CLS", 0.25)).toBe("poor");
  });

  it("classifies LCP in ms", () => {
    expect(vitalsRating("LCP", 1800)).toBe("good");
    expect(vitalsRating("LCP", 2500)).toBe("good");
    expect(vitalsRating("LCP", 3200)).toBe("needs-improvement");
    expect(vitalsRating("LCP", 3999)).toBe("needs-improvement");
    expect(vitalsRating("LCP", 4000)).toBe("poor");
  });

  it("classifies INP in ms", () => {
    expect(vitalsRating("INP", 150)).toBe("good");
    expect(vitalsRating("INP", 300)).toBe("needs-improvement");
    expect(vitalsRating("INP", 500)).toBe("poor");
  });

  it("classifies FCP and TTFB", () => {
    expect(vitalsRating("FCP", 1500)).toBe("good");
    expect(vitalsRating("FCP", 2500)).toBe("needs-improvement");
    expect(vitalsRating("FCP", 3000)).toBe("poor");
    expect(vitalsRating("TTFB", 600)).toBe("good");
    expect(vitalsRating("TTFB", 1000)).toBe("needs-improvement");
    expect(vitalsRating("TTFB", 1800)).toBe("poor");
  });

  it("covers all five metrics with finite thresholds", () => {
    for (const [, { good, poor }] of Object.entries(VITALS_THRESHOLDS)) {
      expect(Number.isFinite(good)).toBe(true);
      expect(Number.isFinite(poor)).toBe(true);
      expect(good).toBeLessThan(poor);
    }
    expect(Object.keys(VITALS_THRESHOLDS)).toHaveLength(5);
  });
});
