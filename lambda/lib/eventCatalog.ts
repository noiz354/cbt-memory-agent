/**
 * Event Catalog — sumber kebenaran tunggal untuk nama event yang boleh masuk
 * `user_events` (FASE 1 Core Telemetry + FASE 2/3 analytics + FASE 4 monetisasi).
 *
 * `user_events.event_name` tidak punya CHECK constraint, jadi perluasan event
 * cukup menambah entri di sini (tanpa migrasi schema). Backend DROP event
 * non-katalog via `partitionEvents` (bukan bucket generik).
 *
 * Kategori:
 *   core        — siklus hidup aplikasi (app_launch, page_view)
 *   auth        — signup/login/onboarding
 *   chat        — sesi chat & streaming
 *   crisis      — alur krisis (trigger/resolve/grounding/lifeline)
 *   voice       — perekaman & transkripsi suara
 *   memory      — CRUD memory graph
 *   privacy     — export / purge
 *   monetization— 6 event FASE 4 (checkout/payment/subscription)
 */

export const EVENT_CATEGORIES = [
  "core",
  "auth",
  "chat",
  "crisis",
  "voice",
  "memory",
  "privacy",
  "monetization",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface CatalogEvent {
  name: string;
  category: EventCategory;
}

/** Katalog lengkap event yang diizinkan (single source of truth). */
export const TRACKED_EVENTS: readonly CatalogEvent[] = [
  // core
  { name: "app_launch", category: "core" },
  { name: "page_view", category: "core" },
  // auth
  { name: "signup_completed", category: "auth" },
  { name: "login_completed", category: "auth" },
  { name: "onboarding_completed", category: "auth" },
  // chat
  { name: "session_started", category: "chat" },
  { name: "message_sent", category: "chat" },
  { name: "stream_done", category: "chat" },
  { name: "stream_truncated", category: "chat" },
  { name: "session_finalized", category: "chat" },
  { name: "session_interrupted", category: "chat" },
  // crisis
  { name: "crisis_triggered", category: "crisis" },
  { name: "crisis_resolved", category: "crisis" },
  { name: "crisis_grounding_done", category: "crisis" },
  { name: "crisis_lifeline_used", category: "crisis" },
  // voice
  { name: "voice_note_recorded", category: "voice" },
  { name: "transcript_received", category: "voice" },
  { name: "transcript_failed", category: "voice" },
  // memory
  { name: "memory_added", category: "memory" },
  { name: "memory_updated", category: "memory" },
  { name: "memory_deleted", category: "memory" },
  { name: "memory_searched", category: "memory" },
  { name: "memory_edge_linked", category: "memory" },
  { name: "attachment_failed", category: "memory" },
  // privacy
  { name: "export_completed", category: "privacy" },
  { name: "purge_completed", category: "privacy" },
  // monetization (FASE 4 — konsisten dengan ALLOWED_MONETIZATION_EVENTS)
  { name: "checkout_started", category: "monetization" },
  { name: "checkout_completed", category: "monetization" },
  { name: "payment_succeeded", category: "monetization" },
  { name: "payment_failed", category: "monetization" },
  { name: "subscription_upgraded", category: "monetization" },
  { name: "subscription_cancelled", category: "monetization" },
];

/** Nama event yang diizinkan (dari katalog). */
export const ALLOWED_EVENTS: readonly string[] = TRACKED_EVENTS.map((e) => e.name);

const ALLOWED_EVENT_SET: ReadonlySet<string> = new Set(ALLOWED_EVENTS);

export function isAllowedEventName(name: string): boolean {
  return ALLOWED_EVENT_SET.has(name);
}

/** Pisahkan event sesuai katalog. Event non-katalog TIDAK di-insert. */
export function partitionEvents<T extends { name: string }>(
  events: T[],
): { valid: T[]; rejected: T[] } {
  const valid: T[] = [];
  const rejected: T[] = [];
  for (const ev of events) {
    if (ALLOWED_EVENT_SET.has(ev.name)) valid.push(ev);
    else rejected.push(ev);
  }
  return { valid, rejected };
}
