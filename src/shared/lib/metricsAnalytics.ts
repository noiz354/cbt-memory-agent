/**
 * Analytics layer — computes 48 success metrics from raw counters + stores.
 *
 * This is the ONLY place that reads counters and derives percentages/rates.
 * The frontend just calls `bump(key)` at event time; this file computes aggregates.
 *
 * Output: JSON suitable for export, dashboard, or reviewer audit.
 * No chat content, camera frames, PCM, or device fingerprint is included.
 */

import { useMetricsStore } from "@/shared/store/metricsStore";
import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { useMemoryStore } from "@/features/memory/store/memoryStore";

// ─────────────────────────────────────────────
// Release tag (SemVer+SHA) — attached to every export
// ─────────────────────────────────────────────

export const RELEASE = {
  version: "0.1.0",
  // In CI: replace with git sha
  sha: typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "dev",
  buildAt: "2026-08-13T00:00:00.000Z",
};

declare const __GIT_SHA__: string | undefined;

// ─────────────────────────────────────────────
// Metric definitions — computed at read time
// ─────────────────────────────────────────────

interface MetricValue {
  id: number;
  name: string;
  category: "A" | "B" | "C" | "D" | "E" | "F";
  direction: "↑" | "↓" | "→";
  value: number | string;
  denominator?: number;
  raw?: number;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return NaN;
  return Math.round((numerator / denominator) * 1000) / 10; // 1 decimal
}

