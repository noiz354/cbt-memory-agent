# TODO — FASE 1-3: Core Telemetry, UX Funnel, Retention & Cohort

> Checklist Build → Verify → Review → Ship. Detil di `plan.md` + `FASE123-ANALYTICS-SPEC.md`.

## Build

- [x] Task 1: `lambda/lib/eventCatalog.ts` — katalog `TRACKED_EVENTS` per kategori; `partitionEvents`/`isAllowedEventName` pindah; `ALLOWED_MONETIZATION_EVENTS` tetap export di monetization.ts
  - Acceptance: katalog ⊇ 6 monetisasi; tanpa duplikat; nama valid; backend drop non-katalog
  - Verify: `cd lambda && npm test` (eventCatalog.test.ts baru + monetization.test.ts update)
  - Files: lambda/lib/eventCatalog.ts, lambda/lib/monetization.ts, lambda/tests/eventCatalog.test.ts, lambda/tests/monetization.test.ts
- [x] Task 2: Frontend FASE 1 — `src/shared/lib/telemetryEvents.ts` + wire ~20 call-site + `RouteTracker` (AppShell) + `app_launch` + fix metric.* bug
  - Acceptance: `track()` typed; satu panggilan per event; page_view per navigasi
  - Verify: `npm run typecheck` + `npm run build`
  - Files: src/shared/lib/telemetryEvents.ts, src/app/layout/AppShell.tsx, authStore.ts, OnboardingPage.tsx, chatStore.ts, ChatPage.tsx, CrisisOverlay.tsx, CrisisFusionBridge.tsx, SwipeToCall.tsx, GroundingGame.tsx, voiceNote.ts, HoldToTalkOrb.tsx, memoryStore.ts, MemoryPage.tsx, sessionStore.ts, SessionsPage.tsx, exportBundle.ts, hardPurge.ts, DestructionKey.tsx, metrics.ts
- [x] Task 3: Backend FASE 2+3 — `lambda/lib/analytics.ts` + `lambda/handlers/analytics.ts` (funnel/activity/retention) + routing
  - Acceptance: distinct user/step; konversi + sticky + retensi NULLIF-safe; period validation
  - Verify: `cd lambda && npm test` (analytics.test.ts baru) + `npx tsc --noEmit`
  - Files: lambda/lib/analytics.ts, lambda/handlers/analytics.ts, lambda/handler.ts, lambda/tests/analytics.test.ts, lambda/tests/handler.contract.test.ts
- [x] Task 4: SQL — `schema/analytics-queries.sql` (funnel, DAU/WAU/MAU, cohort retention, sticky; Grafana + standalone)
  - Acceptance: semua denominator NULLIF; `date_trunc`; kolom `time`
  - Verify: psql jalan tanpa error (periode kosong tetap OK)
  - Files: schema/analytics-queries.sql
- [x] Task 5: Seed — `scripts/seed-monetization.ts` diperluas: delete `seed-*` (CASCADE) → insert ulang backdate created_at + event telemetry/funnel + aktivitas kohort decay
  - Verify: `npx tsx scripts/seed-monetization.ts` → count per tabel + created_at tersebar
  - Files: scripts/seed-monetization.ts
- [x] Task 6: Grafana — `infra/grafana/analytics-dashboard.json` (uid analytics) + parametrize `scripts/grafana-provision.sh` (import 2 dashboard)
  - Verify: bash script → dashboard `analytics` muncul
  - Files: infra/grafana/analytics-dashboard.json, scripts/grafana-provision.sh

## Verify

- [x] `npm run typecheck` + `npm run build` hijau
- [x] `cd lambda && npx tsc --noEmit && npm test` hijau
- [x] `npx tsx scripts/seed-monetization.ts` → users.created_at backdate + event katalog ada
- [x] `scripts/build-lambda.sh` + `terraform plan`/`apply` → curl live funnel/activity/retention (tanpa NaN)
- [x] `scripts/grafana-provision.sh` → dashboard `analytics` import, `/api/ds/query` E2E OK

## Review

- [x] code-review-and-quality multi-axis + security-and-hardening (agregat lintas-user → dokumentasi)

## Ship

- [x] ADR-003-analytics.md
- [x] PROGRESS.md section FASE 1-3
- [x] Commits Conventional (per langkah)
