# Spec: FASE 4 — Tracking Monetization & Financial Metrics

> Status: **DRAFT → APPROVED** (2026-08-15) · Alur: Define → Plan → Build → Verify → Review → Ship
> Repo: `cbt-memory-agent` · Stack: React+Vite TS (`src/`) · Lambda Node 22 TS (`lambda/`) · CockroachDB (`woozy-grivet`) · Grafana Cloud (stack 1494299)

## 1. Objective

Membangun infrastruktur pelacakan transaksi, skema agregasi keuangan, dan query
Grafana untuk mengukur metrik monetisasi utama: **MRR, ARR, ARPU, ARPPU, LTV,
CAC, Checkout Abandonment Rate, Revenue Churn Rate, LTV:CAC Ratio**.

FASE 1–3 (Core Telemetry, UX Funnel, Retention & Cohort) tidak ada di repo ini,
jadi fondasi `user_events` + event tracking ikut dibangun agar FASE 4
**self-contained**.

**Sukses =** semua metrik di atas bisa dihitung dengan SQL murni terhadap
CockroachDB, divisualisasikan di dashboard Grafana Cloud, diuji dengan data
dummy, dan tidak pernah error saat denominator nol (`NULLIF`).

## 2. Capability Map

| Capability | Output | Dependensi |
|---|---|---|
| C1 Event Ingestion | `user_events` + `POST /api/v1/events` | auth, CRDB |
| C2 Subscription Data | `subscriptions` table | CRDB |
| C3 Ad Spend | `marketing_ad_spend` table | CRDB |
| C4 Monetization Computation | SQL queries + `monetization` lib (CAC, MRR, …) | C1–C3 |
| C5 Grafana Delivery | PostgreSQL datasource + dashboard JSON | C4, Grafana API key |
| C6 Mock & Verify | seed script + verifikasi live | C1–C5 |
| C7 Frontend Hook (minimal) | `trackEvent` helper + `apiClient.trackEvent()` | C1 |

## 3. Kontrak Data

### 3.1 Tabel

```sql
user_events (
  id UUID PK default gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name STRING NOT NULL,                 -- allowlist, lihat 3.2
  event_properties JSONB,                     -- skema per event, lihat 3.3
  session_id STRING,
  device_id STRING,
  occurred_at TIMESTAMPTZ default now(),
  INDEX user_events_user_idx (user_id),
  INDEX user_events_name_occurred_idx (event_name, occurred_at)
)

subscriptions (
  id UUID PK default gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id STRING NOT NULL,
  status STRING NOT NULL CHECK (status IN ('active','canceled','past_due','trialing','expired')),
  amount DECIMAL(12,2) NOT NULL,              -- nominal per billing_cycle
  currency STRING NOT NULL DEFAULT 'USD',
  billing_cycle STRING NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  started_date TIMESTAMPTZ NOT NULL,
  ended_date TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ default now(),
  updated_at TIMESTAMPTZ default now(),
  INDEX subscriptions_user_idx (user_id),
  INDEX subscriptions_status_started_idx (status, started_date)
)

marketing_ad_spend (
  id UUID PK default gen_random_uuid(),
  period_date DATE NOT NULL,
  channel STRING NOT NULL,
  cost DECIMAL(12,2) NOT NULL,
  currency STRING NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ default now(),
  UNIQUE (period_date, channel)
)
```

Mata uang SELALU `DECIMAL(12,2)` / `NUMERIC` — **tidak pernah** float.

### 3.2 Event allowlist (C1)

| event_name | arti |
|---|---|
| `checkout_started` | user mulai flow checkout |
| `checkout_completed` | user menyelesaikan flow checkout |
| `payment_succeeded` | pembayaran diterima gateway |
| `payment_failed` | pembayaran ditolak/diperbaiki (backend/gateway) |
| `subscription_upgraded` | upgrade plan / addon (positif) |
| `subscription_cancelled` | pembatalan / downgrade (negatif MRR) |

### 3.3 Skema `event_properties` (JSONB)

