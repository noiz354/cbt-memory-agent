/**
 * Unit test — telemetry sanitizer + label helpers (governance layer).
 *
 * Validasi:
 *   1. sanitizeAttributes: PII/secret keys dibuang, UUID di-redact, string >512
 *      char dibuang (jangan pernah bocor JWT/email/phone ke span attribute).
 *   2. statusClass: label terkunci 2xx/3xx/4xx/5xx (bukan status mentah).
 *   3. normalizeRoute: segmen UUID diganti ':id' (kontrol cardinality metric).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseOtlpHeaders,
  sanitizeAttributes,
  statusClass,
  normalizeRoute,
  StrippingExporter,
} from "../lib/telemetry";
import { handleTelemetryRelay } from "../handlers/telemetry";

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

// ─────────────────────────────────────────────
// handleTelemetryRelay — browser OTLP fan-out → Grafana + Phoenix
// ─────────────────────────────────────────────

interface RelayTestEnv {
  grafana?: string;
  grafanaHeaders?: string;
  phoenix?: string;
  phoenixHeaders?: string;
}

function setEnv(env: RelayTestEnv): void {
  if (env.grafana) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = env.grafana;
  else delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (env.grafanaHeaders) process.env.OTEL_EXPORTER_OTLP_HEADERS = env.grafanaHeaders;
  else delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (env.phoenix) process.env.PHOENIX_OTLP_ENDPOINT = env.phoenix;
  else delete process.env.PHOENIX_OTLP_ENDPOINT;
  if (env.phoenixHeaders) process.env.PHOENIX_OTLP_HEADERS = env.phoenixHeaders;
  else delete process.env.PHOENIX_OTLP_HEADERS;
}

function okResponse(status = 200): Response {
  return new Response(null, { status });
}

describe("handleTelemetryRelay", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okResponse(200));
    setEnv({
      grafana: "https://grafana-otlp.example",
      grafanaHeaders: "Authorization=Basic Z3JhZmFuYQ==",
      phoenix: "http://10.0.0.5:6006",
      phoenixHeaders: "Authorization=Bearer px-key",
    });
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).fetch;
  });

  function makeEvent(body: string): import("aws-lambda").APIGatewayProxyEvent {
    return {
      body,
      isBase64Encoded: false,
      headers: { "Content-Type": "application/x-protobuf", Authorization: "Bearer tok", "X-Device-Id": "dev" },
    } as unknown as import("aws-lambda").APIGatewayProxyEvent;
  }

  it("forwards the raw payload bytes to BOTH Grafana and Phoenix when Phoenix is configured", async () => {
    const res = await handleTelemetryRelay(makeEvent("raw-proto-bytes"));

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const calls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain("https://grafana-otlp.example/v1/traces");
    expect(calls).toContain("http://10.0.0.5:6006/v1/traces");

    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(Buffer.from(init.body as Buffer).toString("utf8")).toBe("raw-proto-bytes");
    }
  });

  it("keeps the browser successful (200) even if Phoenix is down, as long as Grafana succeeds", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("10.0.0.5")) return Promise.reject(new Error("phoenix unreachable"));
      return Promise.resolve(okResponse(200));
    });

    const res = await handleTelemetryRelay(makeEvent("raw-proto-bytes"));
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when Grafana (required sink) fails upstream", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("grafana-otlp")) return Promise.resolve(okResponse(503));
      return Promise.resolve(okResponse(200));
    });

    const res = await handleTelemetryRelay(makeEvent("raw-proto-bytes"));
    expect(res.statusCode).toBe(502);
  });

  it("returns 502 when Grafana throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await handleTelemetryRelay(makeEvent("raw-proto-bytes"));
    expect(res.statusCode).toBe(502);
  });

  it("POSTs only to Grafana when no Phoenix endpoint is configured", async () => {
    setEnv({ grafana: "https://grafana-otlp.example", grafanaHeaders: "Authorization=Basic Z3JhZmFuYQ==" });
    const res = await handleTelemetryRelay(makeEvent("raw-proto-bytes"));
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://grafana-otlp.example/v1/traces");
  });

  it("fans out the same protobuf Content-Type to both sinks", async () => {
    await handleTelemetryRelay(makeEvent("bytes"));
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-protobuf");
    }
  });
});

