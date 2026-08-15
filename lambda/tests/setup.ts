/**
 * Test setup — jalankan sebelum tiap file test.
 *
 * Menyiapkan provider telemetry NYATA (tanpa exporter) agar span yang dibuat
 * di handler/lib benar-benar memiliki trace_id/span_id yang valid, sehingga
 * contract test traceparent → X-Trace-Id bisa diverifikasi secara end-to-end.
 */

import { context, trace, propagation } from "@opentelemetry/api";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

// Hindari ekspor OTLP selama test (tanpa exporter → no-op flush).
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
process.env.OTEL_SERVICE_NAME = "cbt-memory-agent-backend";

context.setGlobalContextManager(new AsyncLocalStorageContextManager());
trace.setGlobalTracerProvider(new TracerProvider());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