export function computeMetrics(): MetricValue[] {
  const c = useMetricsStore.getState().counters;
  const sessions = useSessionStore.getState().sessions;
  const memories = useMemoryStore.getState().nodes;

  // Derived values from stores (not counters)
  const totalSessions = sessions.length;
  const finalizedSessions = sessions.filter((s) => s.status === "extracted").length;
  const orphanedSessions = sessions.filter((s) => s.status === "interrupted").length;
  const sessionsWithReframe = sessions.filter((s) => s.reframe != null).length;
  const coreMemories = memories.filter((m) => m.kind === "core");
  const profilesWithEmergency = 1; // "This browser" always present

  return [
    // A. Clinical safety (1-10)
    { id: 1, name: "Crisis precision (proxy)", category: "A", direction: "→", value: pct(c.crisisFromDetection, c.crisisOverlayOpened), denominator: c.crisisOverlayOpened, raw: c.crisisFromDetection },
    { id: 2, name: "False-crisis rate", category: "A", direction: "↓", value: c.crisisFalseShort, denominator: c.crisisOverlayOpened },
    { id: 3, name: "Grounding completion rate", category: "A", direction: "↑", value: pct(c.crisisGroundingDone, c.crisisOverlayOpened), denominator: c.crisisOverlayOpened },
    { id: 4, name: "Safe-exit compliance", category: "A", direction: "↑", value: pct(c.crisisSafeExit, c.crisisOverlayOpened), denominator: c.crisisOverlayOpened, raw: c.crisisSafeExit },
    { id: 5, name: "Time-to-lifeline", category: "A", direction: "↓", value: "N/A — needs timestamp capture", denominator: 0 },
    { id: 6, name: "Lifeline reach", category: "A", direction: "→", value: c.crisisLifelineTap, denominator: c.crisisOverlayOpened },
    { id: 7, name: "Hard-halt integrity", category: "A", direction: "↑", value: pct(c.crisisHardHaltOk, c.crisisOverlayOpened), denominator: c.crisisOverlayOpened },
    { id: 8, name: "Focus-trap integrity", category: "A", direction: "↑", value: pct(c.crisisFocusTrapOk, c.crisisOverlayOpened), denominator: c.crisisOverlayOpened },
    { id: 9, name: "Personal-contact availability", category: "A", direction: "→", value: profilesWithEmergency, denominator: 1 },
    { id: 10, name: "Distress-hint → crisis (no-auto-halt)", category: "A", direction: "→", value: pct(c.distressHintNoHalt, c.distressHintTotal), denominator: c.distressHintTotal },

    // B. Consent & privacy (11-20)
    { id: 11, name: "Consent completion rate", category: "B", direction: "↑", value: c.consentCompleted },
    { id: 12, name: "Scroll-lock honesty", category: "B", direction: "→", value: pct(c.consentScrollHonest, c.consentCompleted + c.consentShortcut), denominator: c.consentCompleted + c.consentShortcut },
    { id: 13, name: "Time-on-consent", category: "B", direction: "→", value: "N/A — needs timer capture", denominator: 0 },
    { id: 14, name: "Vault seated rate", category: "B", direction: "↑", value: coreMemories.length > 0 ? 100 : 0 },
    { id: 15, name: "Emergency-contact opt-in", category: "B", direction: "→", value: "N/A — needs profile field", denominator: 0 },
    { id: 16, name: "Export success", category: "B", direction: "↑", value: c.exportSuccess },
    { id: 17, name: "Purge completion", category: "B", direction: "↑", value: pct(c.purgeCompleted, c.purgeStarted), denominator: c.purgeStarted },
    { id: 18, name: "Purge abandon", category: "B", direction: "→", value: c.purgeAbandon },
    { id: 19, name: "Post-purge residue", category: "B", direction: "↓", value: c.postPurgeResidue },
    { id: 20, name: "Cross-tab sign-out success", category: "B", direction: "↑", value: c.crossTabSignOutOk },

    // C. Activation & retention (21-27)
    { id: 21, name: "Activation (D0)", category: "C", direction: "↑", value: c.activationD0 },
    { id: 22, name: "First-value time", category: "C", direction: "↓", value: "N/A — needs timer capture", denominator: 0 },
    { id: 23, name: "D7 return (local)", category: "C", direction: "↑", value: "N/A — needs install tracking", denominator: 0 },
    { id: 24, name: "Session finalize rate", category: "C", direction: "↑", value: c.sessionFinalized },
    { id: 25, name: "Orphan session rate", category: "C", direction: "↓", value: pct(orphanedSessions, totalSessions), denominator: totalSessions },
    { id: 26, name: "Re-queue success", category: "C", direction: "↑", value: c.sessionRequeueOk },
    { id: 27, name: "Goal–session alignment", category: "C", direction: "↑", value: c.goalSessionAligned },

    // D. CBT session quality (28-35)
    { id: 28, name: "Turns per session", category: "D", direction: "→", value: "N/A — needs turn counter per session", denominator: 0 },
    { id: 29, name: "Thought–reframe coverage", category: "D", direction: "↑", value: pct(sessionsWithReframe, finalizedSessions), denominator: finalizedSessions },
    { id: 30, name: "Memory inject rate", category: "D", direction: "→", value: c.turnWithMemory },
    { id: 31, name: "Unverified block rate", category: "D", direction: "→", value: c.turnRejectedUnverified },
    { id: 32, name: "Recall citation CTR", category: "D", direction: "↑", value: c.recallChipClicked },
    { id: 33, name: "Distortion-mark rate", category: "D", direction: "→", value: c.distortionMarked },
    { id: 34, name: "Mood delta", category: "D", direction: "→", value: "N/A — self-report interpretation", denominator: 0 },
    { id: 35, name: "Barge-in rate", category: "D", direction: "→", value: c.bargeInDone },

    // E. Spatial / DnD (36-41)
    { id: 36, name: "DnD success (chat)", category: "E", direction: "↑", value: c.dndSuccess },
    { id: 37, name: "Graph link creation", category: "E", direction: "→", value: c.graphLinkCreated },
    { id: 38, name: "Purge-from-graph", category: "E", direction: "→", value: c.purgeFromGraph },
    { id: 39, name: "Compare usage", category: "E", direction: "↑", value: c.compareOpened },
    { id: 40, name: "Sparkline scrub → card", category: "E", direction: "↑", value: c.sparklineScrub },
    { id: 41, name: "Consent slider completion", category: "E", direction: "↑", value: c.consentSlider90 },

    // F. Reliability, perf, version (42-48)
    { id: 42, name: "Crash-free sessions", category: "F", direction: "↑", value: pct(1, 1 + c.crashBoundary), denominator: 1 + c.crashBoundary },
    { id: 43, name: "Crisis-safe crashes", category: "F", direction: "↑", value: pct(c.crisisSafeCrash, Math.max(1, c.crashBoundary)), denominator: Math.max(1, c.crashBoundary) },
    { id: 44, name: "Stream completion", category: "F", direction: "↑", value: pct(c.streamDone, c.streamDone + c.streamTruncated), denominator: c.streamDone + c.streamTruncated },
    { id: 45, name: "Resume success", category: "F", direction: "↑", value: c.resumeSuccess },
    { id: 46, name: "Worker health", category: "F", direction: "↑", value: pct(c.workerValid, c.workerValid + c.workerParseFail), denominator: c.workerValid + c.workerParseFail },
    { id: 47, name: "Persist migration success", category: "F", direction: "↑", value: c.migrationOk },
    { id: 48, name: "Release coverage", category: "F", direction: "↑", value: c.releaseTagged },
  ];
}

// ─────────────────────────────────────────────
// Export bundle — for dashboard / reviewer
// ─────────────────────────────────────────────

export interface MetricsExport {
  v: 2;
  releasedAt: string;
  release: typeof RELEASE;
  metrics: MetricValue[];
  northStar: {
    activation: number;
    crashFree: number;
    hardHaltIntegrity: number;
  };
  guardrails: {
    falseCrisisRate: number;
    distressNoAutoHalt: number;
    purgeAbandon: number;
  };
}

export function exportMetrics(): MetricsExport {
  const metrics = computeMetrics();

  const byId = (id: number) => metrics.find((m) => m.id === id);

  return {
    v: 2,
    releasedAt: new Date().toISOString(),
    release: RELEASE,
    metrics,
    northStar: {
      activation: (byId(21)?.value as number) ?? 0,
      crashFree: (byId(42)?.value as number) ?? 100,
      hardHaltIntegrity: (byId(7)?.value as number) ?? 0,
    },
    guardrails: {
      falseCrisisRate: (byId(2)?.value as number) ?? 0,
      distressNoAutoHalt: (byId(10)?.value as number) ?? 100,
      purgeAbandon: (byId(18)?.value as number) ?? 0,
    },
  };
}
