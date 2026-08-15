# TODO — FASE 4: Monetization & Financial Metrics

> Checklist Build → Verify → Review → Ship. Detil di `plan.md` + `FASE4-MONETIZATION-SPEC.md`.

## Build

- [ ] Task 1: Schema migration `schema/migration-2026-08-15-monetization.sql` (user_events, subscriptions, marketing_ad_spend)
  - Acceptance: idempotent (`IF NOT EXISTS`), `DECIMAL(12,2)`, index `(event_name, occurred_at)` & `(status, started_date)`
  - Verify: `psql "$CRDB_CONNECTION_URL" -f …` → `SHOW TABLES`
  - Files: schema/migration-2026-08-15-monetization.sql
- [ ] Task 2: Backend — `lambda/lib/monetization.ts` (calculateCAC + helpers), `lambda/handlers/events.ts` (POST /events), `lambda/handlers/monetization.ts` (GET cac + summary), routing handler.ts
  - Acceptance: allowlist 6 event; user_id dari server; zod; NULLIF; TDD dulu
  - Verify: `cd lambda && npm test` + `npx tsc --noEmit`
  - Files: lambda/lib/monetization.ts, lambda/handlers/events.ts, lambda/handlers/monetization.ts, lambda/handler.ts, lambda/tests/monetization.test.ts
- [ ] Task 3: SQL queries `schema/monetization-queries.sql` (MRR/ARR/ARPU/ARPPU/LTV/CAC/Churn/Checkout + varian Grafana)
  - Acceptance: semua denominator pakai NULLIF; time-series generate_series
  - Verify: psql jalan tanpa error, termasuk periode kosong
  - Files: schema/monetization-queries.sql
- [ ] Task 4: Seed `scripts/seed-monetization.ts` (6 bulan dummy: ad_spend, subscriptions, user_events funnel)
  - Verify: `npx tsx scripts/seed-monetization.ts` → count per tabel
  - Files: scripts/seed-monetization.ts
- [ ] Task 5: Frontend helper `src/shared/lib/trackEvent.ts` + `apiClient.trackEvent()`
  - Verify: `npm run typecheck`
  - Files: src/shared/lib/trackEvent.ts, src/shared/lib/apiClient.ts
- [ ] Task 6: Grafana `infra/grafana/monetization-dashboard.json` + `scripts/grafana-provision.sh`
  - Acceptance: 8 panel, datasource postgres idempotent, fail-loud tanpa API key
  - Verify: bash script → dashboard muncul
  - Files: infra/grafana/monetization-dashboard.json, scripts/grafana-provision.sh

## Verify

- [ ] `npm run typecheck` + `cd lambda && npx tsc --noEmit && npm test` hijau
- [ ] Apply schema live + `SHOW TABLES` (3 tabel baru)
- [ ] `npx tsx scripts/seed-monetization.ts`
- [ ] `scripts/build-lambda.sh` + `terraform plan`/`apply` → invoke events 201 + summary valid
- [ ] `scripts/grafana-provision.sh` → dashboard import, query valid

## Review

- [ ] code-review-and-quality multi-axis (SQL, auth, security, perf, kardinalitas)

## Ship

- [ ] ADR-002-monetization-schema.md
- [ ] PROGRESS.md section FASE 4
- [ ] .env.example tambah GRAFANA_URL + GRAFANA_API_KEY
- [ ] Commits Conventional (per langkah)
