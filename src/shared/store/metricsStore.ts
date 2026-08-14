/**
 * Metrics store — 48 on-device success metrics for CBT Memory Agent.
 *
 * All metrics are computed locally from audit log + stores.
 * No chat content, camera frames, PCM, or device fingerprint is sent.
 *
 * Schema per metric counter:
 *   { metricId: number } — raw count or sum
 *
 * Aggregation happens at read time via the analytics layer (metricsAnalytics.ts).
 */

import { createVersionedPersist } from "@/shared/lib/versionedPersist";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─────────────────────────────────────────────
// Metric counters — raw counts, aggregated at read time
// ─────────────────────────────────────────────

export interface MetricCounters {
  // A. Clinical safety (1-10)
  crisisOverlayOpened: number; // #1 denominator
  crisisFromDetection: number; // #1 numerator
  crisisFalseShort: number; // #2: dismissed <15s without grounding/call
  crisisGroundingDone: number; // #3: ≥1 breathing or 5-point completed
  crisisSafeExit: number; // #4: dismiss after grounding unlock
  crisisLifelineTap: number; // #6: tel:/sms: tapped
  crisisHardHaltOk: number; // #7: isStreaming=false + mic/cam off in 1 frame
  crisisFocusTrapOk: number; // #8: no focus escape during crisis
  distressHintNoHalt: number; // #10: distressed hint that did NOT auto-halt
  distressHintTotal: number;

  // B. Consent & privacy (11-20)
  consentCompleted: number; // #11
  consentScrollHonest: number; // #12: scrolled to bottom before accept
  consentShortcut: number; // #12: End key without scroll (tracked separately)
  exportSuccess: number; // #16: valid JSON v=1 without previewUrl
  purgeStarted: number; // #17: started typing/hold
  purgeCompleted: number; // #17: finished full sequence
  purgeAbandon: number; // #18: started but canceled
  postPurgeResidue: number; // #19: cbt-* keys remaining after purge (should be 0)
  crossTabSignOutOk: number; // #20

  // C. Activation & retention (21-27)
  activationD0: number; // #21: onboarding + 1 chat turn in same session
  sessionFinalized: number; // #24: End session pressed
  sessionOrphaned: number; // #25: interrupted status
  sessionRequeueOk: number; // #26: pull-to-refresh interrupted→pending
  goalSessionAligned: number; // #27: finalized session with matching vault goal

  // D. CBT session quality (28-35)
  turnWithMemory: number; // #30: turn with ≥1 Core Memory injected
  turnRejectedUnverified: number; // #31: inject rejected (confidence<0.6, unverified)
  recallChipClicked: number; // #32: recall chip → /memory navigation
  distortionMarked: number; // #33: assistant reply with CBT pattern tag
  bargeInDone: number; // #35: stream stopped by swipe/barge-in

  // E. Spatial / DnD (36-41)
  dndSuccess: number; // #36: drag ended in valid dropzone
  graphLinkCreated: number; // #37: custom link created
  purgeFromGraph: number; // #38: node burned from graph
  compareOpened: number; // #39: compare modal opened
  sparklineScrub: number; // #40: scrub highlighted a card
  consentSlider90: number; // #41: reached 90% track

  // F. Reliability, perf, version (42-48)
  crashBoundary: number; // #42: ErrorBoundary triggered
  crisisSafeCrash: number; // #43: crash that did NOT swallow overlay
  streamDone: number; // #44: reply done without truncation
  streamTruncated: number; // #44b: reply truncated
  resumeSuccess: number; // #45: truncated resumed to done
  workerValid: number; // #46: frame/PCM with {v:1, type} valid
  workerParseFail: number; // #46b: parse fail
  migrationOk: number; // #47: schema version matched or migrated
  releaseTagged: number; // #48: session with valid SemVer+SHA release
}

const zeroCounters = (): MetricCounters => ({
  crisisOverlayOpened: 0,
  crisisFromDetection: 0,
  crisisFalseShort: 0,
  crisisGroundingDone: 0,
  crisisSafeExit: 0,
  crisisLifelineTap: 0,
  crisisHardHaltOk: 0,
  crisisFocusTrapOk: 0,
  distressHintNoHalt: 0,
  distressHintTotal: 0,
  consentCompleted: 0,
  consentScrollHonest: 0,
  consentShortcut: 0,
  exportSuccess: 0,
  purgeStarted: 0,
  purgeCompleted: 0,
  purgeAbandon: 0,
  postPurgeResidue: 0,
  crossTabSignOutOk: 0,
  activationD0: 0,
  sessionFinalized: 0,
  sessionOrphaned: 0,
  sessionRequeueOk: 0,
  goalSessionAligned: 0,
  turnWithMemory: 0,
  turnRejectedUnverified: 0,
  recallChipClicked: 0,
  distortionMarked: 0,
  bargeInDone: 0,
  dndSuccess: 0,
  graphLinkCreated: 0,
  purgeFromGraph: 0,
  compareOpened: 0,
  sparklineScrub: 0,
  consentSlider90: 0,
  crashBoundary: 0,
  crisisSafeCrash: 0,
  streamDone: 0,
  streamTruncated: 0,
  resumeSuccess: 0,
  workerValid: 0,
  workerParseFail: 0,
  migrationOk: 0,
  releaseTagged: 0,
});

interface MetricsState {
  counters: MetricCounters;
  bump: (key: keyof MetricCounters, by?: number) => void;
  set: (key: keyof MetricCounters, value: number) => void;
  wipe: () => void;
}

export const useMetricsStore = create<MetricsState>()(
  persist(
    (set) => ({
      counters: zeroCounters(),
      bump: (key, by = 1) =>
        set((s) => ({
          counters: { ...s.counters, [key]: (s.counters[key] ?? 0) + by },
        })),
      set: (key, value) =>
        set((s) => ({
          counters: { ...s.counters, [key]: value },
        })),
      wipe: () => set({ counters: zeroCounters() }),
    }),
    createVersionedPersist<MetricsState, { counters: MetricCounters }>({
      name: "cbt-metrics",
      partialize: (s) => ({ counters: s.counters }),
    }),
  ),
);
