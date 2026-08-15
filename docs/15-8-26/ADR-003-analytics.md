# ADR-003: Analytics — Core Telemetry, UX Funnel, Retention & Cohort (FASE 1-3)

- **Status**: Accepted
- **Date**: 2026-08-15
- **Deciders**: Principal Engineer (agent), per FASE123-ANALYTICS-SPEC.md
- **Related**: ADR-002 (monetization schema), FASE123-ANALYTICS-SPEC.md

## Context

Produk perlu event stream produksi (bukan sekadar 48 counter client-side), funnel aktivasi
user, dan analisis retensi/cohort untuk dashboard Grafana. Sebelum ADR ini: backend hanya
mengizinkan 6 event monetisasi (`ALLOWED_MONETIZATION_EVENTS`), frontend punya helper
`trackEvent` buffered tapi belum dipanggil di call-site manapun, `users.created_at` ada tapi
seed mengisinya `now()` untuk semua user (cohort tidak mungkin), dan belum ada endpoint
funnel/aktivitas/retensi.

Batasan yang menggerakkan keputusan: `user_events.event_name` TANPA CHECK constraint
(perluasan allowlist = perubahan backend murni, tanpa migrasi); frontend tidak punya vitest
(verifikasi = tsc + build); setiapratio memakai `NULLIF(denominator, 0)`.

## Decision

1. **Katalog event terpusat** — `lambda/lib/eventCatalog.ts`: 30 event dalam 8 kategori
   (core, auth, chat, crisis, voice, memory, privacy, monetization). `partitionEvents`/
   `isAllowedEventName` dipindah ke katalog dan di-re-export dari `lambda/lib/monetization.ts`
   (kompatibilitas FASE 4 dipertahankan; `ALLOWED_MONETIZATION_EVENTS` tetap).
2. **Telemetry frontend** — `src/shared/lib/telemetryEvents.ts`: layer `track(name, properties?)`
   typed + konstanta `TELEMETRY_EVENTS` (camelCase→snake_case), membungkus buffer
   `trackEvent.ts` (batch 50 / flush 10s / pagehide). Semua ~20 call-site di-wire: auth
   (login_completed magic-link + passkey, signup_completed, onboarding_completed), chat
   (session_started via setActiveSession null-path, message_sent, stream_done,
   stream_truncated ×2, stream_done resume), crisis (crisis_triggered/resolved di action
   appStore agar menangkap trigger text + fusion bridge; crisis_grounding_done ref-guarded
   di CrisisOverlay; crisis_lifeline_used di SwipeToCall), voice (voice_note_recorded,
   transcript_received {via}), memory (added/updated/deleted/searched/edge_linked),
   session (finalized/interrupted/requeue), privacy (export_completed, purge_completed),
   plus `page_view` (RouteTracker di AppShell via useLocation) + `app_launch`.
3. **Bug metric.* diperbaiki** — `addNode` salah memanggil `metric.graphLinkCreated()`
   (tidak membuat link) diganti `track(memoryAdded)`; metric.* yang didefinisikan tapi tak
   pernah dipanggil kini di-wire (purgeStarted/purgeCompleted/purgeAbandon/postPurgeResidue,
   streamTruncated, crisisGroundingDone, crisisLifelineTap, sessionFinalized,
   sessionOrphaned, sessionRequeueOk).
4. **Funnel aktivasi** — `GET /api/v1/analytics/funnel?period=YYYY-MM-DD&steps=...`:
   COUNT(DISTINCT user_id) per step + konversi antar-step (NULLIF-safe). Default steps:
   signup_completed → onboarding_completed → message_sent → session_finalized. Step
   divalidasi terhadap katalog.
5. **Aktivitas & sticky** — `GET /api/v1/analytics/activity?period=YYYY-MM`:
   DAU (end-24h), WAU (end-7d), MAU (bulan kalender), stickyFactor = DAU/MAU. Sumber
   aktivitas = user_events ∪ users.last_active (sama seperti MAU FASE 4).
6. **Retensi cohort** — `GET /api/v1/analytics/retention?period=YYYY-MM`: cohort = bulan
   `users.created_at`; window cohort = periodStart minus 5 bulan (6 cohort). `retentionPct` =
   COUNT(DISTINCT user aktif pada bulan age)/size×100, NULLIF-safe; matriks cohort×age.
   Umur dalam bulan via EXTRACT(YEAR/MONTH).
7. **Quirk CockroachDB v26.2.5** — `COUNT(DISTINCT user_id) FILTER (WHERE event_name=...)`
   yang digabung dengan range timestamptz saat MULTIPLE DISTINCT-FILTER aggregate berdampingan
   mengembalikan jumlah yang salah (lebih kecil). Solusi: `COUNT(DISTINCT CASE WHEN event_name='X'
   THEN user_id END)` — dipakai di `schema/analytics-queries.sql` section 1 dan panel funnel
   dashboard. Lib `getFunnel` memakai gaya WHERE (aman); `getCheckoutFunnel` (FASE 4) memakai
   `COUNT(*) FILTER` (aman).
8. **Agregat lintas-user** — endpoint funnel/activity/retention menghitung SEMUA user.
   Diterima untuk app single-user/demo (setiap client = user yang sama); dicatat sebagai
   batasan + follow-up hardening (rate limit, auth admin) untuk produksi.
9. **Grafana** — dashboard baru uid `analytics` (5 panel: activation funnel bargauge,
   conversion stat, DAU/WAU/MAU timeseries, sticky factor stat, cohort retention table);
   `scripts/grafana-provision.sh` diparametrize (loop over `infra/grafana/*.json`) untuk
   meng-import dashboard monetization + analytics.

## Consequences

**Positif**: satu katalog event sebagai source of truth (backend allowlist + konstanta
frontend konsisten); event stream produksi end-to-end; funnel + retensi + DAU/WAU/MAU bisa
dihitung dari data live; seed deterministik dengan `created_at` di-backdate + aktivitas per
cohort ber-decay (retensi realistis); verified live di CRDB + Lambda + Grafana.

**Negatif**: 4-30 query untuk funnel (satu per step, dibatasi ≤30); `activeDistinct`
menyerupai `getMAU` FASE 4 (duplikasi tipis, dibenarkan untuk window day/week/month);
agregat lintas-user bukan model multi-tenant (batasan produksi, dicatat).

## Verified

- `cd lambda && npx tsc --noEmit && npm test` → 56/56 PASS (6 file: eventCatalog 9,
  analytics 12, monetization 13, telemetry 9, handler.contract 8, logger 5).
- Frontend `npm run typecheck` + `npm run build` PASS.
- Seed live CRDB woozy-grivet: 40 user (cohort 03:2, 04:4, 05:12, 06:9, 07:5, 08:13),
  user_events 385+ (signup 40, onboarding 31, message 30, finalized 19, page_view 129).
- Terraform apply (Lambda cbt-memory-agent, version 11) — live:
  - GET /api/v1/analytics/funnel?period=2026-06 → {steps signup 9, onboarding 6, message 7, finalized 3}.
  - GET /api/v1/analytics/activity?period=2026-06 → {dau 2, wau 13, mau 24, stickyFactor 0.08}.
  - GET /api/v1/analytics/retention?period=2026-06 → matriks cohort 03/04/05/06, umur 0-3,
    age/size/active numerik, retensi 100→50, 100→91.67.
- Grafana E2E via /api/ds/query: funnel `40|31|30|19` (CASE WHEN fix).
- Dashboard: https://imanino.grafana.net/d/analytics/cac9c6c (uid analytics) +
  https://imanino.grafana.net/d/monetization/943697e.
