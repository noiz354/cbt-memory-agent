/**
 * Unit test — telemetry sanitizer + label helpers (governance layer).
 *
 * Validasi:
 *   1. sanitizeAttributes: PII/secret keys dibuang, UUID di-redact, string >512
 *      char dibuang (jangan pernah bocor JWT/email/phone ke span attribute).
 *   2. statusClass: label terkunci 2xx/3xx/4xx/5xx (bukan status mentah).
 *   3. normalizeRoute: segmen UUID diganti ':id' (kontrol cardinality metric).
 */

import { describe, expect, it } from "vitest";
import { sanitizeAttributes, statusClass, normalizeRoute } from "../lib/telemetry";

describe("sanitizeAttributes", () => {
  it("drops sensitive keys entirely", () => {
    const out = sanitizeAttributes({
      authorization: "Bearer abc.def",
      password: "hunter2",
      email: "user@example.com",
      phone: "0812-3456-7890",
      "x-device-id": "device-1",
      ok: "keep",
    });
    expect(out).toEqual({ ok: "keep" });
  });

  it("redacts UUID values anywhere in a string", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const out = sanitizeAttributes({ "http.route": `/api/v1/session/${uuid}/turns`, "memory.id": uuid });
    expect(out["http.route"]).toBe("/api/v1/session/<redacted>/turns");
    expect(out["memory.id"]).toBe("<redacted>");
  });

  it("drops string attributes longer than 512 chars", () => {
    const big = "x".repeat(600);
    const out = sanitizeAttributes({ big });
    expect(out).toEqual({});
  });

  it("keeps numbers and booleans", () => {
    const out = sanitizeAttributes({ count: 3, enabled: true });
    expect(out).toEqual({ count: 3, enabled: true });
  });

  it("drops undefined values", () => {
    const out = sanitizeAttributes({ a: undefined, b: "x" });
    expect(out).toEqual({ b: "x" });
  });
});

describe("statusClass", () => {
  it("maps status codes to bounded class labels", () => {
    expect(statusClass(200)).toBe("2xx");
    expect(statusClass(204)).toBe("2xx");
    expect(statusClass(301)).toBe("3xx");
    expect(statusClass(401)).toBe("4xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(500)).toBe("5xx");
    expect(statusClass(503)).toBe("5xx");
  });
});

describe("normalizeRoute", () => {
  it("replaces UUID segments with :id", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(normalizeRoute(`/api/v1/session/${uuid}/turns`)).toBe("/api/v1/session/:id/turns");
    expect(normalizeRoute(`/api/v1/memory/edge/${uuid}`)).toBe("/api/v1/memory/edge/:id");
  });

  it("strips the query string", () => {
    expect(normalizeRoute("/api/v1/memory?limit=20")).toBe("/api/v1/memory");
  });

  it("leaves plain routes unchanged", () => {
    expect(normalizeRoute("/api/v1/health")).toBe("/api/v1/health");
    expect(normalizeRoute("/api/v1/chat/turn")).toBe("/api/v1/chat/turn");
  });
});
