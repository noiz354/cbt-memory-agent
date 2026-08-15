# Implementation Plan: FASE 4 — Monetization & Financial Metrics

> Sumber: `docs/15-8-26/FASE4-MONETIZATION-SPEC.md` (APPROVED). Alur: Define → Plan → Build → Verify → Review → Ship.

## Urutan implementasi (dependensi)

1. **Schema** — `schema/migration-2026-08-15-monetization.sql` (3 tabel). Fondasi semua.
2. **Backend lib + handler** — `lambda/lib/monetization.ts`, `lambda/handlers/events.ts`,
   `lambda/handlers/monetization.ts`, routing di `lambda/handler.ts`. TDD (tes dulu).
3. **SQL queries** — `schema/monetization-queries.sql` (metrik + varian Grafana).
4. **Seed** — `scripts/seed-monetization.ts` (dummy 6 bulan).
5. **Frontend helper** — `src/shared/lib/trackEvent.ts` + `apiClient.trackEvent()`.
6. **Grafana** — `infra/grafana/monetization-dashboard.json` + `scripts/grafana-provision.sh`.
7. **Verify** — typecheck, vitest, apply schema, seed, build+terraform, curl, grafana provision.
8. **Review** — multi-axis. **Ship** — ADR, PROGRESS.md, .env.example, commits.

## Paralelisme

- Setelah schema + event contract fix: (2) backend dan (3) SQL queries bisa paralel.
- (6) dashboard JSON bisa ditulis paralel dengan (2) karena kontrak query sudah di spec.
- (7) verify bergantung semua; (8) ship menunggu review.

## Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Division by zero di query | `NULLIF` wajib di semua denominator |
| Event non-allowlist / payload rusak | zod + allowlist server-side |
| PII bocor ke event JSONB | whitelist properties + dokumentasi larangan |
| Dashboard Grafana butuh API key | fail-loud di provision script; user isi `GRAFANA_API_KEY` |
| CockroachDB via PostgreSQL datasource beda dukungan makro | makro dasar `$__timeFilter`; verifikasi langsung di panel |
| Lambda redeploy merusak endpoint existing | `terraform plan` sebelum apply; zip lama sebagai rollback |

## Checkpoint

- [ ] Schema apply → `SHOW TABLES` memuat 3 tabel baru
- [ ] vitest hijau (termasuk contract test route baru)
- [ ] `POST /events` 201 live; summary tanpa NaN
- [ ] Dashboard import + query valid
- [ ] Review disetujui → Ship (commit, docs)
