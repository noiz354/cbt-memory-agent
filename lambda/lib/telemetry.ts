/**
 * Backend OpenTelemetry — tracing + metrics + logs ekspor ke Grafana Cloud OTLP.
 *
 * Setup modul-scope sekali saat cold start (OpenTelemetry JS v2.x API):
 *   - TracerProvider (+ BatchSpanProcessor → OTLPTraceExporter → /v1/traces)
 *   - MeterProvider (+ PeriodicExportingMetricReader → /v1/metrics)
 *   - LoggerProvider (+ BatchLogRecordProcessor → /v1/logs)
 *
 * Konfigurasi dari env (dibaca otomatis oleh exporter Node):
 *   OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
 *
 * Relasi trace W3C:
 *   - extractTraceContext(headers): baca header `traceparent` dari event Lambda
 *   - startSpan(name, parent): buat child span dari parent context
 *   - flushTelemetry(): forceFlush semua provider sebelum lambda return
 *
 * Governance (dari security-and-hardening skill):
 *   - Semua attribute melewati sanitizer: denylist key sensitif + redaksi UUID.
 *   - Maksimal ~8 primitive attributes per span; tidak ada complex JSON payload.
 */

import {
  context,
  propagation,
  trace,
  metrics,
  Span,
  SpanStatusCode,
  TextMapGetter,
  Context,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as OTLPProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader, MeterProvider } from "@opentelemetry/sdk-metrics";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
  ATTR_DB_SYSTEM_NAME,
  ATTR_DB_OPERATION_NAME,
} from "@opentelemetry/semantic-conventions";
import {
  ATTR_GEN_AI_SYSTEM,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_RPC_SYSTEM,
} from "@opentelemetry/semantic-conventions/incubating";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "cbt-memory-agent-backend";
const SERVICE_VERSION = "0.1.0";

/**
 * Atribut payload LLM yang boleh berisi prompt/response asli. Spans yang dikirim ke
 * Arize Phoenix menyertakan ini (untuk render input/output di UI), TAPI atribut ini
 * DI-STRIP dari ekspor menuju Grafana Tempo — prompt tidak boleh bocor ke dashboard
 * observability pihak ketiga/perusahaan.
 */
const LLM_PAYLOAD_ATTRIBUTE_KEYS =
  /^(gen_ai\.(request|response)\.|input\.value|output\.value|llm\.(input|output)_messages)/;

/**
 * Parse format env OTel `Authorization=Bearer <key>,OtherKey=value` → record.
 * Nilai boleh mengandung `=` (mis. token JWT/base64), jadi split hanya pada `=` pertama.
 */
export function parseOtlpHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

/**
 * Wrapper SpanExporter yang men-strip atribut payload LLM sebelum ekspor.
 * Dipakai membungkus exporter Grafana sehingga dual-sink tetap mengirim span
 * yang sama, namun versi ke Grafana bebas prompt/response (governance).
 */
export class StrippingExporter {
  constructor(
    private readonly inner: import("@opentelemetry/sdk-trace-base").SpanExporter,
    private readonly stripper: (key: string) => boolean,
  ) {}

