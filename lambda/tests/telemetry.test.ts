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
import {
  parseOtlpHeaders,
  sanitizeAttributes,
  statusClass,
  normalizeRoute,
  StrippingExporter,
} from "../lib/telemetry";

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

  it("allows long LLM payload attributes (prompt/response) up to a larger cap", () => {
    const prompt = "x".repeat(20_000);
    const out = sanitizeAttributes({ "gen_ai.request.input": prompt });
    expect(out["gen_ai.request.input"]).toBe(prompt);
  });

  it("still drops long non-payload attributes", () => {
    const big = "x".repeat(600);
    const out = sanitizeAttributes({ "http.request.body": big });
    expect(out).toEqual({});
  });

  it("redacts UUIDs inside long LLM payload text", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const out = sanitizeAttributes({ "gen_ai.response.text": `payload ${uuid} end` });
    expect(out["gen_ai.response.text"]).toBe("payload <redacted> end");
  });
});

describe("parseOtlpHeaders", () => {
  it("parses a single Authorization header value containing =", () => {
    const out = parseOtlpHeaders("Authorization=Bearer eyJhbGciOiJIUzI1NiJ9.signature");
    expect(out).toEqual({ Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.signature" });
  });

  it("parses multiple comma-separated headers", () => {
    const out = parseOtlpHeaders("Authorization=Bearer abc, X-Env=prod, X-Empty=");
    expect(out).toEqual({ Authorization: "Bearer abc", "X-Env": "prod" });
  });

  it("skips malformed pairs", () => {
    const out = parseOtlpHeaders("=novalue, X-Env=prod");
    expect(out).toEqual({ "X-Env": "prod" });
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

/**
 * Mimes struktur runtime SpanImpl dari @opentelemetry/sdk-trace:
 * `attributes`, `status`, `startTime`, `endTime`, `name`, `kind` = field own
 * enumerable; `spanContext()` = method di class prototype (bukan own property).
 * Regression guard: StrippingExporter tidak boleh membuang prototype via spread,
 * karena otlp-transformer memanggil `span.spanContext()` (internal.js:21).
 */
class FakeReadableSpan {
  attributes: Record<string, unknown>;
  status = { code: 1 };
  startTime = [0, 0];
  endTime = [0, 0];
  name = "fake.span";
  kind = 2;
  private _spanContext = { traceId: "aaa", spanId: "bbb", traceFlags: 1 };

  constructor(attributes: Record<string, unknown>) {
    this.attributes = attributes;
  }

  spanContext() {
    return this._spanContext;
  }
}

function captureExport(batch: unknown[]): StrippingExporter {
  const inner = {
    export(
      spans: import("@opentelemetry/sdk-trace-base").ReadableSpan[],
      cb: (result: import("@opentelemetry/core").ExportResult) => void,
    ) {
      batch.push(...(spans as unknown[]));
      cb({ code: 0 });
    },
    async shutdown() {},
  };
  return new StrippingExporter(inner, (key) => /^(gen_ai\.(request|response)\.|input\.value|output\.value)/.test(key));
}

describe("StrippingExporter", () => {
  it("preserves the span prototype so spanContext() survives to the inner exporter", () => {
    const received: unknown[] = [];
    const exporter = captureExport(received);
    const span = new FakeReadableSpan({ "gen_ai.request.input": "prompt" });
    exporter.export([span as unknown as import("@opentelemetry/sdk-trace-base").ReadableSpan], () => {});
    expect(received).toHaveLength(1);
    const out = received[0] as FakeReadableSpan;
    expect(typeof out.spanContext).toBe("function");
    expect(out.spanContext()).toEqual({ traceId: "aaa", spanId: "bbb", traceFlags: 1 });
    expect(typeof out.status).toBe("object");
  });

  it("strips LLM payload attributes but keeps the rest", () => {
    const received: unknown[] = [];
    const exporter = captureExport(received);
    const span = new FakeReadableSpan({
      "gen_ai.request.input": "prompt",
      "gen_ai.response.text": "reply",
      "input.value": "nested prompt",
      "openinference.span.kind": "LLM",
      "db.operation": "select",
    });
    exporter.export([span as unknown as import("@opentelemetry/sdk-trace-base").ReadableSpan], () => {});
    const out = received[0] as { attributes: Record<string, unknown> };
    expect(out.attributes).toEqual({ "openinference.span.kind": "LLM", "db.operation": "select" });
  });

  it("does not mutate the source span attributes (safe for the Phoenix sink)", () => {
    const received: unknown[] = [];
    const exporter = captureExport(received);
    const span = new FakeReadableSpan({ "gen_ai.request.input": "prompt", ok: "keep" });
    exporter.export([span as unknown as import("@opentelemetry/sdk-trace-base").ReadableSpan], () => {});
    expect(span.attributes).toEqual({ "gen_ai.request.input": "prompt", ok: "keep" });
  });
});
