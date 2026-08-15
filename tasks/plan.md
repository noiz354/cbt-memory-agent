# Implementation Plan: FASE 1-3 — Core Telemetry, UX Funnel, Retention & Cohort

> Sumber: `docs/15-8-26/FASE123-ANALYTICS-SPEC.md`. Alur: Define → Plan → Build → Verify → Review → Ship.
> Fondasi FASE 4 sudah live (user_events, subscriptions, marketing_ad_spend, dashboard monetization).

## Urutan implementasi (dependensi)

1. **DEFINE** — `docs/15-8-26/FASE123-ANALYTICS-SPEC.md` ✓
2. **Event catalog (FASE 1 backend)** — `lambda/lib/eventCatalog.ts`: katalog `TRACKED_EVENTS`
   per kategori (core/auth/chat/crisis/voice/memory/privacy/monetization). `partitionEvents` +
   `isAllowedEventName` pindah ke katalog; `ALLOWED_MONETIZATION_EVENTS` tetap di monetization.ts
   (kompatibilitas + tes FASE 4). Tanpa migrasi schema (event_name tanpa CHECK).
3. **FASE 1 frontend** — `src/shared/lib/telemetryEvents.ts` (`track()` typed) + wiring ~20 call-site
   (auth, onboarding, chat, crisis, voice, memory, session, export, purge) + `RouteTracker` page_view
   di `AppShell.tsx` + `app_launch`. Fix bug `metric.*` (wire yang dead: purge*/streamTruncated/
   crisisGroundingDone/crisisLifelineTap; fix `addNode` salah panggil graphLinkCreated).
4. **FASE 2 backend** — `lambda/lib/analytics.ts` + `lambda/handlers/analytics.ts`:
   `GET /api/v1/analytics/funnel?period=YYYY-MM-DD&steps=…` (distinct user/step + konversi NULLIF-safe).
5. **FASE 3 backend** — `GET /api/v1/analytics/activity?period=YYYY-MM` (DAU/WAU/MAU/stickyFactor) +
   `GET /api/v1/analytics/retention?period=YYYY-MM` (matrix kohort × bucket umur). SQL di
   `schema/analytics-queries.sql` (Grafana macro + standalone).
6. **Routing + contract** — `lambda/handler.ts` (3 route) + `handler.contract.test.ts`.
7. **Seed rework** — `scripts/seed-monetization.ts`: hapus `seed-*@example.com` (CASCADE), re-insert
   dengan `users.created_at` backdate per bulan join; emit event telemetry/funnel per user dengan
   drop-off tiap tahap; aktivitas bulanan per kohort dengan decay.
8. **Grafana** — `infra/grafana/analytics-dashboard.json` (uid `analytics`, reuse datasource
   `crdb-postgres`) + `scripts/grafana-provision.sh` diparametrize (import 2 dashboard).
9. **Verify** — typecheck ×2, vitest, seed, terraform apply, curl live, grafana provision + ds/query E2E.
10. **Review** — multi-axis. **Ship** — ADR-003, PROGRESS.md, tasks/, commits.

## Paralelisme

- (2) katalog dan (3) desain seed bisa jalan paralel (kontrak event di spec).
- (4) funnel dan (5) activity/retention bisa paralel setelah katalog.
- (8) dashboard JSON bisa ditulis paralel dengan (4)/(5) karena kontrak query di spec.
- (9) verify bergantung semua; (10) ship menunggu review.

## Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Division by zero di funnel/retention/sticky | `NULLIF` wajib semua denominator |
| Cohorts rusak (created_at=now()) | seed hapus+insert ulang dengan backdate |
| Event non-katalog tetap masuk | `partitionEvents` berbasis `TRACKED_EVENTS` (backend drop non-katalog) |
| Agregat lintas-user bocor ke user lain | dokumentasi di ADR (single-user/demo app); hardening follow-up |
| Double-tracking metric.* vs track() | satu call-site per event; `track()` dipanggil di tempat kejadian |
| Funnel count tergantung seed event | seed emit event funnel + drop-off deterministik |
| Grafana heatmap kohort butuh pivot | panel table dengan query matrix (bukan timeseries) |

## Checkpoint

- [x] vitest hijau (eventCatalog, analytics, monetization update, contract 3 route baru)
- [x] `npm run typecheck` + `npm run build` PASS (wiring frontend)
- [x] Seed idempoten; `users.created_at` ter-backdate; count event katalog masuk DB
- [x] `GET /api/v1/analytics/{funnel,activity,retention}` live, tanpa NaN
- [x] Dashboard `analytics` import + `/api/ds/query` E2E OK
- [x] Review disetujui → Ship (ADR-003, PROGRESS.md, commits)