  export(
    spans: import("@opentelemetry/sdk-trace-base").ReadableSpan[],
    resultCallback: (result: import("@opentelemetry/core").ExportResult) => void,
  ): void {
    const cleaned = spans.map((span) => {
      const attributes = { ...span.attributes };
      for (const key of Object.keys(attributes)) {
        if (this.stripper(key)) delete attributes[key];
      }
      const clone = Object.assign(
        Object.create(Object.getPrototypeOf(span)),
        span,
        { attributes },
      );
      return clone;
    });
    return this.inner.export(cleaned, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

let tracerProvider: TracerProvider | null = null;
let meterProvider: MeterProvider | null = null;
let loggerProvider: LoggerProvider | null = null;
let logger: ReturnType<LoggerProvider["getLogger"]> | null = null;
let initialized = false;

/**
 * Header getter kompatibel dengan W3C propagator — header Lambda sudah lowercase.
 */
const headerGetter: TextMapGetter<Record<string, string>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key.toLowerCase()] ?? undefined,
};

/** Inisialisasi provider sekali saat cold start. No-op jika endpoint tidak diset. */
export function setupTelemetry(): void {
  if (initialized) return;
  initialized = true;

  const grafanaEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const phoenixEndpoint = process.env.PHOENIX_OTLP_ENDPOINT;
  const phoenixHeaders = process.env.PHOENIX_OTLP_HEADERS;
  if (!grafanaEndpoint && !phoenixEndpoint) {
    console.warn("[otel] no OTLP endpoint set — telemetry disabled");
    return;
  }

  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]: SERVICE_VERSION,
  });

  try {
    // Context manager penting: tanpa ini `context.active()` di async callbacks
    // selalu ROOT_CONTEXT → logger tidak pernah dapat trace_id/span_id.
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());

    // Traces — dual-sink:
    //   Grafana: HTTP/JSON, atribut payload LLM DI-STRIP (governance — prompt tidak
    //            boleh bocor ke dashboard perusahaan/third-party).
    //   Phoenix: HTTP/protobuf, atribut payload PENUH (prompt/response) utk LLM
    //            observability di UI Phoenix. Aktif hanya jika endpoint diset.
    const spanProcessors: BatchSpanProcessor[] = [];

    if (grafanaEndpoint) {
      spanProcessors.push(
        new BatchSpanProcessor({
          exporter: new StrippingExporter(new OTLPTraceExporter(), (key) =>
            LLM_PAYLOAD_ATTRIBUTE_KEYS.test(key),
          ),
          exportTimeoutMillis: 8000,
        }),
      );
    }

    if (phoenixEndpoint && phoenixHeaders) {
      spanProcessors.push(
        new BatchSpanProcessor({
          exporter: new OTLPProtoTraceExporter({
            url: `${phoenixEndpoint.replace(/\/+$/, "")}/v1/traces`,
            headers: parseOtlpHeaders(phoenixHeaders),
          }),
          exportTimeoutMillis: 8000,
        }),
      );
    }

    tracerProvider = new TracerProvider({
      resource,
      spanProcessors,
    });
    trace.setGlobalTracerProvider(tracerProvider);

    // Metrics
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: 60_000,
          exportTimeoutMillis: 8000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    // Logs
    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter(),
          exportTimeoutMillis: 8000,
        }),
      ],
    });
    logger = loggerProvider.getLogger(SERVICE_NAME, SERVICE_VERSION);

    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    console.log(
      `[otel] telemetry enabled → grafana=${grafanaEndpoint ? "on" : "off"}, phoenix=${phoenixEndpoint ? "on" : "off"} (service=${SERVICE_NAME})`,
    );
  } catch (err) {
    console.error("[otel] setup failed — telemetry disabled:", err);
    tracerProvider = null;
    meterProvider = null;
    loggerProvider = null;
    logger = null;
  }
}

/** Extract W3C trace context dari header Lambda (lowercase keys). */
export function extractTraceContext(headers: Record<string, string>): Context {
  if (!initialized) return context.active();
  return propagation.extract(context.active(), headers ?? {}, headerGetter);
}

export interface ChildSpanOptions {
  attributes?: Record<string, string | number | boolean | undefined>;
}

/** Kunci attribute yang TIDAK BOLEH pernah masuk ke span (PII/secret). */
const DENYLIST_KEYS = /(^|\.)(authorization|password|passwd|secret|jwt|access_token|refresh_token|session_token|email|phone|phone_number|x-device-id)(\.|$)/i;

/** Redaksi UUID (v4/canonical) di nilai attribute — mencegah identitas bocor. */
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Sanitizer attribute span (governance layer).
 * - Kunci sensitif → dihapus total (tidak pernah masuk ke eksport).
 * - Nilai mengandung UUID → di-redaksi jadi `<redacted>`.
 */
export function sanitizeAttributes(
  attributes: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (DENYLIST_KEYS.test(key)) continue;
    if (typeof value === "string") {
      const redacted = value.replace(UUID_PATTERN, "<redacted>");
      // Atribut payload LLM (prompt/response) bisa panjang — beri batas besar utk
      // lintas ke Phoenix; selain itu tetap cap ketat 512 utk metadata biasa.
      const cap = LLM_PAYLOAD_ATTRIBUTE_KEYS.test(key) ? 32_768 : 512;
      if (redacted.length > cap) continue;
      out[key] = redacted;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Mulai span baru sebagai child dari parent context. Return [span, ctx]. */
export function startSpan(
  name: string,
  parentCtx: Context,
  opts: ChildSpanOptions = {},
): [Span, Context] {
  const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);
  const span = tracer.startSpan(
    name,
    { attributes: sanitizeAttributes(opts.attributes ?? {}) },
    parentCtx,
  );
  const ctx = trace.setSpan(parentCtx, span);
  return [span, ctx];
}

/** Wraps async fn dalam span; mencatat exception & status pada error. */
export async function withSpan<T>(
  name: string,
  parentCtx: Context,
  fn: (span: Span, ctx: Context) => Promise<T>,
  opts: ChildSpanOptions = {},
): Promise<T> {
  const [span, ctx] = startSpan(name, parentCtx, opts);
  try {
    return await context.with(ctx, () => fn(span, ctx));
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}

/** Emit log record OTLP (metadata saja — JANGAN log payload/PII). */
export function emitLog(
  severityNumber: SeverityNumber,
  body: string,
  attributes: Record<string, string | number | boolean> = {},
  ctx: Context = context.active(),
): void {
  if (!logger) return;
  try {
    logger.emit({
      body,
      severityNumber,
      attributes: sanitizeAttributes(attributes),
      context: ctx,
    });
  } catch (err) {
    console.error("[otel] emitLog failed:", err);
  }
}

/** Force-flush semua provider agar data terkirim sebelum Lambda selesai. */
export async function flushTelemetry(): Promise<void> {
  if (!initialized) return;
  await Promise.allSettled([
    tracerProvider?.forceFlush().catch(() => undefined),
    meterProvider?.forceFlush().catch(() => undefined),
    loggerProvider?.forceFlush().catch(() => undefined),
  ]);
}

export function isTelemetryEnabled(): boolean {
  return initialized && tracerProvider !== null;
}

// ─────────────────────────────────────────────
// RED Metrics (Rate / Errors / Duration)
// Label set TERTUTUP — tidak boleh user ID / URL / message.
// ─────────────────────────────────────────────

let httpDuration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]> | null = null;
let dbDuration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]> | null = null;
let genAiDuration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]> | null = null;
let s3Duration: ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]> | null = null;
let httpErrors: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]> | null = null;
let appErrors: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]> | null = null;

