-- ============================================================================
-- monetization-queries.sql
-- Native SQL untuk metrik monetisasi (FASE 4).
--
-- Dua bentuk:
--   1) GRAFANA — memakai macro PostgreSQL datasource:
--        $__timeFilter(col)   → col BETWEEN <from> AND <to>
--        $__timeFrom()        → awal range (timestamptz)
--        $__timeTo()          → akhir range (timestamptz)
--      Tambahkan `${gross_margin}` / `${churn_rate}` sebagai dashboard variables.
--   2) STANDALONE — varian psql dengan parameter $1/$2, tanpa macro.
--
-- Aturan: SETIAP pembagian memakai NULLIF(denominator, 0). Monetari selalu
-- DECIMAL/NUMERIC (bukan float). event_properties di-insert sebagai JSONB dan
-- diakses via operator ->>, nilai tekstual di-cast ke numeric saat dipakai.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1. MRR & ARR GROWTH — New / Expansion / Churned MRR per bulan
--    (pergerakan MRR diturunkan dari user_events — FASE 1-3 fondasi)
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA:
SELECT
  date_trunc('month', occurred_at)::date                                    AS "time",
  COALESCE(SUM(COALESCE((event_properties->>'amount')::numeric, 0))
           FILTER (WHERE event_name = 'payment_succeeded'), 0)::numeric     AS new_mrr,
  COALESCE(SUM(COALESCE((event_properties->>'delta_amount')::numeric, 0))
           FILTER (WHERE event_name = 'subscription_upgraded'
                   AND COALESCE((event_properties->>'delta_amount')::numeric, 0) > 0), 0)::numeric AS expansion_mrr,
  -COALESCE(SUM(COALESCE((event_properties->>'amount')::numeric, 0))
            FILTER (WHERE event_name = 'subscription_cancelled'), 0)::numeric AS churned_mrr
FROM user_events
WHERE $__timeFilter(occurred_at)
  AND event_name IN ('payment_succeeded', 'subscription_upgraded', 'subscription_cancelled')
GROUP BY 1
ORDER BY 1;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. MRR LEVEL + ARR — status langganan aktif sampai akhir range
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA:
SELECT
  (COALESCE(SUM(amount) FILTER (WHERE billing_cycle = 'monthly'), 0)
   + COALESCE(SUM(amount / 12) FILTER (WHERE billing_cycle = 'yearly'), 0))::numeric AS mrr,
  (COALESCE(SUM(amount) FILTER (WHERE billing_cycle = 'monthly'), 0)
   + COALESCE(SUM(amount / 12) FILTER (WHERE billing_cycle = 'yearly'), 0))::numeric * 12 AS arr
FROM subscriptions
WHERE status = 'active'
  AND started_date <= $__timeTo()::timestamptz
  AND (ended_date IS NULL OR ended_date > $__timeTo()::timestamptz);

-- STANDALONE ($1 = period start, $2 = period end):
--   SELECT ... AND started_date < $2 AND (ended_date IS NULL OR ended_date >= $1);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. ARPU & ARPPU — revenue / MAU  dan  revenue / paying users
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA:
SELECT
  mrr / NULLIF(mau, 0) AS arpu,
  mrr / NULLIF(paying_users, 0) AS arppu
FROM (
  SELECT
    (SELECT COALESCE(SUM(CASE WHEN billing_cycle = 'yearly' THEN amount / 12 ELSE amount END), 0)::numeric
     FROM subscriptions
     WHERE status = 'active'
       AND started_date <= $__timeTo()::timestamptz
       AND (ended_date IS NULL OR ended_date > $__timeTo()::timestamptz)) AS mrr,
    (SELECT COUNT(*) FROM (
       SELECT id FROM users WHERE last_active >= $__timeFrom()::timestamptz AND last_active <= $__timeTo()::timestamptz
       UNION
       SELECT DISTINCT user_id FROM user_events WHERE $__timeFilter(occurred_at)
     ) AS active_users) AS mau,
    (SELECT COUNT(DISTINCT user_id)
     FROM subscriptions
     WHERE status = 'active'
       AND started_date <= $__timeTo()::timestamptz
       AND (ended_date IS NULL OR ended_date > $__timeTo()::timestamptz)) AS paying_users
) AS calc;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. LTV vs CAC
--    LTV = (ARPU * gross_margin) / churn_rate
--    CAC = ad spend / akun berbayar baru
--    LTV:CAC rasio target ≈ 3:1 (panel Grafana memakai query terpisah).
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA — LTV (variabel dashboard: ${gross_margin}=0.7, ${churn_rate}=0.05):
SELECT
  (mrr / NULLIF(mau, 0) * ${gross_margin}) / NULLIF(${churn_rate}, 0) AS ltv
FROM (
  SELECT
    (SELECT COALESCE(SUM(CASE WHEN billing_cycle = 'yearly' THEN amount / 12 ELSE amount END), 0)::numeric
     FROM subscriptions WHERE status = 'active'
       AND started_date <= $__timeTo()::timestamptz AND (ended_date IS NULL OR ended_date > $__timeTo()::timestamptz)) AS mrr,
    (SELECT COUNT(*) FROM (
       SELECT id FROM users WHERE last_active >= $__timeFrom()::timestamptz AND last_active <= $__timeTo()::timestamptz
       UNION SELECT DISTINCT user_id FROM user_events WHERE $__timeFilter(occurred_at)
     ) AS active_users) AS mau
) AS calc;

