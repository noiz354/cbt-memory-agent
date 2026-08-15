/**
 * Structured JSON Logger — jembatan korelasi Loki ↔ Tempo.
 *
 * Setiap baris log adalah JSON object dengan field stabil:
 *   { ts, level, event, msg, service, trace_id, span_id, ...fields }
 *
 * trace_id/span_id dibaca dari active span (OpenTelemetry Context) sehingga
 * sebuah log di Loki dapat di-*jump to trace* di Tempo dan sebaliknya.
 *
 * Aturan (dari security-and-hardening skill):
 *   - JANGAN pernah melempar secret/token/PII sebagai field.
 *   - Event name stabil (bukan interpolasi) agar queryable.
 *   - Output ke stdout — Lambda CloudWatch → Loki (via log group / collector).
 */

import { context, trace } from "@opentelemetry/api";

export type LogLevel = "debug" | "info" | "warn" | "error";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "cbt-memory-agent-backend";
const VERSION = "0.1.0";

/** Kunci yang TIDAK BOLEH pernah masuk log, berapapun nilainya. */
const DENYLIST_KEYS = /(^|\.)(password|passwd|secret|authorization|cookie|set-cookie|jwt|access_token|refresh_token|session_token|api[_-]?key|token_hash)(\.|$)/i;

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

interface SpanIds {
  traceId: string;
  spanId: string;
}

/** Baca trace_id/span_id dari active span (jika ada). */
function currentSpanIds(): SpanIds | null {
  const span = trace.getSpan(context.active());
  if (!span) return null;
  const ctx = span.spanContext();
  if (!ctx || !trace.isSpanContextValid(ctx)) return null;
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

function write(level: LogLevel, event: string, msg: string, fields: LogFields): void {
  const ids = currentSpanIds();
  const safeFields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (DENYLIST_KEYS.test(key)) {
      safeFields[key] = "[REDACTED]";
      continue;
    }
    safeFields[key] = value;
  }

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    msg,
    service: SERVICE_NAME,
    version: VERSION,
  };
  if (ids) {
    line.trace_id = ids.traceId;
    line.span_id = ids.spanId;
  }
  Object.assign(line, safeFields);

  // stdout — CloudWatch/Loki meng-ingest JSON line.
  process.stdout.write(JSON.stringify(line) + "\n");
}

export const logger = {
  debug(event: string, msg: string, fields: LogFields = {}): void {
    write("debug", event, msg, fields);
  },
  info(event: string, msg: string, fields: LogFields = {}): void {
    write("info", event, msg, fields);
  },
  warn(event: string, msg: string, fields: LogFields = {}): void {
    write("warn", event, msg, fields);
  },
  error(event: string, msg: string, fields: LogFields = {}): void {
    write("error", event, msg, fields);
  },
};
