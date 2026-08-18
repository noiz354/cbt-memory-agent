/**
 * Unit tests — event catalog (FASE 1 Core Telemetry).
 *
 * Memverifikasi katalog sebagai single source of truth: tanpa duplikat,
 * nama valid, kategori valid, mencakup semua event FASE 4 + FASE 1-3, dan
 * partitionEvents memakai katalog (event non-katalog di-drop).
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_EVENTS,
  EVENT_CATEGORIES,
  TRACKED_EVENTS,
  isAllowedEventName,
  partitionEvents,
} from "../lib/eventCatalog";
import { ALLOWED_MONETIZATION_EVENTS } from "../lib/monetization";

describe("event catalog", () => {
  it("has no duplicate event names", () => {
    const names = TRACKED_EVENTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all names are snake_case lowercase", () => {
    const re = /^[a-z0-9_]+$/;
    for (const e of TRACKED_EVENTS) {
      expect(e.name, e.name).toMatch(re);
    }
  });

  it("every category is declared", () => {
    const cats = new Set<string>(EVENT_CATEGORIES);
    for (const e of TRACKED_EVENTS) {
      expect(cats.has(e.category), `${e.name} → ${e.category}`).toBe(true);
    }
  });

  it("every category has at least one event", () => {
    const byCat = new Map<string, number>();
    for (const e of TRACKED_EVENTS) byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
    for (const c of EVENT_CATEGORIES) {
      expect(byCat.get(c) ?? 0, `category ${c}`).toBeGreaterThan(0);
    }
  });

  it("ALLOWED_EVENTS mirrors TRACKED_EVENTS", () => {
    expect(ALLOWED_EVENTS).toEqual(TRACKED_EVENTS.map((e) => e.name));
  });

  it("includes all 6 FASE 4 monetization events", () => {
    for (const name of ALLOWED_MONETIZATION_EVENTS) {
      expect(ALLOWED_EVENTS).toContain(name);
    }
  });

  it("includes FASE 1-3 core/telemetry events", () => {
    for (const name of ["app_launch", "page_view", "signup_completed", "login_completed", "onboarding_completed",
      "session_started", "message_sent", "stream_done", "stream_truncated", "session_finalized", "session_interrupted",
      "crisis_triggered", "crisis_resolved", "crisis_grounding_done", "crisis_lifeline_used",
      "voice_note_recorded", "transcript_received", "transcript_failed",
      "memory_added", "memory_updated", "memory_deleted", "memory_searched", "memory_edge_linked",
      "attachment_failed",
      "export_completed", "purge_completed"]) {
      expect(ALLOWED_EVENTS, name).toContain(name);
    }
  });

  it("isAllowedEventName matches catalog", () => {
    expect(isAllowedEventName("page_view")).toBe(true);
    expect(isAllowedEventName("login_completed")).toBe(true);
    expect(isAllowedEventName("evil_event")).toBe(false);
  });

  it("tracks transcription and attachment failures (P0 observability)", () => {
    for (const name of ["transcript_failed", "attachment_failed"]) {
      expect(ALLOWED_EVENTS, name).toContain(name);
    }
    expect(isAllowedEventName("transcript_failed")).toBe(true);
    expect(isAllowedEventName("attachment_failed")).toBe(true);
  });

  it("partitionEvents drops non-catalog events", () => {
    const { valid, rejected } = partitionEvents([
      { name: "page_view" },
      { name: "checkout_started" },
      { name: "nope" },
    ]);
    expect(valid.map((e) => e.name)).toEqual(["page_view", "checkout_started"]);
    expect(rejected.map((e) => e.name)).toEqual(["nope"]);
  });
});