function getMeter(): ReturnType<typeof metrics.getMeter> | null {
  if (!meterProvider) return null;
  try {
    return metrics.getMeter(SERVICE_NAME, SERVICE_VERSION);
  } catch {
    return null;
  }
}

function ensureMetrics(): void {
  const meter = getMeter();
  if (!meter || httpDuration) return;
  httpDuration = meter.createHistogram("http.server.request.duration", {
    description: "Duration of inbound HTTP requests",
    unit: "ms",
  });
  httpErrors = meter.createCounter("http.server.request.errors", {
    description: "Count of HTTP requests with error status (>=400)",
    unit: "1",
  });
  appErrors = meter.createCounter("app.error.count", {
    description: "Count of classified application errors by code/category",
    unit: "1",
  });
  dbDuration = meter.createHistogram("db.client.operation.duration", {
    description: "Duration of CockroachDB operations",
    unit: "ms",
  });
  genAiDuration = meter.createHistogram("gen_ai.client.operation.duration", {
    description: "Duration of OpenRouter (LLM) operations",
    unit: "ms",
  });
  s3Duration = meter.createHistogram("aws.s3.operation.duration", {
    description: "Duration of S3 operations",
    unit: "ms",
  });
}

/** Status class (2xx/3xx/4xx/5xx) — label terkunci, bukan status mentah. */
export function statusClass(code: number): string {
  return `${Math.floor(code / 100)}xx`;
}

/**
 * Normalisasi route untuk label metric — batasi cardinality:
 * segmen UUID (session/memory id) diganti `:id`, query string dibuang.
 */
export function normalizeRoute(path: string): string {
  const withoutQuery = path.split("?")[0];
  const segments = withoutQuery.split("/").map((seg) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? ":id" : seg,
  );
  return segments.join("/");
}

/** Record durasi + error count sebuah HTTP request (dipanggil di handler.ts). */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number,
): void {
  ensureMetrics();
  httpDuration?.record(durationMs, {
    [ATTR_HTTP_REQUEST_METHOD]: method,
    [ATTR_HTTP_ROUTE]: route,
    "http.response.status_code.class": statusClass(statusCode),
  });
  if (statusCode >= 400) {
    httpErrors?.add(1, {
      [ATTR_HTTP_REQUEST_METHOD]: method,
      [ATTR_HTTP_ROUTE]: route,
      "http.response.status_code.class": statusClass(statusCode),
    });
  }
}

/** Record durasi operasi DB (dipanggil di crdb.ts wrapper). */
export function recordDbOperation(operation: string, durationMs: number): void {
  ensureMetrics();
  dbDuration?.record(durationMs, {
    [ATTR_DB_SYSTEM_NAME]: "cockroachdb",
    [ATTR_DB_OPERATION_NAME]: operation,
  });
}

/** Record durasi operasi GenAI (dipanggil di openrouter.ts wrapper). */
export function recordGenAiOperation(operation: string, durationMs: number): void {
  ensureMetrics();
  genAiDuration?.record(durationMs, {
    [ATTR_GEN_AI_SYSTEM]: "openrouter",
    [ATTR_GEN_AI_OPERATION_NAME]: operation,
  });
}

/** Record durasi operasi S3 (dipanggil di s3.ts wrapper). */
export function recordS3Operation(operation: string, durationMs: number): void {
  ensureMetrics();
  s3Duration?.record(durationMs, {
    [ATTR_RPC_SYSTEM]: "aws.s3",
    "aws.s3.operation": operation,
  });
}

/**
 * Record error terklasifikasi (dipanggil di reportError pada errors.ts).
 * Label TERTUTUP — hanya error.code & category dari katalog ERROR_CODES,
 * bukan pesan bebas / user ID / URL.
 */
export function recordError(code: string, category: string, statusCode: number): void {
  ensureMetrics();
  appErrors?.add(1, {
    "error.code": code,
    "error.category": category,
    "http.response.status_code.class": statusClass(statusCode),
  });
}
