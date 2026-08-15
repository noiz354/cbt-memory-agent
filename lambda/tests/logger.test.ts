/**
 * Unit test — structured JSON logger (Loki ↔ Tempo correlation).
 *
 * Validasi:
 *   1. Setiap baris log adalah JSON dengan field stabil (ts/level/event/msg/service).
 *   2. trace_id/span_id ter-inject dari active span (korelasi ke Tempo).
 *   3. Kunci sensitif di-redact → tidak pernah bocor ke log.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { logger } from "../lib/logger";

function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write");
  spy.mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return writes.join("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("emits a JSON line with stable fields", () => {
    const out = captureStdout(() => {
      logger.info("health.check", "healthy", { crdb: "connected" });
    });

    const line = JSON.parse(out);
    expect(line).toMatchObject({
      level: "info",
      event: "health.check",
      msg: "healthy",
      service: "cbt-memory-agent-backend",
      crdb: "connected",
    });
    expect(typeof line.ts).toBe("string");
    expect(new Date(line.ts).getTime()).not.toBeNaN();
  });

  it("injects trace_id and span_id from the active span", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("test.span");

    const out = captureStdout(() => {
      context.with(trace.setSpan(context.active(), span), () => {
        logger.info("chat.turn_failed", "upstream error", { status: 502 });
      });
    });
    span.end();

    const line = JSON.parse(out);
    expect(line.trace_id).toBe(span.spanContext().traceId);
    expect(line.span_id).toBe(span.spanContext().spanId);
    expect(line.event).toBe("chat.turn_failed");
  });

  it("omits trace_id when no span is active", () => {
    const out = captureStdout(() => {
      logger.warn("cors.missing_origin", "ALLOWED_ORIGIN not set");
    });

    const line = JSON.parse(out);
    expect(line.trace_id).toBeUndefined();
    expect(line.span_id).toBeUndefined();
  });

  it("redacts sensitive fields", () => {
    const out = captureStdout(() => {
      logger.info("auth.callback", "ok", {
        authorization: "Bearer secret-jwt",
        api_key: "sk-live-123",
        session_token: "abc123",
        token_hash: "deadbeef",
        safe_field: "keep-me",
      });
    });

    const line = JSON.parse(out);
    expect(line.authorization).toBe("[REDACTED]");
    expect(line.api_key).toBe("[REDACTED]");
    expect(line.session_token).toBe("[REDACTED]");
    expect(line.token_hash).toBe("[REDACTED]");
    expect(line.safe_field).toBe("keep-me");
  });

  it("skips undefined fields entirely", () => {
    const out = captureStdout(() => {
      logger.debug("memory.list_failed", "n/a", { maybe: undefined, ok: 1 });
    });

    const line = JSON.parse(out);
    expect(line.ok).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(line, "maybe")).toBe(false);
  });
});
