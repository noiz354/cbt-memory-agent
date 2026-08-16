/**
 * Core Web Vitals tracking — native PerformanceObserver, no external package.
 *
 * Collects CLS, LCP, INP, FCP, TTFB and emits each as an OTel span
 * (`web-vitals.*`) through the existing relay (`/api/v1/telemetry`), so
 * Grafana receives them without a new dependency. Gated on the same
 * `VITE_OTEL_ENABLED === "true"` flag as `telemetry.ts`.
 *
 * Thresholds follow the official web.dev boundary values. Ratings are pure
 * and unit-tested; observers degrade silently in browsers without the APIs.
 */

import { getTracer } from "./telemetry";

export type VitalsMetric = "CLS" | "LCP" | "INP" | "FCP" | "TTFB";
export type VitalsRating = "good" | "needs-improvement" | "poor";

/** Good / poor boundaries per metric (web.dev thresholds). */
export const VITALS_THRESHOLDS: Record<VitalsMetric, { good: number; poor: number }> = {
  CLS: { good: 0.1, poor: 0.25 },
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

/** Pure classifier used by the spans — kept separate for unit testing. */
export function vitalsRating(metric: VitalsMetric, value: number): VitalsRating {
  const t = VITALS_THRESHOLDS[metric];
  if (value <= t.good) return "good";
  if (value < t.poor) return "needs-improvement";
  return "poor";
}

function report(metric: VitalsMetric, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  const rating = vitalsRating(metric, value);
  const span = getTracer().startSpan(`web-vitals.${metric.toLowerCase()}`, {
    attributes: {
      "web_vitals.metric": metric,
      "web_vitals.value": value,
      "web_vitals.rating": rating,
    },
  });
  span.end();
}

let initialized = false;

/**
 * Idempotent; no-op when OTel is disabled or the browser lacks the observers.
 * Call once from `main.tsx` after `initTelemetry()`.
 */
export function initWebVitals(): void {
  if (initialized) return;
  initialized = true;

  if (import.meta.env.VITE_OTEL_ENABLED !== "true") return;
  if (typeof PerformanceObserver === "undefined" || typeof performance === "undefined") return;

  try {
    // CLS — cumulative layout shift, exclude shifts from recent input.
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as unknown as { hadRecentInput: boolean; value: number };
        if (!e.hadRecentInput) clsValue += e.value;
      }
      report("CLS", clsValue);
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });

    // LCP — largest contentful paint (first instance; entry has no later attr).
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as LargestContentfulPaint;
      if (last) report("LCP", last.startTime);
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });

    // INP — interaction to next paint (event timing).
    let inpValue: number | null = null;
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEventTiming;
        if (e.duration > 0) inpValue = Math.max(inpValue ?? 0, e.duration);
      }
      if (inpValue !== null) report("INP", inpValue);
    });
    inpObserver.observe({ type: "event", buffered: true });

    // FCP — first contentful paint.
    const fcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") report("FCP", entry.startTime);
      }
    });
    fcpObserver.observe({ type: "paint", buffered: true });

    // TTFB — time to first byte from the navigation entry.
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) report("TTFB", nav.responseStart);
  } catch {
    // Individual observer failures must never break app startup.
  }
}
