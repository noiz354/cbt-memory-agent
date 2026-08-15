# Instrumentation Plan — Final (Full-Stack OTel → Grafana Tempo/Loki/Prometheus)

> Disusun: 2026-08-15 · Status: **APPROVED — in execution** · Skills: observability-and-instrumentation, security-and-hardening, TDD, incremental-implementation, source-driven-development, doubt-driven-development, ci-cd-and-automation, code-review-and-quality, documentation-and-adrs.

---

## Prinsip yang diterapkan dari skill

**`observability-and-instrumentation`** — definisikan "working" dulu:
> On-call questions yang harus bisa dijawab telemetri ini:
> 1. *Berapa % chat turn sukses vs gagal, dan di hop mana waktu hilang?*
> 2. *Saat request lambat/gagal, DB atau LLM/S3 penyebabnya?*
> 3. *Bisakah satu request dilacak utuh dari browser → Lambda → CRDB/LLM → log Loki?*
> Setiap signal (trace/metric/log) di bawah harus menjawab salah satu di atas.

**`security-and-hardening`** — pipeline telemetri = jalur kebocoran data klasik:
> Threat model: `traceparent` + `X-Trace-Id` + log JSON adalah jalur eksfiltrasi PII.
> Aturan: **allowlist field, bukan deny-by-omission**. Device ID, session UUID, email, token = PII/sensitive → wajib redaksi. Jangan pernah log body request.

---

## Keputusan terkunci

1. **Sampling**: Browser 100% (`VITE_OTEL_SAMPLING_RATIO=1.0`); head-sampler di relay `POST /api/v1/telemetry` (env `OTEL_RELAY_SAMPLING_RATIO`, default 1.0). Backend 100%.
2. **Boundary**: instrumentasi sekali di client wrapper (`crdb/s3/openrouter`) — nol polusi di business logic.
3. **Logger**: ganti semua titik `console.*` di `lambda/` → JSON logger ber-`trace_id`/`span_id`.

---

## Eksekusi bertahap

### Step A — Foundation `lambda/lib/telemetry.ts` + `lambda/lib/logger.ts`
- Semconv kaku (OTel semconv 1.43): `http.request.method`, `http.route`, `http.response.status_code`, `db.system`, `db.operation`, `server.address`. Hapus legacy `http.method`/`http.status_code`.
- Sanitizer terpusat di `startSpan`: denylist key (`authorization`, `token`, `password`, `email`, `phone`, `jwt`, `x-device-id`) + redaksi segmen UUID di `http.route`. ≤8 primitive attrs/span, tanpa complex JSON.
- `logger.ts` baru: `{ts, level, event, msg, service, trace_id, span_id}` dibaca dari `trace.getSpan(context.active())`. Stable event names. Jembatan **Loki↔Tempo**.

### Step B — Instrumentasi boundary via client wrapper
- `crdb.ts`: bungkus `query/queryOne/execute/executeCount` → span `db.query` (`db.system=cockroachdb`, `db.operation`, `db.sql.table` bila aman diekstrak).
- `s3.ts`: `uploadExport` → `rpc.system="aws.s3"`, `aws.s3.bucket`.
- `openrouter.ts`: `generateEmbedding` → `gen_ai.operation="embed"`.
- Hapus span ad-hoc `db.*` redundant di `chatTurn.ts` (jaga `agent.memory.retrieve`, `llm.openrouter`).
- RED metrics: histogram durasi per endpoint/dependency, label set kecil (`http.request.method`, status class `2xx/5xx`, `db.system`). Dilarang label user ID/URL.

### Step C — Response contract + context detachment
- `handler.ts`: **semua** response (termasuk 401/404) wajib `X-Trace-Id` + set `http.response.status_code` di root span.
- Frontend: tambah async context manager browser (`ZoneContextManager` dari `@opentelemetry/context-zone`).
- Workers (transcribe/face): **DEVASIASI** — tidak perlu injeksi `traceparent` via `postMessage`; worker (transcribe/face/audio/vad) tidak melakukan fetch outbound apa pun, jadi tidak ada yang dikorelasikan. Async context browser ditangani `ZoneContextManager`. Lihat ADR-001 poin 9.

### Step D — Tests (vitest di `lambda/`)
- `vitest.config.ts` + tsconfig test terpisah (un-exclude `*.test.ts`).
- Unit: logger menyuntikkan `trace_id`/`span_id` benar; sanitizer menghapus Authorization/token/UUID dari attrs.
- Integration: `handler()` + header `traceparent` → assert `X-Trace-Id === traceId` (termasuk 401/404).
- Contract statis: scan route di `handler.ts` → tiap endpoint mengembalikan `X-Trace-Id`.

### Step E — CI gate (`.github/workflows/deploy.yml`)
- Tambah: `npx tsc --noEmit` + `npm run typecheck:test` + `npm test` (lambda), `npm ci` + `npm run typecheck` + `npm run build` (frontend), semua sebelum terraform apply.
- Catatan: gate frontend sebenarnya adalah `npm run build` (`tsc -b`); `tsc --noEmit` di root tsconfig (`files: []`) adalah no-op. Build menangkap error nyata di `src/shared/lib/telemetry.ts` (API OTel v2: `spanProcessors` di constructor, `resourceFromAttributes`, headers factory async).

### Step F — Verifikasi telemetri itu sendiri
- `npx tsx scripts/verify_telemetry.ts` (roundtrip `X-Trace-Id` + Tempo query).
- Suntik error sengaja → cari di Loki lewat `trace_id`.
- Ikuti 1 request utuh di Tempo tanpa span patah.
- Spot-check: tidak ada JWT/email/UUID di span attrs maupun log JSON.

### Step G — Review & dokumentasi
- Review multi-axis; ADR singkat untuk keputusan sampling, semconv, redaksi.
- Commit per-langkah (A→F) dengan pesan konvensional.

---

## File yang disentuh
- `lambda/lib/{telemetry,logger,crdb,s3,openrouter}.ts`
- `lambda/handler.ts`, `lambda/handlers/*.ts` (log swap + hapus span redundant)
- `lambda/{vitest.config.ts,tsconfig.test.json,*.test.ts}`, `lambda/package.json`
- `src/shared/lib/telemetry.ts`, `src/main.tsx`, `src/workers/*Client.ts`
- `.env.example`, `scripts/verify_telemetry.ts`, `.github/workflows/deploy.yml`

## Verifikasi kelulusan
- [ ] Setiap log line JSON ber-`trace_id`/`span_id`, event name stabil
- [ ] Tidak ada secret/token/PII di span attributes atau log (spot-check)
- [ ] RED metrics ada, label set terbatas
- [ ] Satu request terlacak end-to-end tanpa span patah
- [ ] Semua response ber-`X-Trace-Id`