-- GRAFANA — CAC:
SELECT
  COALESCE(SUM(cost), 0)::numeric
    / NULLIF((SELECT COUNT(DISTINCT user_id) FROM subscriptions
              WHERE status = 'active'
                AND started_date >= $__timeFrom()::timestamptz
                AND started_date <= $__timeTo()::timestamptz), 0) AS cac
FROM marketing_ad_spend
WHERE period_date >= $__timeFrom()::date AND period_date <= $__timeTo()::date;

-- GRAFANA — LTV:CAC rasio:
SELECT
  ((SELECT (mrr / NULLIF(mau, 0) * ${gross_margin}) / NULLIF(${churn_rate}, 0)
    FROM (
      SELECT
        (SELECT COALESCE(SUM(CASE WHEN billing_cycle = 'yearly' THEN amount / 12 ELSE amount END), 0)::numeric
         FROM subscriptions WHERE status = 'active'
           AND started_date <= $__timeTo()::timestamptz AND (ended_date IS NULL OR ended_date > $__timeTo()::timestamptz)) AS mrr,
        (SELECT COUNT(*) FROM (
           SELECT id FROM users WHERE last_active >= $__timeFrom()::timestamptz AND last_active <= $__timeTo()::timestamptz
           UNION SELECT DISTINCT user_id FROM user_events WHERE $__timeFilter(occurred_at)
         ) AS active_users) AS mau
    ) AS calc)
   )::numeric
   / NULLIF((SELECT COALESCE(SUM(cost), 0)::numeric
             / NULLIF((SELECT COUNT(DISTINCT user_id) FROM subscriptions WHERE status = 'active'
                       AND started_date >= $__timeFrom()::timestamptz AND started_date <= $__timeTo()::timestamptz), 0)
             FROM marketing_ad_spend
             WHERE period_date >= $__timeFrom()::date AND period_date <= $__timeTo()::date), 0) AS ltv_cac_ratio;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. CHECKOUT FUNNEL — drop-off per tahap
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA (panel bar, format values):
SELECT
  COUNT(*) FILTER (WHERE event_name = 'checkout_started')::int   AS started,
  COUNT(*) FILTER (WHERE event_name = 'checkout_completed')::int  AS completed,
  COUNT(*) FILTER (WHERE event_name = 'payment_succeeded')::int   AS succeeded,
  COUNT(*) FILTER (WHERE event_name = 'payment_failed')::int      AS failed
FROM user_events
WHERE $__timeFilter(occurred_at)
  AND event_name IN ('checkout_started', 'checkout_completed', 'payment_succeeded', 'payment_failed');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. FAILED PAYMENT RATE — failed / (failed + succeeded) * 100
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA:
SELECT
  (COUNT(*) FILTER (WHERE event_name = 'payment_failed'))::numeric
    / NULLIF(COUNT(*) FILTER (WHERE event_name IN ('payment_failed', 'payment_succeeded')), 0) * 100 AS failed_payment_rate
FROM user_events
WHERE $__timeFilter(occurred_at);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. REVENUE CHURN RATE — MRR hilang (cancel+downgrade) / MRR awal periode * 100
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA:
WITH mrr_start AS (
  SELECT COALESCE(SUM(CASE WHEN billing_cycle = 'yearly' THEN amount / 12 ELSE amount END), 0)::numeric AS mrr
  FROM subscriptions
  WHERE status = 'active'
    AND started_date < $__timeFrom()::timestamptz
    AND (ended_date IS NULL OR ended_date >= $__timeFrom()::timestamptz)
)
SELECT
  COALESCE(SUM(lost), 0)::numeric / NULLIF((SELECT mrr FROM mrr_start), 0) * 100 AS revenue_churn_rate
FROM (
  SELECT COALESCE((event_properties->>'amount')::numeric, 0) AS lost
  FROM user_events
  WHERE event_name = 'subscription_cancelled' AND $__timeFilter(occurred_at)
  UNION ALL
  SELECT GREATEST(0, -COALESCE((event_properties->>'delta_amount')::numeric, 0))
  FROM user_events
  WHERE event_name = 'subscription_upgraded' AND $__timeFilter(occurred_at)
    AND COALESCE((event_properties->>'delta_amount')::numeric, 0) < 0
) AS churn_deltas;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. CHECKOUT ABANDONMENT RATE — (started - completed) / started * 100
-- ════════════════════════════════════════════════════════════════════════════
-- GRAFANA:
SELECT
  (COUNT(*) FILTER (WHERE event_name = 'checkout_started')
   - COUNT(*) FILTER (WHERE event_name = 'checkout_completed'))::numeric
    / NULLIF(COUNT(*) FILTER (WHERE event_name = 'checkout_started'), 0) * 100 AS checkout_abandonment_rate
FROM user_events
WHERE $__timeFilter(occurred_at);

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFIKASI CEPAT (standalone psql, tanpa macro):
--   SELECT * FROM user_events LIMIT 5;
--   SELECT event_name, COUNT(*) FROM user_events GROUP BY 1 ORDER BY 2 DESC;
--   SELECT * FROM marketing_ad_spend ORDER BY period_date;
--   SELECT status, COUNT(*) FROM subscriptions GROUP BY 1;
-- ============================================================================
