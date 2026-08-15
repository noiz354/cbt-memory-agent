-- CockroachDB Migration — FASE 4: Monetization & Financial Metrics
-- Tanggal: 2026-08-15 · Cluster: woozy-grivet (serverless, ap-southeast-3)
--
-- Tables:
--   user_events           → fondasi event tracking (FASE 1-3) + event monetisasi
--   subscriptions         → langganan/transaksi (MRR/ARR/ARPU/ARPPU/LTV/churn)
--   marketing_ad_spend    → biaya pemasaran per periode (CAC)
--
-- Aturan: nilai mata uang SELALU DECIMAL(12,2), tidak pernah float.
-- Semua DDL idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─────────────────────────────────────────────
-- User Events (generic event sink, FASE 1-3 + monetisasi)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name STRING NOT NULL,
  event_properties JSONB,
  session_id STRING,
  device_id STRING,
  occurred_at TIMESTAMPTZ DEFAULT now(),
  INDEX user_events_user_idx (user_id),
  INDEX user_events_name_occurred_idx (event_name, occurred_at)
);

-- ─────────────────────────────────────────────
-- Subscriptions (transaksi / langganan aktif)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id STRING NOT NULL,
  status STRING NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'expired')),
  amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
  currency STRING NOT NULL DEFAULT 'USD',
  billing_cycle STRING NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  started_date TIMESTAMPTZ NOT NULL,
  ended_date TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  INDEX subscriptions_user_idx (user_id),
  INDEX subscriptions_status_started_idx (status, started_date)
);

-- ─────────────────────────────────────────────
-- Marketing Ad Spend (biaya akuisisi per channel)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketing_ad_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_date DATE NOT NULL,
  channel STRING NOT NULL,
  cost DECIMAL(12,2) NOT NULL CHECK (cost >= 0),
  currency STRING NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (period_date, channel)
);
