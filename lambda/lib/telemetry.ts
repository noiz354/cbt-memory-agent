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
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader, MeterProvider } from "@opentelemetry/sdk-metrics";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "cbt-memory-agent-backend";
const SERVICE_VERSION = "0.1.0";

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

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.warn("[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set — telemetry disabled");
    return;
  }

  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]: SERVICE_VERSION,
  });

  try {
    // Traces
    tracerProvider = new TracerProvider({
      resource,
      spanProcessors: [
        new BatchSpanProcessor({
          exporter: new OTLPTraceExporter(),
          exportTimeoutMillis: 8000,
        }),
      ],
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
    console.log(`[otel] telemetry enabled → ${endpoint} (service=${SERVICE_NAME})`);
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

/** Mulai span baru sebagai child dari parent context. Return [span, ctx]. */
export function startSpan(
  name: string,
  parentCtx: Context,
  opts: ChildSpanOptions = {},
): [Span, Context] {
  const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);
  const span = tracer.startSpan(name, { attributes: opts.attributes ?? {} }, parentCtx);
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
    logger.emit({ body, severityNumber, attributes, context: ctx });
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
