/**
 * Analytics Library — funnel, activity (DAU/WAU/MAU), retention cohort.
 *
 * Semua query berjalan terhadap CockroachDB via CrdbClient (parameterized).
 * Setiap pembagian memakai NULLIF(denominator, 0) → `null` saat data belum ada.
 * Agregat lintas-user: wajar untuk aplikasi single-user/demo (lihat ADR-003).
 */

import { CrdbClient } from "./crdb";
import { monthBounds } from "./monetization";

export interface FunnelStep {
  name: string;
  users: number;
}

export interface FunnelConversion {
  from: string;
  to: string;
  rate: number | null;
}

export interface FunnelResult {
  steps: FunnelStep[];
  conversion: FunnelConversion[];
}

export interface ActivityResult {
  dau: number;
  wau: number;
  mau: number;
  stickyFactor: number | null;
}

export interface CohortRow {
  cohort: string; // "YYYY-MM-DD" (tanggal 1 bulan cohort)
  age: number; // bulan sejak cohort
  size: number; // jumlah user di cohort
  active: number; // distinct user aktif di bucket usia tsb
  retentionPct: number | null;
}

export interface RetentionResult {
  cohorts: CohortRow[];
}

/** Bounds waktu untuk YYYY-MM (bulan) atau YYYY-MM-DD (hari). */
export function periodBounds(period: string): { start: Date; end: Date } {
  const parts = period.split("-").map(Number);
  if (parts.length === 3) {
    const [y, m, d] = parts;
    const start = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  return monthBounds(period);
}

/** Jumlah distinct user yang memicu event tertentu dalam bounds. */
async function countDistinctUsers(
  crdb: CrdbClient,
  eventName: string,
  start: Date,
  end: Date,
): Promise<number> {
  const row = await crdb.queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT user_id)::int::text AS count
     FROM user_events
     WHERE event_name = $1::string
       AND occurred_at >= $2::timestamptz
       AND occurred_at < $3::timestamptz`,
    [eventName, start.toISOString(), end.toISOString()],
  );
  const n = Number(row?.count);
  return Number.isFinite(n) ? n : 0;
}

export const ACTIVATION_FUNNEL_STEPS = [
  "signup_completed",
  "onboarding_completed",
  "message_sent",
  "session_finalized",
] as const;

/**
 * Funnel aktivasi: distinct user per step + konversi antar-step.
 * Default: signup_completed → onboarding_completed → message_sent → session_finalized.
 */
export async function getFunnel(
  crdb: CrdbClient,
  period: string,
  steps: readonly string[] = ACTIVATION_FUNNEL_STEPS,
): Promise<FunnelResult> {
  const { start, end } = periodBounds(period);
  const stepUsers = new Map<string, number>();
  for (const name of steps) {
    stepUsers.set(name, await countDistinctUsers(crdb, name, start, end));
  }

  const funnel: FunnelStep[] = steps.map((name) => ({
    name,
    users: stepUsers.get(name) ?? 0,
  }));

  const conversion: FunnelConversion[] = [];
  for (let i = 1; i < steps.length; i++) {
    const prev = stepUsers.get(steps[i - 1]) ?? 0;
    const cur = stepUsers.get(steps[i]) ?? 0;
    conversion.push({
      from: steps[i - 1],
      to: steps[i],
      rate: prev === 0 ? null : round2(cur / prev),
    });
  }

  return { steps: funnel, conversion };
}

/** Distinct user aktif di bound (users.last_active ∪ user_events). */
async function activeDistinct(crdb: CrdbClient, start: Date, end: Date): Promise<number> {
  const row = await crdb.queryOne<{ count: string }>(
    `SELECT COUNT(*)::int::text AS count FROM (
       SELECT id FROM users WHERE last_active >= $1::timestamptz AND last_active < $2::timestamptz
       UNION
       SELECT DISTINCT user_id FROM user_events WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
     ) AS active_users`,
    [start.toISOString(), end.toISOString()],
  );
  const n = Number(row?.count);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aktivitas: DAU (hari terakhir), WAU (7 hari terakhir), MAU (bulan), sticky = DAU/MAU.
 * Sticky factor memakai MAU bulanan agar konsisten dengan FASE 4 (getMAU).
 */
export async function getActivity(crdb: CrdbClient, period: string): Promise<ActivityResult> {
  const { start, end } = periodBounds(period);
  const mau = await activeDistinct(crdb, start, end);
  const dayMs = 24 * 60 * 60 * 1000;
  const wauStart = new Date(end.getTime() - 7 * dayMs);
  const dauStart = new Date(end.getTime() - 1 * dayMs);
  const [wau, dau] = await Promise.all([
    activeDistinct(crdb, wauStart, end),
    activeDistinct(crdb, dauStart, end),
  ]);
  return { dau, wau, mau, stickyFactor: mau === 0 ? null : round2(dau / mau) };
}

/**
 * Retention cohort: cohort = bulan users.created_at; umur = selisih bulan; % aktif
 * kembali di bulan umur tsb (active = muncul di user_events ATAU users.last_active).
 */
export async function getRetention(crdb: CrdbClient, period: string): Promise<RetentionResult> {
  const { start, end } = periodBounds(period);
  const cohortsStart = new Date(start.getTime());
  cohortsStart.setUTCMonth(cohortsStart.getUTCMonth() - 5); // 6 bulan jendela cohort

  const rows = await crdb.query<{ cohort: string; age: number; size: number; active: number; retention_pct: string }>(
    `WITH cohorts AS (
       SELECT id, date_trunc('month', created_at)::date AS cohort
       FROM users
       WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
     ),
     sizes AS (
       SELECT cohort, COUNT(*)::int AS size FROM cohorts GROUP BY cohort
     ),
     activity AS (
       SELECT user_id, date_trunc('month', occurred_at)::date AS active_month
       FROM user_events WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
       UNION
       SELECT id, date_trunc('month', last_active)::date FROM users
       WHERE last_active >= $1::timestamptz AND last_active < $2::timestamptz
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
     SELECT
       cohort::text AS cohort,
       age,
       size,
       COUNT(DISTINCT user_id)::int AS active,
       (COUNT(DISTINCT user_id)::numeric / NULLIF(size, 0) * 100)::numeric::text AS retention_pct
     FROM matched
     GROUP BY cohort, age, size
     ORDER BY cohort, age`,
    [cohortsStart.toISOString(), end.toISOString()],
  );

  const cohorts: CohortRow[] = rows.map((r) => ({
    cohort: r.cohort,
    age: Number(r.age),
    size: Number(r.size),
    active: Number(r.active),
    retentionPct:
      r.retention_pct === null || r.retention_pct === undefined || r.retention_pct === ""
        ? null
        : Number.isFinite(Number(r.retention_pct))
          ? round2(Number(r.retention_pct))
          : null,
  }));

  return { cohorts };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
