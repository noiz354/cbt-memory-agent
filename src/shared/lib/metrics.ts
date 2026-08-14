/**
 * Metric instrumentation — thin wrappers the frontend calls at event time.
 *
 * Frontend only calls these functions. They bump counters in metricsStore.
 * The analytics layer (metricsAnalytics.ts) reads counters at export time.
 *
 * Usage: `metric.crisisOverlayOpened()` at the moment the event occurs.
 */

import { useMetricsStore } from "@/shared/store/metricsStore";

// ─────────────────────────────────────────────
// A. Clinical safety (1-10)
// ─────────────────────────────────────────────

export const metric = {
  // #1 Crisis overlay opened (from detection)
  crisisOverlayOpened: () => {
    useMetricsStore.getState().bump("crisisOverlayOpened");
    useMetricsStore.getState().bump("crisisFromDetection");
  },

  // #2 False crisis (dismissed <15s without grounding/call)
  crisisFalseShort: () => {
    useMetricsStore.getState().bump("crisisFalseShort");
  },

  // #3 Grounding completed
  crisisGroundingDone: () => {
    useMetricsStore.getState().bump("crisisGroundingDone");
  },

  // #4 Safe exit
  crisisSafeExit: () => {
    useMetricsStore.getState().bump("crisisSafeExit");
  },

  // #6 Lifeline tap
  crisisLifelineTap: () => {
    useMetricsStore.getState().bump("crisisLifelineTap");
  },

  // #7 Hard-halt integrity
  crisisHardHaltOk: () => {
    useMetricsStore.getState().bump("crisisHardHaltOk");
  },

  // #8 Focus-trap integrity
  crisisFocusTrapOk: () => {
    useMetricsStore.getState().bump("crisisFocusTrapOk");
  },

  // #10 Distress-hint no auto-halt
  distressHintNoHalt: () => {
    useMetricsStore.getState().bump("distressHintNoHalt");
    useMetricsStore.getState().bump("distressHintTotal");
  },
  distressHintTotal: () => {
    useMetricsStore.getState().bump("distressHintTotal");
  },

  // ─────────────────────────────────────────────
  // B. Consent & privacy (11-20)
  // ─────────────────────────────────────────────

  // #11 Consent completed
  consentCompleted: () => {
    useMetricsStore.getState().bump("consentCompleted");
  },

  // #12 Scroll-lock honest
  consentScrollHonest: () => {
    useMetricsStore.getState().bump("consentScrollHonest");
  },
  consentShortcut: () => {
    useMetricsStore.getState().bump("consentShortcut");
  },

  // #16 Export success
  exportSuccess: () => {
    useMetricsStore.getState().bump("exportSuccess");
  },

  // #17 Purge
  purgeStarted: () => {
    useMetricsStore.getState().bump("purgeStarted");
  },
  purgeCompleted: () => {
    useMetricsStore.getState().bump("purgeCompleted");
  },
  purgeAbandon: () => {
    useMetricsStore.getState().bump("purgeAbandon");
  },

  // #19 Post-purge residue
  postPurgeResidue: (count: number) => {
    useMetricsStore.getState().set("postPurgeResidue", count);
  },

  // #20 Cross-tab sign-out
  crossTabSignOutOk: () => {
    useMetricsStore.getState().bump("crossTabSignOutOk");
  },

  // ─────────────────────────────────────────────
  // C. Activation & retention (21-27)
  // ─────────────────────────────────────────────

  // #21 Activation D0
  activationD0: () => {
    useMetricsStore.getState().bump("activationD0");
  },

  // #24 Session finalized
  sessionFinalized: () => {
    useMetricsStore.getState().bump("sessionFinalized");
  },

  // #25 Orphan session
  sessionOrphaned: () => {
    useMetricsStore.getState().bump("sessionOrphaned");
  },

  // #26 Re-queue success
  sessionRequeueOk: () => {
    useMetricsStore.getState().bump("sessionRequeueOk");
  },

  // #27 Goal-session alignment
  goalSessionAligned: () => {
    useMetricsStore.getState().bump("goalSessionAligned");
  },

  // ─────────────────────────────────────────────
  // D. CBT session quality (28-35)
  // ─────────────────────────────────────────────

  // #30 Memory inject
  turnWithMemory: () => {
    useMetricsStore.getState().bump("turnWithMemory");
  },

  // #31 Unverified block
  turnRejectedUnverified: () => {
    useMetricsStore.getState().bump("turnRejectedUnverified");
  },

  // #32 Recall chip clicked
  recallChipClicked: () => {
    useMetricsStore.getState().bump("recallChipClicked");
  },

  // #33 Distortion marked
  distortionMarked: () => {
    useMetricsStore.getState().bump("distortionMarked");
  },

  // #35 Barge-in
  bargeInDone: () => {
    useMetricsStore.getState().bump("bargeInDone");
  },

  // ─────────────────────────────────────────────
  // E. Spatial / DnD (36-41)
  // ─────────────────────────────────────────────

  // #36 DnD success
  dndSuccess: () => {
    useMetricsStore.getState().bump("dndSuccess");
  },

  // #37 Graph link created
  graphLinkCreated: () => {
    useMetricsStore.getState().bump("graphLinkCreated");
  },

  // #38 Purge from graph
  purgeFromGraph: () => {
    useMetricsStore.getState().bump("purgeFromGraph");
  },

  // #39 Compare opened
  compareOpened: () => {
    useMetricsStore.getState().bump("compareOpened");
  },

  // #40 Sparkline scrub
  sparklineScrub: () => {
    useMetricsStore.getState().bump("sparklineScrub");
  },

  // #41 Consent slider 90%
  consentSlider90: () => {
    useMetricsStore.getState().bump("consentSlider90");
  },

  // ─────────────────────────────────────────────
  // F. Reliability, perf, version (42-48)
  // ─────────────────────────────────────────────

  // #42 Crash boundary
  crashBoundary: () => {
    useMetricsStore.getState().bump("crashBoundary");
  },

  // #43 Crisis-safe crash
  crisisSafeCrash: () => {
    useMetricsStore.getState().bump("crisisSafeCrash");
  },

  // #44 Stream done / truncated
  streamDone: () => {
    useMetricsStore.getState().bump("streamDone");
  },
  streamTruncated: () => {
    useMetricsStore.getState().bump("streamTruncated");
  },

  // #45 Resume success
  resumeSuccess: () => {
    useMetricsStore.getState().bump("resumeSuccess");
  },

  // #46 Worker health
  workerValid: () => {
    useMetricsStore.getState().bump("workerValid");
  },
  workerParseFail: () => {
    useMetricsStore.getState().bump("workerParseFail");
  },

  // #47 Migration ok
  migrationOk: () => {
    useMetricsStore.getState().bump("migrationOk");
  },

  // #48 Release tagged
  releaseTagged: () => {
    useMetricsStore.getState().bump("releaseTagged");
  },
};
