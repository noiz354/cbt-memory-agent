/**
 * Monetization Library — helper + financial metric computation.
 *
 * Semua query berjalan terhadap CockroachDB via CrdbClient (parameterized).
 * Setiap rasio memakai NULLIF(denominator, 0) — hasil `null` (bukan NaN/Infinity)
 * saat data belum ada, supaya panel Grafana / API tidak error.
 *
 * Mata uang selalu DECIMAL(12,2); helper menerima/mengembalikan number.
 */

import { CrdbClient } from "./crdb";

// ─────────────────────────────────────────────
// Event allowlist (monetisasi + funnel)
// ─────────────────────────────────────────────

export const ALLOWED_MONETIZATION_EVENTS = [
  "checkout_started",
  "checkout_completed",
  "payment_succeeded",
  "payment_failed",
  "subscription_upgraded",
  "subscription_cancelled",
] as const;

export type MonetizationEventName = (typeof ALLOWED_MONETIZATION_EVENTS)[number];

export interface IncomingEvent {
  name: string;
  properties?: Record<string, unknown> | null;
  sessionId?: string;
  occurredAt?: string;
}

export interface ValidatedEvents {
  ok: boolean;
  events?: IncomingEvent[];
  error?: string;
}

/** Struktural validation terhadap batch events (shape, ukuran, tipe). */
export function validateEventsPayload(body: unknown): ValidatedEvents {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Expected JSON object body" };
  }
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, error: "Expected { events: [...] } (non-empty array)" };
  }
  if (events.length > 50) {
    return { ok: false, error: "Batch exceeds 50 events" };
  }
  for (const ev of events) {
    if (typeof ev !== "object" || ev === null) return { ok: false, error: "Event must be an object" };
    const e = ev as Record<string, unknown>;
    if (typeof e.name !== "string" || e.name.length === 0) {
      return { ok: false, error: "Each event requires a string `name`" };
    }
    if (e.properties !== undefined && e.properties !== null) {
      if (typeof e.properties !== "object" || Array.isArray(e.properties)) {
        return { ok: false, error: "`properties` must be a JSON object" };
      }
    }
    if (e.sessionId !== undefined && typeof e.sessionId !== "string") {
      return { ok: false, error: "`sessionId` must be a string" };
    }
    if (e.occurredAt !== undefined && typeof e.occurredAt !== "string") {
      return { ok: false, error: "`occurredAt` must be an ISO string" };
    }
  }
  return { ok: true, events: events as IncomingEvent[] };
}

/** Pisahkan events sesuai allowlist. Event non-allowlist TIDAK di-insert. */
export function partitionEvents(
  events: IncomingEvent[],
): { valid: IncomingEvent[]; rejected: IncomingEvent[] } {
  const allowed = new Set<string>(ALLOWED_MONETIZATION_EVENTS);
  const valid: IncomingEvent[] = [];
  const rejected: IncomingEvent[] = [];
  for (const ev of events) {
    if (allowed.has(ev.name)) valid.push(ev);
    else rejected.push(ev);
  }
  return { valid, rejected };
}

export function isAllowedEventName(name: string): boolean {
  return (ALLOWED_MONETIZATION_EVENTS as readonly string[]).includes(name);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

export function monthBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  const end = new Date(Date.UTC(y, m ?? 1, 1));
  return { start, end };
}

