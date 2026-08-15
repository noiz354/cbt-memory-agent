/**
 * telemetryEvents — layer typed di atas buffered trackEvent (FASE 1 Core Telemetry).
 *
 * Nama event mengikuti katalog backend (`lambda/lib/eventCatalog.ts`). Frontend
 * memanggil `track()` TEPAT SATU KALI per kejadian, di tempat kejadian terjadi
 * (pola yang sama dengan `metric.*` di metrics.ts). Backend mem-drop event yang
 * tidak ada di katalog, jadi frontend tidak perlu validasi tambahan.
 *
 * Tidak ada UI di sini — murni instrumentation.
 */

import { trackEvent, type TrackEventInput } from "./trackEvent";

export const TELEMETRY_EVENTS = {
  // core
  appLaunch: "app_launch",
  pageView: "page_view",
  // auth
  signupCompleted: "signup_completed",
  loginCompleted: "login_completed",
  onboardingCompleted: "onboarding_completed",
  // chat
  sessionStarted: "session_started",
  messageSent: "message_sent",
  streamDone: "stream_done",
  streamTruncated: "stream_truncated",
  sessionFinalized: "session_finalized",
  sessionInterrupted: "session_interrupted",
  // crisis
  crisisTriggered: "crisis_triggered",
  crisisResolved: "crisis_resolved",
  crisisGroundingDone: "crisis_grounding_done",
  crisisLifelineUsed: "crisis_lifeline_used",
  // voice
  voiceNoteRecorded: "voice_note_recorded",
  transcriptReceived: "transcript_received",
  // memory
  memoryAdded: "memory_added",
  memoryUpdated: "memory_updated",
  memoryDeleted: "memory_deleted",
  memorySearched: "memory_searched",
  memoryEdgeLinked: "memory_edge_linked",
  // privacy
  exportCompleted: "export_completed",
  purgeCompleted: "purge_completed",
} as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

/**
 * Fire-and-forget: enqueue satu event. Properties dibatasi skema backend per
 * event (tanpa PII). Drops diam-diam bila belum ada identitas / gagal kirim.
 */
export function track(name: string, properties?: Record<string, unknown> | null): void {
  const input: TrackEventInput = { name, properties: properties ?? null };
  trackEvent(input);
}
