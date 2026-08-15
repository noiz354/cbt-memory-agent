# Spec: FASE 1-3 — Core Telemetry, UX Funnel, Retention & Cohort

- **Status**: Draft (untuk review)
- **Date**: 2026-08-15
- **Prior**: FASE 4 (Monetization) sudah live — `user_events` + `subscriptions` + `marketing_ad_spend`, event allowlist 6 monetisasi, endpoint `/api/v1/events` (batch ≤50), `/api/v1/monetization/*`, dashboard Grafana `monetization`.

## Objective

FASE 1–3 hackathon belum ada di repo: **Core Telemetry**, **UX Funnel**, **Retention & Cohort**.
Tujuannya mengubah `user_events` dari sekadar 6 event monetisasi menjadi event stream produk
penuh, lalu menghitung funnel aktivasi dan retensi kohort untuk dashboard Grafana.

- FASE 1 (Core Telemetry): katalog event terpusat + wiring telemetri di semua call-site frontend.
- FASE 2 (UX Funnel): funnel aktivasi signup → onboarding → first chat → session final, NULLIF-safe.
- FASE 3 (Retention & Cohort): DAU/WAU/MAU, sticky factor, dan matrix retensi per kohort bulan.

## Tech Stack / Constraints

- Backend: Lambda Node 22 TS (`lambda/`), pg via `CrdbClient` (parameterized, `query<T>`/`queryOne<T>`/`execute`).
- DB: CockroachDB `woozy-grivet`. Semua angka `::numeric` (DECIMAL/NUMERIC), setiap pembagian `NULLIF(denominator,0)`.
- Frontend: React + Vite TS; buffer `src/shared/lib/trackEvent.ts` sudah siap (batch 50 / flush 10s / pagehide), belum ada call-site.
- `user_events.event_name` TANPA CHECK → perluasan event murni perubahan backend (allowlist), tanpa migrasi schema.
- Frontend TIDAK punya vitest → verifikasi frontend = `npm run typecheck` + `npm run build`.
- `users.created_at` = anchor kohort; seed saat ini set `created_at=now()` untuk semua → wajib di-backdate.

## Commands

- Typecheck frontend: `npm run typecheck` (tsc --noEmit)
- Typecheck lambda: `cd lambda && npx tsc --noEmit`
- Tes lambda: `cd lambda && npm test` (vitest)
- Build frontend: `npm run build`
- Seed: `npx tsx scripts/seed-monetization.ts` (diperluas jadi seed analytics+monetization)
- Deploy: `export PATH="$PATH:/home/norman2/bin" && terraform init && terraform plan -var-file=terraform.tfvars -out=tfplan && terraform apply tfplan` (perlu `aws login --profile aws-x-cdb` dulu)
- Grafana: `bash scripts/grafana-provision.sh` (butuh GRAFANA_URL + GRAFANA_API_KEY di .env)

## Project Structure

```
lambda/lib/eventCatalog.ts       → (baru) katalog TRACKED_EVENTS per kategori + isAllowedEventName + partitionEvents
lambda/lib/analytics.ts          → (baru) funnel / DAU/WAU/MAU / cohort retention / sticky factor
lambda/handlers/analytics.ts     → (baru) GET /api/v1/analytics/{funnel,activity,retention}
lambda/tests/eventCatalog.test.ts→ (baru)
lambda/tests/analytics.test.ts   → (baru)
schema/analytics-queries.sql     → (baru) query Grafana + standalone
scripts/seed-monetization.ts     → diperluas: backdate created_at, event telemetry, aktivitas kohort
src/shared/lib/telemetryEvents.ts→ (baru) layer track() typed
infra/grafana/analytics-dashboard.json → (baru) uid analytics
```

## Code Style

Ikuti pola yang sudah ada (`lambda/handlers/events.ts`, `monetization.ts`):
- Handler = `handleX(...)` return `APIGatewayProxyResult` via helper `json()` lokal (konvensi duplikasi lokal).
- SQL selalu parameterized; monetari `::numeric::text` dari pg; helper `toNum()`.
- Komentar deskriptif bahasa Indonesia, `@param`/JSDoc untuk fungsi publik.
- Frontend: `track()` dari `telemetryEvents.ts` dipanggil satu kali per event di tempat kejadian (pola `metric.*`).

Contoh (backend lib):
```ts
export async function getFunnelSteps(crdb: CrdbClient, start: Date, end: Date): Promise<FunnelStep[]> {
  const rows = await crdb.query<{ step: string; users: string }>(`
    SELECT step, users::int::text AS users FROM (
      SELECT 'signup_completed' AS step, COUNT(DISTINCT user_id) AS users
      FROM user_events WHERE event_name='signup_completed' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
      UNION ALL SELECT 'onboarding_completed', COUNT(DISTINCT user_id) FROM user_events WHERE event_name='onboarding_completed' AND ...
    ) t ORDER BY ...`, [start.toISOString(), end.toISOString()]);
  return rows.map(r => ({ step: r.step, users: toNum(r.users) }));
}
```

## Testing Strategy

- **Lambda (vitest)**: `eventCatalog.test.ts` (katalog lengkap + kategori, allowlist monetisasi ⊂ katalog, tanpa duplikat, validasi nama); `analytics.test.ts` (funnel step counts + konversi, DAU/WAU/MAU/sticky dari mock, retention matrix + NULLIF div-0, handler status/validasi period); `monetization.test.ts` diperbarui (partitionEvents pakai katalog).
- `handler.contract.test.ts`: tambah 3 route baru ke required-routes list.
- **Frontend**: tidak ada vitest → verifikasi `tsc --noEmit` + `vite build` (wiring harus typecheck).

## Boundaries

- **Always**: NULLIF(denominator,0); parameterized SQL; event masuk katalog sebelum dipakai; backdate `users.created_at` di seed; `track()` dipanggil tepat satu kali per kejadian.
- **Ask first**: perubahan schema `user_events` (tidak perlu — tanpa CHECK); hapus event FASE 4; ubah respons API yang sudah live.
- **Never**: commit .env/secrets; query float untuk uang; agregat lintas-user tanpa dokumentasi (catatan keamanan).

## Success Criteria

1. `GET /api/v1/analytics/funnel?period=YYYY-MM-DD` → array step + konversi antar-step, tanpa NaN/Infinity (NULLIF-safe).
2. `GET /api/v1/analytics/activity?period=YYYY-MM` → {dau, wau, mau, stickyFactor} finite.
3. `GET /api/v1/analytics/retention?period=YYYY-MM` → matrix kohort (cohort bulan `users.created_at`) × bucket umur, % aktif kembali.
4. Katalog `TRACKED_EVENTS` berisi semua event FASE 4 (6) + FASE 1-3 (~22), `partitionEvents` memakainya.
5. Frontend: semua ~20 call-site ter-wire + RouteTracker `page_view`; `npm run typecheck` + `npm run build` PASS.
6. Seed idempoten: hapus akun `seed-*` (CASCADE) → insert ulang dengan created_at backdate + event funnel/aktivitas.
7. Dashboard Grafana `analytics` (uid) terimport; provisioning terparametrize; `/api/ds/query` E2E OK.

## Open Questions

- ~~Grafana: dashboard terpisah vs gabung~~ → **terpisah** (uid `analytics`).
- ~~Scope wiring FASE 1~~ → **semua ~20 call-site**.
- ~~Frontend unit test~~ → **tetap tsc+build** (tanpa vitest baru).
- Keamanan agregat lintas-user: dokumentasi di ADR; hardening follow-up.