function toNum(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────

/** Total pengeluaran marketing dalam bulan periode. */
export async function getAdSpend(crdb: CrdbClient, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const row = await crdb.queryOne<{ spend: string }>(
    `SELECT COALESCE(SUM(cost), 0)::numeric::text AS spend
     FROM marketing_ad_spend
     WHERE period_date >= $1::date AND period_date < $2::date`,
    [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
  );
  return toNum(row?.spend);
}

/** Jumlah akun berbayar baru (subscription aktif mulai bulan ini). */
export async function getNewPayingUsers(crdb: CrdbClient, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const row = await crdb.queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT user_id)::int::text AS count
     FROM subscriptions
     WHERE status = 'active'
       AND started_date >= $1::timestamptz
       AND started_date < $2::timestamptz`,
    [start.toISOString(), end.toISOString()],
  );
  return toNum(row?.count);
}

/**
 * CAC (Customer Acquisition Cost) = total ad spend / akun berbayar baru.
 * Pembagi nol → `cac: null`.
 */
export async function calculateCAC(
  crdb: CrdbClient,
  period: string,
): Promise<{ spend: number; newPayingUsers: number; cac: number | null }> {
  const [spend, newPayingUsers] = await Promise.all([
    getAdSpend(crdb, period),
    getNewPayingUsers(crdb, period),
  ]);
  const cac = safeDiv(spend, newPayingUsers);
  return { spend: round2(spend) ?? 0, newPayingUsers, cac: round2(cac) };
}

/** MRR level = jumlah nilai langganan aktif (ternormalisasi bulanan) dalam bulan. */
export async function getRevenueForMonth(crdb: CrdbClient, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const row = await crdb.queryOne<{ mrr: string }>(
    `SELECT COALESCE(SUM(CASE WHEN billing_cycle = 'yearly' THEN amount / 12 ELSE amount END), 0)::numeric::text AS mrr
     FROM subscriptions
     WHERE status = 'active'
       AND started_date < $2::timestamptz
       AND (ended_date IS NULL OR ended_date >= $1::timestamptz)`,
    [start.toISOString(), end.toISOString()],
  );
  return toNum(row?.mrr);
}

/** MAU = distinct user aktif di bulan (dari users.last_active ∪ user_events). */
export async function getMAU(crdb: CrdbClient, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const row = await crdb.queryOne<{ count: string }>(
    `SELECT COUNT(*)::int::text AS count FROM (
       SELECT id FROM users WHERE last_active >= $1::timestamptz AND last_active < $2::timestamptz
       UNION
       SELECT DISTINCT user_id FROM user_events WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
     ) AS active_users`,
    [start.toISOString(), end.toISOString()],
  );
  return toNum(row?.count);
}

/** Paying users = distinct user dengan subscription aktif di bulan. */
export async function getPayingUsers(crdb: CrdbClient, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const row = await crdb.queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT user_id)::int::text AS count
     FROM subscriptions
     WHERE status = 'active'
       AND started_date < $2::timestamptz
       AND (ended_date IS NULL OR ended_date >= $1::timestamptz)`,
    [start.toISOString(), end.toISOString()],
  );
  return toNum(row?.count);
}

/** MRR yang hilang di bulan berjalan (cancel + downgrade), nominal positif. */
export async function getChurnedMRR(crdb: CrdbClient, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const row = await crdb.queryOne<{ lost: string }>(
    `SELECT COALESCE(SUM(lost), 0)::numeric::text AS lost FROM (
       SELECT COALESCE(CAST(event_properties->>'amount' AS numeric), 0) AS lost
       FROM user_events
       WHERE event_name = 'subscription_cancelled'
         AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
       UNION ALL
       SELECT GREATEST(0, -COALESCE(CAST(event_properties->>'delta_amount' AS numeric), 0)) AS lost
       FROM user_events
       WHERE event_name = 'subscription_upgraded'
         AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
         AND COALESCE(CAST(event_properties->>'delta_amount' AS numeric), 0) < 0
     ) AS churn_deltas`,
    [start.toISOString(), end.toISOString()],
  );
  return toNum(row?.lost);
}

export interface CheckoutFunnel {
  started: number;
  completed: number;
  succeeded: number;
  failed: number;
}

