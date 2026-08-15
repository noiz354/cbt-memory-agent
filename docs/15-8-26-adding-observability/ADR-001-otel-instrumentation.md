# ADR-001: Instrumentasi OpenTelemetry Enterprise pada Boundary (Grafana Stack)

- **Status**: Accepted
- **Date**: 2026-08-15
- **Deciders**: Principal Observability Engineer (agent), per INSTRUMENTATION-PLAN-FINAL.md

## Context

Backend Lambda (`lambda/`) dan frontend (Vite/React) butuh observability end-to-end untuk Grafana Stack (Tempo, Loki, Prometheus). Masalah sebelum ADR ini: console.* plain-text (tanpa korelasi trace_id), hampir semua boundary (DB/S3/LLM) tidak di-instrumentasi, PII/UUID bocor ke span attributes, `setupTelemetry()` tidak meregistrasi context manager Node (logger tidak akan pernah dapat trace_id di Lambda asli), dan tidak ada tes maupun CI gate untuk kontrak telemetry.

## Decision

1. **Instrumentasi hanya di architectural boundaries** (inbound middleware, outbound client wrappers) — nol polusi di business logic. Wrapper: `lambda/lib/crdb.ts` (span `db.query`), `lambda/lib/s3.ts` (`aws.s3.operation`), `lambda/lib/openrouter.ts` (`llm.embedding`).
2. **Hanya pure OpenTelemetry API** di business code; exporter config (OTLP endpoints/headers) di-encapsulate di `lambda/lib/telemetry.ts` dan dapat diganti tanpa menyentuh handlers.
3. **Hot Path Zero-Allocation**: atribut primitif saja, ≤512 char, span dihapus dari chatTurn inner-loop (`db.persist` redundant dengan crdb wrapper). Collector offloading: backend ekspor 100% span; browser ekspor 100% (sampling ratio default 1.0), head-sampling dipindah ke relay `POST /api/v1/telemetry` (`OTEL_RELAY_SAMPLING_RATIO`).
4. **PII Redaction**: `sanitizeAttributes()` (telemetry.ts) + denylist di `logger.ts` — key authorization/password/token/email/phone/x-device-id dibuang, UUID di-redact, JWT tidak pernah masuk span/log. Semconv stable (http.request.method, http.response.status_code, db.system.name, db.operation.name) + experimental via subpath `/incubating`.
5. **RED metrics** (Prometheus/Grafana): http.server.request.duration, db.client.operation.duration, gen_ai.client.operation.duration, aws.s3.operation.duration, http.server.request.errors; label cardinality dibatasi (status class `2xx`/`5xx`, route dinormalisasi UUID→`:id`, tidak ada user ID).
6. **Context Detachment**: backend `AsyncLocalStorageContextManager` (fix bug kritis — logger membaca `context.active()`); frontend `ZoneContextManager` (`@opentelemetry/context-zone`) untuk async boundaries browser.
7. **JSON logger** (`lambda/lib/logger.ts`): stable fields ts/level/event/msg/service/version + `trace_id`/`span_id` dari active span → korelasi Loki↔Tempo.
8. **Response contract**: SEMUA response (termasuk 401/404/500) membawa `X-Trace-Id` + `http.response.status_code`.
9. **Worker deviation**: Web Workers (transcribe/face/audio/vad) TIDAK dipasang traceparent — mereka tidak melakukan outbound fetch, jadi tidak ada yang dikorelasikan; async context browser ditangani ZoneContextManager.
10. **Tes + CI gate**: vitest (22 tes: logger, sanitizer/statusClass/normalizeRoute, handler contract — runtime 401/404/traceparent roundtrip + static route scan), frontend `tsc -b` + `vite build` (gate sebenarnya; `tsc --noEmit` root no-op), deploy.yml menjalankan semua sebelum terraform apply.

## Consequences

**Positif**: korelasi trace↔log end-to-end (Loki↔Tempo via trace_id/span_id); RED metrics siap Prometheus; kontrak trace diproteksi tes + CI; PII/UUID tidak bocor; vendor SDK mudah diganti.

**Negatif**: wrapper spans menambah overhead per query (diukur, kecil); `@opentelemetry/context-zone` menambah zona bundle; verifikasi live E2E (`scripts/verify_telemetry.ts`) hanya bisa jalan setelah deploy (butuh BACKEND_URL + GRAFANA_TEMPO_* yang bukan default).

## Verified

- `npx tsc --noEmit` (lambda) ✓ · `npm run typecheck:test` ✓ · `npm test` → 22 passed ✓
- `npm run build` (frontend) `tsc -b && vite build` ✓
