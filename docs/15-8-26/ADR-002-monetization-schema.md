# ADR-002: Schema Monetisasi + Metrik FASE 4 (transaction tracking, MRR/ARR/ARPU/ARPPU/LTV/CAC/Churn/Checkout)

- **Status**: Accepted
- **Date**: 2026-08-15
- **Deciders**: Principal Engineer (agent), per FASE4-MONETIZATION-SPEC.md
- **Related**: ADR-001 (OpenTelemetry instrumentation), FASE4-MONETIZATION-SPEC.md

## Context

Produk perlu fondasi monetisasi: melacak event transaksi (checkout/payment/subscription),
menyimpan data langganan dan belanja iklan, lalu menghitung metrik bisnis (MRR, ARR, ARPU,
ARPPU, LTV, CAC, revenue churn, checkout abandonment, failed payment rate, LTV:CAC) untuk
panel Grafana. Sebelum ADR ini: tidak ada tabel `user_events`, `subscriptions`, atau
`marketing_ad_spend`; metrik hanya 48 counter client-side (metrics.ts) tanpa data transaksi.

Batasan yang menggerakkan keputusan: semua nilai uang harus `DECIMAL(12,2)`/`NUMERIC`
(never float); setiap pembagian memakai `NULLIF(denominator, 0)` supaya panel/API tidak
mengeluarkan NaN/Infinity saat data kosong.

## Decision

1. **Tiga tabel baru** (idempotent, `schema/migration-2026-08-15-monetization.sql`):
   - `user_events` — event stream generik (id UUID, user_id FK→users CASCADE, event_name,
     event_properties JSONB, session_id, device_id, occurred_at). Dua index: `(user_id)` dan
     `(event_name, occurred_at)`. Menjadi fondasi FASE 1-3 (event ingestion) sekaligus sumber
     pergerakan MRR (New/Expansion/Churned) dan funnel.
   - `subscriptions` — langganan (id UUID, user_id FK CASCADE, plan_id, status CHECK
     IN ('active','canceled','past_due','trialing','expired'), amount DECIMAL(12,2) CHECK ≥0,
     currency default 'USD', billing_cycle CHECK IN ('monthly','yearly'), started_date,
     ended_date, cancelled_at, created_at, updated_at). Index `(user_id)` dan `(status, started_date)`.
   - `marketing_ad_spend` — belanja iklan per periode (period_date DATE, channel, cost
     DECIMAL(12,2) CHECK ≥0, UNIQUE(period_date, channel)).
2. **Event allowlist 6 nama** di backend (`ALLOWED_MONETIZATION_EVENTS`): checkout_started,
   checkout_completed, payment_succeeded, payment_failed, subscription_upgraded,
   subscription_cancelled. Event non-allowlist di-drop server (tidak di-insert) — bukan
   bucket generik tanpa kendali. `properties` dibatasi skema (plan_id/amount/delta_amount/
   old_plan_id/new_plan_id/reason/error_code/subscription_id/billing_cycle), tanpa PII.
3. **MRR level vs pergerakan (hybrid)**:
   - MRR *level* dihitung dari snapshot `subscriptions` aktif (monthly → amount; yearly → amount/12),
     overlap dengan periode (started_date < akhir periode, ended_date NULL/≥ awal periode).
   - MRR *movement* (New/Expansion/Churned) diturunkan dari `user_events`:
     new = payment_succeeded amount; expansion = subscription_upgraded delta>0;
     churned = -subscription_cancelled amount.
4. **Rasio dikembalikan sebagai multiplier 0..1 di API Lambda**, dipakai langsung untuk
   matematika LTV (churnRate, grossMargin). Panel Grafana menampilkan persen via `*100`.
   Keputusan sengaja: API memegang representasi matematis (konsisten untuk kalkulasi),
   Grafana memegang representasi tampilan. Perbedaan ini didokumentasikan, bukan bug.
5. **CAC** = total marketing spend / akun berbayar baru (subscription aktif mulai bulan
   periode). Pembagi nol → `cac: null`.
6. **LTV** = `(ARPU × grossMargin) / churnRate`; default grossMargin 0.7, churnRate default
   dari data (user cancel / paying users) tapi bisa di-override via query param.
   LTV:CAC = LTV / CAC.
7. **Revenue churn rate** = MRR hilang (cancel + downgrade, nominal positif) / MRR awal periode.
8. **Frontend hanya instrumentation**: helper `trackEvent` (buffered, batch 50 / flush 10s /
   pagehide) mengirim ke `POST /api/v1/events`. Tidak ada UI billing.
9. **Grafana provisioning via HTTP API** (service account token role Admin, bukan access
   policy — yang terakhir hanya gate data-plane). Datasource postgres (uid `crdb-postgres`,
   `access:"proxy"` wajib di Grafana 13.x) + dashboard import 8 panel (uid `monetization`).

## Consequences

**Positif**: metrik monetisasi bisa dihitung dari satu event stream + dua tabel snapshot;
NULLIF-safe di semua titik pembagian; deterministik (seed PRNG) sehingga reproduksibel;
Grafana E2E terverifikasi live (datasource health OK, /api/ds/query mengembalikan funnel
[53,43,45,3]); Lambda live mengembalikan summary valid.

**Negatif**: events di-drop oleh allowlist tanpa persistensi — event non-monetisasi di masa
depan butuh perluasan allowlist; `occurredAt` parse best-effort (fallback now); user churn
rate adalah proxy data-driven (cancel events / paying) — butuh sumber kebenaran billing
asli (mis. Stripe) untuk produksi; API mengembalikan ratio (bukan persen) sehingga consumer
harus tahu unit per metrik.

## Verified

- `npx tsc --noEmit` (lambda) ✓ · `npm test` 35/35 ✓ · frontend `npm run typecheck` ✓
- Schema + seed + SQL diverifikasi live di CRDB `woozy-grivet`.
- Lambda deployed (Function URL ap-southeast-3) — POST /events → 201 {inserted:2, rejected:1};
  GET /monetization/cac → {spend:2346.34,newPayingUsers:7,cac:335.19};
  GET /monetization/summary → {mrr:1349,arr:16188,arpu:103.77,arppu:64.24,ltv:254.23,ltvCac:0.76,...}.
- Grafana: datasource `crdb-postgres` health "Database Connection OK"; dashboard uid
  `monetization` imported; query E2E funnel OK.
