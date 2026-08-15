-- ============================================================================
-- analytics-queries.sql
-- Native SQL untuk metrik FASE 2 (UX Funnel) + FASE 3 (Retention & Cohort).
--
-- Dua bentuk:
--   1) GRAFANA — memakai macro PostgreSQL datasource:
--        $__timeFilter(col)  → col BETWEEN <from> AND <to>
--        $__timeFrom()       → awal range (timestamptz)
--        $__timeTo()         → akhir range (timestamptz)
--   2) STANDALONE — varian psql dengan parameter $1/$2, tanpa macro.
--
-- Aturan: SETIAP pembagian memakai NULLIF(denominator, 0). Angka dipakai
-- sebagai ::numeric (bukan float). Sumber aktivitas = users.last_active
-- ∪ user_events (distinct user).
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. ACTIVATION FUNNEL — distinct user per tahap + konversi antar-tahap
--    tahap: signup_completed → onboarding_completed → message_sent → session_finalized
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA (panel table/bargauge; tambahkan kolom konversi di query tsb):
-- CATATAN: pakai COUNT(DISTINCT CASE WHEN ...) BUKAN COUNT(DISTINCT ...) FILTER —
-- CockroachDB v26.2.5 mengembalikan hitungan salah (terlalu kecil) untuk kombinasi
-- beberapa agregat COUNT(DISTINCT) FILTER + predikat range timestamptz (terverifikasi
-- live: 4|2 padahal seharusnya 40|30). CASE WHEN aman.
SELECT
  COUNT(DISTINCT CASE WHEN event_name = 'signup_completed' THEN user_id END)::int     AS signup_completed,
  COUNT(DISTINCT CASE WHEN event_name = 'onboarding_completed' THEN user_id END)::int AS onboarding_completed,
  COUNT(DISTINCT CASE WHEN event_name = 'message_sent' THEN user_id END)::int         AS message_sent,
  COUNT(DISTINCT CASE WHEN event_name = 'session_finalized' THEN user_id END)::int    AS session_finalized
FROM user_events
WHERE $__timeFilter(occurred_at);

-- Konversi tahap-ke-tahap (dipakai untuk stat/alert):
SELECT
  (COUNT(DISTINCT CASE WHEN event_name = 'onboarding_completed' THEN user_id END))::numeric
    / NULLIF(COUNT(DISTINCT CASE WHEN event_name = 'signup_completed' THEN user_id END), 0) * 100
      AS signup_to_onboarding_pct,
  (COUNT(DISTINCT CASE WHEN event_name = 'message_sent' THEN user_id END))::numeric
    / NULLIF(COUNT(DISTINCT CASE WHEN event_name = 'onboarding_completed' THEN user_id END), 0) * 100
      AS onboarding_to_chat_pct,
  (COUNT(DISTINCT CASE WHEN event_name = 'session_finalized' THEN user_id END))::numeric
    / NULLIF(COUNT(DISTINCT CASE WHEN event_name = 'message_sent' THEN user_id END), 0) * 100
      AS chat_to_finalized_pct
FROM user_events
WHERE $__timeFilter(occurred_at);

-- STANDALONE ($1 = period start, $2 = period end):
--   SELECT COUNT(DISTINCT user_id) FROM user_events
--   WHERE event_name = 'signup_completed' AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz;
--   ... (ulangi per tahap)

-- ════════════════════════════════════════════════════════════════════════════
-- 2. DAU / WAU / MAU — distinct aktif per hari / minggu / bulan
--    (users.last_active ∪ user_events)
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA (timeseries; 3 query di panel sama):
-- DAU:
SELECT date_trunc('day', occurred_at)::date AS "time", COUNT(*)::int AS value
FROM (
  SELECT user_id, occurred_at FROM user_events WHERE $__timeFilter(occurred_at)
  UNION
  SELECT id, last_active FROM users WHERE $__timeFilter(last_active)
) AS act
GROUP BY 1 ORDER BY 1;
-- WAU:
SELECT date_trunc('week', occurred_at)::date AS "time", COUNT(*)::int AS value
FROM (
  SELECT user_id, occurred_at FROM user_events WHERE $__timeFilter(occurred_at)
  UNION
  SELECT id, last_active FROM users WHERE $__timeFilter(last_active)
) AS act
GROUP BY 1 ORDER BY 1;
-- MAU:
SELECT date_trunc('month', occurred_at)::date AS "time", COUNT(*)::int AS value
FROM (
  SELECT user_id, occurred_at FROM user_events WHERE $__timeFilter(occurred_at)
  UNION
  SELECT id, last_active FROM users WHERE $__timeFilter(last_active)
) AS act
GROUP BY 1 ORDER BY 1;

-- Sticky factor (DAU/MAU) untuk stat:
SELECT
  (SELECT COUNT(*) FROM (
     SELECT user_id FROM user_events WHERE $__timeFilter(occurred_at)
     UNION SELECT id FROM users WHERE $__timeFilter(last_active)
   ) AS act)::numeric
  / NULLIF((SELECT COUNT(*) FROM (
     SELECT id FROM users WHERE last_active >= $__timeFrom()::timestamptz AND last_active <= $__timeTo()::timestamptz
     UNION SELECT DISTINCT user_id FROM user_events WHERE $__timeFilter(occurred_at)
   ) AS act), 0) AS sticky_factor;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. COHORT RETENTION — cohort = bulan users.created_at, retensi per umur bulan
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA (panel table pivot cohort×age; kolom: cohort, age, size, active,
-- retention_pct). Query identik dengan lib getRetention (lihat lambda/lib/analytics.ts):
WITH cohorts AS (
  SELECT id, date_trunc('month', created_at)::date AS cohort
  FROM users
  WHERE $__timeFilter(created_at)
),
sizes AS (
  SELECT cohort, COUNT(*)::int AS size FROM cohorts GROUP BY cohort
),
activity AS (
  SELECT user_id, date_trunc('month', occurred_at)::date AS active_month
  FROM user_events WHERE $__timeFilter(occurred_at)
  UNION
  SELECT id, date_trunc('month', last_active)::date
  FROM users WHERE $__timeFilter(last_active)
),
matched AS (
  SELECT s.cohort, s.size, c.id AS user_id,
         (EXTRACT(YEAR FROM act.active_month) * 12 + EXTRACT(MONTH FROM act.active_month)
          - EXTRACT(YEAR FROM s.cohort) * 12 - EXTRACT(MONTH FROM s.cohort))::int AS age
  FROM sizes s
  JOIN cohorts c ON c.cohort = s.cohort
  LEFT JOIN activity act ON act.user_id = c.id AND act.active_month >= s.cohort
  WHERE act.active_month IS NOT NULL
)
SELECT cohort::text AS cohort, age, size,
       COUNT(DISTINCT user_id)::int AS active,
       (COUNT(DISTINCT user_id)::numeric / NULLIF(size, 0) * 100)::numeric::text AS retention_pct
FROM matched
GROUP BY cohort, age, size
ORDER BY cohort, age;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFIKASI CEPAT (standalone psql, tanpa macro):
--   SELECT event_name, COUNT(*) FROM user_events GROUP BY 1 ORDER BY 2 DESC;
--   SELECT date_trunc('day', last_active)::date, COUNT(*) FROM users GROUP BY 1 ORDER BY 1;
--   SELECT date_trunc('month', created_at)::date AS cohort, COUNT(*) FROM users GROUP BY 1 ORDER BY 1;
-- ============================================================================
