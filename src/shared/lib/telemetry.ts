/**
 * Frontend OpenTelemetry — browser tracing ekspor via relay backend.
 *
 * Setup: WebTracerProvider + FetchInstrumentation (auto-inject W3C `traceparent`
 * ke setiap fetch) + OTLP exporter → relay `POST /api/v1/telemetry`.
 * Token Grafana TIDAK pernah ada di bundle browser — relay server-side.
 *
 * Environment (VITE_*):
 *   VITE_OTEL_ENABLED=true
 *   VITE_OTEL_TRACE_ENDPOINT=/api/v1/telemetry   (relative → di-resolve ke location.origin)
 *   VITE_OTEL_SAMPLING_RATIO=0.1
 */

import { context, trace, Span, SpanStatusCode, Context } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { getAuthHeaders } from "./authSession";

let tracerProvider: WebTracerProvider | null = null;
let initialized = false;

const SERVICE_NAME = "cbt-memory-agent-frontend";

function resolveEndpoint(raw: string | undefined): string {
  if (!raw) return `${location.origin}/api/v1/telemetry`;
  if (raw.startsWith("http")) return raw;
  return `${location.origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

/**
 * Inisialisasi sekali sebelum app render. Idempotent + no-op jika disabled.
 * FetchInstrumentation membungkus `window.fetch` dan otomatis:
 *   - menciptakan span per HTTP request
 *   - menginjeksi header W3C `traceparent` → backend meneruskan trace yang sama
 */
export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  if (import.meta.env.VITE_OTEL_ENABLED !== "true") return;

  const samplingRatio = Number(import.meta.env.VITE_OTEL_SAMPLING_RATIO ?? 1.0);
  // Browser meng-ekspor 100% span boundary; sampling head dilakukan di relay
  // POST /api/v1/telemetry (env OTEL_RELAY_SAMPLING_RATIO) — pengganti Collector.
  const ratio = Number.isFinite(samplingRatio) && samplingRatio > 0 ? samplingRatio : 1.0;

  const exporter = new OTLPTraceExporter({
    url: resolveEndpoint(import.meta.env.VITE_OTEL_TRACE_ENDPOINT),
    headers: async (): Promise<Record<string, string>> => {
      const auth = getAuthHeaders();
      return auth ? { Authorization: `Bearer ${auth.token}`, "X-Device-Id": auth.deviceId } : {};
    },
  });

  tracerProvider = new WebTracerProvider({
    resource: resourceFromAttributes({ [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  tracerProvider.register({
    propagator: new W3CTraceContextPropagator(),
    // ZoneContextManager menyebarkan trace context melintasi async boundaries
    // (setTimeout, promise, fetch callback) di browser — menjamin span yang
    // dibuat di call stack berbeda tetap anak dari trace yang sama.
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        // traceparent harus dikirim ke semua origin backend (Lambda Function URL)
        propagateTraceHeaderCorsUrls: [/.*/],
        ignoreUrls: [/\/api\/v1\/telemetry$/],
      }),
    ],
  });
}

export function isTelemetryEnabled(): boolean {
  return tracerProvider !== null;
}

export function getTracer() {
  return trace.getTracer(SERVICE_NAME, "0.1.0");
}

export interface SpanOptions {
  attributes?: Record<string, string | number | boolean | undefined>;
}

/** Wraps an async function in a child span of the current active context. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  opts: SpanOptions = {},
): Promise<T> {
  // Always create the span via the tracer. When telemetry is disabled (no provider
  // registered), getTracer() returns the NoopTracer whose startSpan yields a
  // NonRecordingSpan — every Span method is a safe no-op. Never pass a bare {}
  // here: callers (e.g. onDeviceLLM) call span.setAttribute and would throw.
  const tracer = getTracer();
  const span = tracer.startSpan(name, { attributes: opts.attributes ?? {} });
  const ctx: Context = trace.setSpan(context.active(), span);
  try {
    return await context.with(ctx, () => fn(span));
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}