| event | properties yang wajib dibaca query |
|---|---|
| `checkout_started` | `{ plan_id, billing_cycle, amount }` |
| `checkout_completed` | `{ plan_id, billing_cycle, amount }` |
| `payment_succeeded` | `{ plan_id, amount, subscription_id }` |
| `payment_failed` | `{ plan_id, amount, error_code }` |
| `subscription_upgraded` | `{ old_plan_id, new_plan_id, delta_amount, amount }` |
| `subscription_cancelled` | `{ plan_id, amount, reason, is_downgrade }` |

`delta_amount` dipakai untuk Expansion MRR (upgrade) dan Churned MRR (cancel/downgrade).

## 4. Kontrak API (C1, C4)

Semua route dibelakang `validateAuth` (middleware existing). `user_id` ditentukan
SERVER dari `validateAuth` → DB (`session_token` lookup; fallback legacy `md5(token)::uuid`).

| Route | Method | Body | Respon |
|---|---|---|---|
| `/api/v1/events` | POST | `{ events: [{ name, properties?, sessionId?, occurredAt? }] }` (max 50 batch) | `201 { inserted, rejected }` |
| `/api/v1/monetization/cac` | GET | `?period=YYYY-MM-DD` | `200 { period, spend, newPayingUsers, cac }` (cac `null` jika newPayingUsers=0) |
| `/api/v1/monetization/summary` | GET | `?period=YYYY-MM-DD` | `200 { mrr, arr, arpu, arppu, ltv, ltvCac, revenueChurnRate, checkoutAbandonmentRate, failedPaymentRate, grossMargin, churnRate }` |

Aturan: event_name TIDAK di-allowlist → ditolak batch (tidak di-insert), bukan error seluruh batch.
Validasi zod; parameterized query; tanpa PII di `event_properties` (hanya plan_id/amount/error_code).

## 5. Definisi Metrik (C4)

Semua query memakai `NULLIF(denominator, 0)`. `gross_margin` & `churn_rate`
adalah parameter (bisa di-set sebagai variable Grafana; default `0.70` dan nilai
revenue-churn).

| Metrik | Formula (SQL-native) |
|---|---|
| MRR (level) | `SUM(monthly_amount)` subscriptions aktif di bulan; `monthly_amount = amount` bila monthly, `amount/12` bila yearly |
| ARR | `MRR * 12` |
| New MRR | MRR dari `subscriptions.started_date` di bulan |
| Expansion MRR | `SUM(event_properties->>'delta_amount')` `subscription_upgraded` di bulan (>0) |
| Churned MRR | `-SUM(event_properties->>'amount')` `subscription_cancelled` di bulan + delta negatif downgrade |
| ARPU | `revenue / COUNT(DISTINCT active user)` (MAU dari `user_events`/`users.last_active`) |
| ARPPU | `revenue / COUNT(DISTINCT paying user)` (punya sub aktif) |
| LTV | `(ARPU * gross_margin) / NULLIF(churn_rate, 0)` |
| LTV:CAC | `LTV / NULLIF(CAC, 0)` |
| CAC | `SUM(marketing_ad_spend.cost) / NULLIF(COUNT(DISTINCT paying user baru di periode), 0)` |
| Revenue Churn Rate | `Churned MRR bulan ini / NULLIF(MRR awal bulan, 0) * 100` |
| Checkout Abandonment | `(checkout_started - checkout_completed) / NULLIF(checkout_started, 0) * 100` |
| Failed Payment Rate | `payment_failed / NULLIF(payment_failed + payment_succeeded, 0) * 100` |

## 6. Commands

```
Typecheck frontend : npm run typecheck
Typecheck lambda   : cd lambda && npx tsc --noEmit
Test lambda        : cd lambda && npm test
Build lambda zip   : scripts/build-lambda.sh          # → lambda/cbt-memory-agent.zip
Terraform plan     : cd infra && terraform plan       # (butuh aws-login, lihat docs/DAILY-LOGIN-AWS.md)
Terraform apply    : cd infra && terraform apply
Apply schema live  : psql "$CRDB_CONNECTION_URL" -f schema/migration-2026-08-15-monetization.sql
Seed dummy data    : npx tsx scripts/seed-monetization.ts
Provision Grafana  : bash scripts/grafana-provision.sh # butuh GRAFANA_URL + GRAFANA_API_KEY di .env
```