/** Funnel checkout + status pembayaran dari user_events. */
export async function getCheckoutFunnel(crdb: CrdbClient, period: string): Promise<CheckoutFunnel> {
  const { start, end } = monthBounds(period);
  const row = await crdb.queryOne<{ started: string; completed: string; succeeded: string; failed: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_name = 'checkout_started')::int::text AS started,
       COUNT(*) FILTER (WHERE event_name = 'checkout_completed')::int::text AS completed,
       COUNT(*) FILTER (WHERE event_name = 'payment_succeeded')::int::text AS succeeded,
       COUNT(*) FILTER (WHERE event_name = 'payment_failed')::int::text AS failed
     FROM user_events
     WHERE event_name IN ('checkout_started','checkout_completed','payment_succeeded','payment_failed')
       AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz`,
    [start.toISOString(), end.toISOString()],
  );
  return {
    started: toNum(row?.started),
    completed: toNum(row?.completed),
    succeeded: toNum(row?.succeeded),
    failed: toNum(row?.failed),
  };
}

/** User churn rate = user cancel di bulan / paying users (proxy data-driven). */
export async function getUserChurnRate(crdb: CrdbClient, period: string): Promise<number> {
  const { start, end } = monthBounds(period);
  const [canceled, paying] = await Promise.all([
    crdb
      .queryOne<{ count: string }>(
        `SELECT COUNT(DISTINCT user_id)::int::text AS count
         FROM user_events
         WHERE event_name = 'subscription_cancelled'
           AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz`,
        [start.toISOString(), end.toISOString()],
      )
      .then((r) => toNum(r?.count)),
    getPayingUsers(crdb, period),
  ]);
  return safeDiv(canceled, paying) ?? 0;
}

export interface MonetizationSummary {
  mrr: number;
  arr: number;
  arpu: number | null;
  arppu: number | null;
  ltv: number | null;
  ltvCac: number | null;
  cac: number | null;
  revenueChurnRate: number | null;
  checkoutAbandonmentRate: number | null;
  failedPaymentRate: number | null;
  grossMargin: number;
  churnRate: number;
}

export interface SummaryOptions {
  grossMargin?: number;
  churnRate?: number;
}

/**
 * Ringkasan metrik monetisasi satu bulan.
 * Semua rasio dikembalikan sebagai null (bukan NaN/Infinity) saat pembagi nol.
 */
export async function getMonetizationSummary(
  crdb: CrdbClient,
  period: string,
  opts: SummaryOptions = {},
): Promise<MonetizationSummary> {
  const { start, end } = monthBounds(period);
  const prevEnd = start;
  const prevStart = new Date(prevEnd.getTime());
  prevStart.setUTCMonth(prevStart.getUTCMonth() - 1);

  const [
    revenue,
    mau,
    payingUsers,
    churnedMRR,
    funnel,
    cac,
    mrrAtStart,
    userChurnRate,
  ] = await Promise.all([
    getRevenueForMonth(crdb, period),
    getMAU(crdb, period),
    getPayingUsers(crdb, period),
    getChurnedMRR(crdb, period),
    getCheckoutFunnel(crdb, period),
    calculateCAC(crdb, period),
    getRevenueForMonth(crdb, `${prevStart.getUTCFullYear()}-${String(prevStart.getUTCMonth() + 1).padStart(2, "0")}`),
    getUserChurnRate(crdb, period),
  ]);

  const grossMargin = opts.grossMargin ?? 0.7;
  const churnRate = opts.churnRate ?? userChurnRate;

  const arpu = safeDiv(revenue, mau);
  const arppu = safeDiv(revenue, payingUsers);
  const ltv = arpu === null ? null : safeDiv(arpu * grossMargin, churnRate);
  const ltvCac = ltv === null ? null : safeDiv(ltv, cac.cac ?? 0);
  const revenueChurnRate = safeDiv(churnedMRR, mrrAtStart);
  const checkoutAbandonmentRate = safeDiv(funnel.started - funnel.completed, funnel.started);
  const failedPaymentRate = safeDiv(funnel.failed, funnel.failed + funnel.succeeded);

  return {
    mrr: round2(revenue) ?? 0,
    arr: round2(revenue * 12) ?? 0,
    arpu: round2(arpu),
    arppu: round2(arppu),
    ltv: round2(ltv),
    ltvCac: round2(ltvCac),
    cac: round2(cac.cac),
    revenueChurnRate: round2(revenueChurnRate),
    checkoutAbandonmentRate: round2(checkoutAbandonmentRate),
    failedPaymentRate: round2(failedPaymentRate),
    grossMargin,
    churnRate: round2(churnRate) ?? 0,
  };
}
