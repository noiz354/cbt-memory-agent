# ADR-008: Error Standardization & Propagation (CloudWatch + LGTM)

- **Status**: Accepted
- **Date**: 2026-08-18
- **Deciders**: Principal Observability Engineer (agent), per observability-and-instrumentation + security-and-hardening skills

## Context

Sebelum ADR ini, error handling backend 100% ad-hoc: setiap handler menangkap exception sendiri, menulis `logger.error('<domain.action>_failed', ...)` dengan 40+ nama event berbeda, lalu mengembalikan `{ statusCode, body: { error: 'Human string' } }` tanpa kode error, tanpa taxonomy, tanpa metric, dan tanpa envelope yang bisa dikonsumsi frontend. Konsekuensi: error yang sama direport secara inkonsisten (sulit di-query di CloudWatch/Loki), tidak ada metrik error per-code di Mimir, frontend hanya melihat `err.message` mentah (misal "Failed to fetch" yang tidak bisa didiagnosa — Bug-2), dan beberapa handler bahkan membocorkan `err.message` internal ke client (export.ts).

## Decision

1. **Taxonomy tunggal** di `lambda/lib/errors.ts`: katalog `ERROR_CODES` (kode stabil ber-titik per domain) memetakan tiap kode ke `{ statusCode, category, retriable, level, message }`. Kategori: `client`, `validation`, `dependency`, `internal`. Level hanya `warn` (kesalahan client yang diharapkan, tidak perlu halaman pertolongan) atau `error` (butuh investigasi).
2. **Envelope standar** keluar ke client hanya `{ error: { code, message, retriable } }`. `details`, `cause`, `statusCode`, `category` TIDAK pernah keluar — hanya `reportError` yang mencatatnya.
3. **Choke point tunggal** `reportError(err, { span?, route? })` — tepat SATU emisi per kegagalan: `logger.error` (stdout → CloudWatch) + `emitLog` (OTLP → Loki) + `recordError` (counter `app.error.count` → Mimir) + `span.recordException` + `span.setStatus(ERROR)` (→ Tempo). Semua handler tidak lagi menulis `logger.error` sendiri untuk error yang di-throw.
4. **Error skema tetap**: handler melempar/konversi via `new AppError(code, { message?, cause?, details? })` atau `fail(code)`; catch-all terpusat di `handler.ts` memakai `classifyError` → unrecognized apa pun menjadi `internal.unhandled` (500, retriable).
5. **SSE chatTurn dipertahankan**: frame `{ error: true, code: "chat_turn_failed", message: ERROR_CODES["chat.turn_failed"].message }` + `data: [DONE]` — kontrak wire TIDAK berubah (test-critical).
6. **Frontend klasifikasi** di `src/shared/lib/errors.ts`: `ApiError` + `classifyFetchError` memetakan `TypeError: Failed to fetch` → `network.unreachable` (mengaburkan CORS/CSP), `AbortError` → `network.request_aborted`, `BackendErrorFrame` → `chat.turn_failed`, `RateLimitError` → `internal` retriable; `apiErrorFromResponse` membaca envelope `{error:{code,message,retriable}}` dari backend. Toast error (mis. CameraPip "Index failed") kini menampilkan pesan diagnosable.
7. **RED tetap dipertahankan**: `http.server.request.errors` (status class 4xx/5xx) + `app.error.count` baru (label tertutup: `error.code`, `error.category`, `http.response.status_code.class`).

## Taxonomy (ringkasan katalog `lambda/lib/errors.ts`)

| Kode | Status | Kategori | Retriable | Level |
|---|---|---|---|---|
| `auth.missing_token` / `auth.missing_device` / `auth.invalid_token` | 401 | client | no | warn |
| `validation.invalid_json` / `validation.invalid_request` | 400 | validation | no | warn |
| `validation.payload_too_large` | 413 | client | no | warn |
| `resource.not_found` | 404 | client | no | warn |
| `resource.misconfigured` | 501 | internal | no | error |
| `dependency.db_unavailable` / `dependency.llm_unavailable` / `dependency.s3_unavailable` | 503 | dependency | yes | error |
| `dependency.telemetry_unavailable` | 502 | dependency | yes | error |
| `media.presign_failed` / `media.upload_failed` / `media.save_failed` / `media.delete_failed` | 500 | internal | yes | error |
| `media.not_found` | 404 | client | no | warn |
| `chat.turn_failed` | 500 | internal | yes | error |
| `memory.*` / `session.*` / `turns.list_failed` / `semantic.search_failed` / `events.track_failed` / `export.failed` / `purge.failed` / `reflection.failed` | 500 | internal | var | error |
| `internal.unhandled` | 500 | internal | yes | error |

## Envelope contract

```
HTTP/1.1 503 Service Unavailable
X-Trace-Id: <hex32>

{ "error": { "code": "dependency.db_unavailable", "message": "Service temporarily unavailable", "retriable": true } }
```

Frontend memetakan `error.code` ke `ERROR_CODES` lokal; kode tak dikenal turun ke `internal`.

## Choke point (reportError)

```
reportError(err, { span, route })
 ├─ classifyError(err) → AppError
 ├─ logger.error(code, message, { code, category, status, retriable, route?, cause? })  → CloudWatch
 ├─ emitLog(ERROR, '[code] message', same fields)                                        → Loki
 ├─ recordError(code, category, status) → app.error.count                               → Mimir
 └─ span.recordException(cause ?? err) + span.setStatus(ERROR, {message: code})          → Tempo
```

Satu request gagal kini terlacak: status + exception + log JSON ber-`trace_id`/`span_id` + metric per kode.

## Consequences

**Positif**: error terstandar (queryable, kode stabil); metric error per-kode + kategori siap alerting; frontend toast diagnosable (Bug-2 "Index failed" kini menampilkan penyebab CORS/CSP/network); tidak ada lagi leak `err.message` ke client; CI gate (vitest + tsc + build) menjaga kontrak.

**Negatif**: nama event log berubah dari ad-hoc (`attachments.presign_failed` dst) menjadi kode katalog (`internal.unhandled` dsb.) untuk error yang di-throw tanpa kode eksplisit — dashboard Lama yang menyaring nama event lama perlu pembaruan; satu kali refactor besar di 12 handler.

## Files touched

- `lambda/lib/errors.ts` (baru), `lambda/lib/telemetry.ts` (+`recordError`)
- `lambda/handler.ts` (central catch + auth 401 + notFound)
- `lambda/handlers/{attachments,chatTurn,memory,session,turns,semanticSearch,events,export,purge,auth,telemetry}.ts`
- `src/shared/lib/errors.ts` (baru), `src/shared/lib/apiClient.ts`, `src/features/chat/components/CameraPip.tsx`
- `lambda/tests/errors.test.ts` (baru), `src/shared/lib/errors.test.ts` (baru)

## Verified

- Test counts: lambda 157 passed (17 files, +15 errors.test); root 87 passed (12 files, +11 errors.test).
- `lambda`: `npm run typecheck:test` + `npx tsc --noEmit` + `npm test` PASS · `npm run build` PASS.
- `root`: `npm run typecheck` + `npm test` + `npm run build` PASS.
- Contoh output nyata `reportError`: `{"level":"error","event":"internal.unhandled","code":"internal.unhandled","category":"internal","status":500,"retriable":true,"route":"/api/v1/chat/turn","cause":"db down"}`.
- CloudWatch metric filter: `scripts/setup-cloudwatch.sh` menambah `error.failed_count` (`{ $.level = 'error' }`) + alarm.