## 7. Project Structure

```
schema/migration-2026-08-15-monetization.sql   → DDL 3 tabel (idempotent)
schema/monetization-queries.sql                → query metrik + varian Grafana
lambda/handlers/events.ts                      → POST /api/v1/events
lambda/handlers/monetization.ts                → GET /monetization/cac + /summary
lambda/lib/monetization.ts                     → calculateCAC + helpers (pure, pakai crdb)
lambda/tests/monetization.test.ts              → vitest (CAC division-by-zero, dsb.)
scripts/seed-monetization.ts                   → dummy data 6 bulan (tsx)
infra/grafana/monetization-dashboard.json      → dashboard Grafana (8 panel)
scripts/grafana-provision.sh                   → datasource + dashboard via HTTP API
src/shared/lib/trackEvent.ts                   → frontend helper (minimal)
docs/15-8-26/FASE4-MONETIZATION-SPEC.md        → dokumen ini
docs/15-8-26-adding-observability/ADR-002-monetization-schema.md → keputusan arsitektur
```

## 8. Code Style

Ikuti pola existing repo (handler.ts routing, CrdbClient parameterized, zod, OTel span di lib):
`lambda/lib/monetization.ts` membungkus query memakai `crdb.query`/`queryOne`; nama fungsi
camelCase; konstanta event allowlist `ALLOWED_MONETIZATION_EVENTS`. SQL parameterized
(`$1`), tidak pernah interpolasi string.

## 9. Testing Strategy

- `lambda/tests/monetization.test.ts` (vitest, mock `CrdbClient`):
  - `calculateCAC` → 0 new paying users ⇒ `cac === null` (bukan NaN/Infinity)
  - `calculateCAC` → hitung benar (spend / paying users)
  - allowlist events: reject non-allowlist, terima 6 event valid
  - validate payload zod: batch >50 ditolak, properties non-object ditolak
- Contract test existing (`handler.contract.test.ts`) tetap hijau — tambah route baru
  ke daftar route yang wajib ada.
- E2E live (Verify): seed → `psql` jalankan query metrik → curl events 201 → `GET /summary`
  nilai wajar → dashboard Grafana tidak error.

## 10. Boundaries

- **Always:** `NULLIF` untuk semua denominator; `DECIMAL(12,2)` untuk uang; allowlist event;
  `user_id` dari server (bukan client); parameterized query; test sebelum commit; Conventional Commits.
- **Ask first:** perubahan skema setelah review; tambah dependency; deploy ke live tanpa check `terraform plan`.
- **Never:** commit `.env`/secrets; simpan PII di `event_properties`; ekspos `GRAFANA_API_KEY` ke bundle frontend; `DROP TABLE` tanpa backup.

## 11. Success Criteria

- [x] Spec ini disetujui
- [ ] `schema/migration-2026-08-15-monetization.sql` ter-apply di cluster `woozy-grivet` (3 tabel ada)
- [ ] `npm run typecheck` + lambda `tsc --noEmit` + `npm test` hijau
- [ ] `POST /api/v1/events` live → 201; event non-allowlist ditolak
- [ ] `GET /api/v1/monetization/summary` live → semua metrik terhitung tanpa NaN/Infinity
- [ ] Query metrik Task 3 jalan via psql (div-by-zero diuji dengan periode kosong)
- [ ] Dashboard `cbt-monetization` import di Grafana, 8 panel query valid
- [ ] `PROGRESS.md` + ADR + `.env.example` diperbarui

## 12. Open Questions

- **MRR movement basis** → Keputusan: hybrid. Level MRR dari snapshot `subscriptions`;
  New/Expansion/Churned dari `user_events` delta. (Disetujui, bisa direvisi di Review.)
- **Frontend wiring** → Keputusan: helper `trackEvent` saja, tanpa UI billing.
- **`GRAFANA_API_KEY`** → Prasyarat user: buat API key admin/editor di Grafana Cloud dan isi `.env`.
