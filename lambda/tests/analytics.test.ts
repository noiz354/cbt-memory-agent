/**
 * Unit tests — FASE 2/3 analytics lib + handlers.
 *
 * Tidak menyentuh CockroachDB. getFunnel/getActivity memanggil query yang SQL-nya
 * identik antar-panggilan (beda hanya params), jadi mock dispatch berbasis
 * matcher (sql substring + params[0]).
 */

import { describe, expect, it } from "vitest";
import {
  ACTIVATION_FUNNEL_STEPS,
  getActivity,
  getFunnel,
  getRetention,
} from "../lib/analytics";
import {
  handleAnalyticsActivity,
  handleAnalyticsFunnel,
  handleAnalyticsRetention,
} from "../handlers/analytics";

type Matcher = { match: (sql: string, params?: unknown[]) => boolean; rows: unknown[] };

/** Mock CrdbClient — first matcher wins. */
function crdbMock(matchers: Matcher[]): any {
  return {
    async query(sql: string, params?: unknown[]) {
      for (const m of matchers) {
        if (m.match(sql, params)) return m.rows;
      }
      return [];
    },
    async queryOne(sql: string, params?: unknown[]) {
      const rows = await this.query(sql, params);
      return rows[0] ?? null;
    },
    async execute() {},
    async executeCount() {
      return 0;
    },
  };
}

const EVENT_MATCH =
  (name: string) =>
  (sql: string, params?: unknown[]): boolean =>
    sql.includes("COUNT(DISTINCT user_id)") && params?.[0] === name;

const START_MATCH =
  (iso: string) =>
  (sql: string, params?: unknown[]): boolean =>
    sql.includes("active_users") && params?.[0] === iso;

describe("getFunnel", () => {
  it("counts distinct users per step and computes sequential conversion", async () => {
    const counts: Record<string, string> = {
      signup_completed: "100",
      onboarding_completed: "80",
      message_sent: "50",
      session_finalized: "30",
    };
    const crdb = crdbMock(
      Object.entries(counts).map(([name, count]) => ({
        match: EVENT_MATCH(name),
        rows: [{ count }],
      })),
    );
    const res = await getFunnel(crdb, "2026-06");
    expect(res.steps).toEqual([
      { name: "signup_completed", users: 100 },
      { name: "onboarding_completed", users: 80 },
      { name: "message_sent", users: 50 },
      { name: "session_finalized", users: 30 },
    ]);
    expect(res.conversion).toEqual([
      { from: "signup_completed", to: "onboarding_completed", rate: 0.8 },
      { from: "onboarding_completed", to: "message_sent", rate: 0.63 },
      { from: "message_sent", to: "session_finalized", rate: 0.6 },
    ]);
  });

  it("defaults to the activation funnel steps", async () => {
    expect(ACTIVATION_FUNNEL_STEPS).toEqual([
      "signup_completed",
      "onboarding_completed",
      "message_sent",
      "session_finalized",
    ]);
  });

  it("returns null rate when previous step has zero users (avoid div/0)", async () => {
    const crdb = crdbMock([{ match: EVENT_MATCH("signup_completed"), rows: [{ count: "0" }] }]);
    const res = await getFunnel(crdb, "2026-06");
    expect(res.conversion[0].rate).toBeNull();
  });
});

describe("getActivity", () => {
  it("computes dau/wau/mau + sticky factor (dau/mau)", async () => {
    const crdb = crdbMock([
      { match: START_MATCH("2026-06-01T00:00:00.000Z"), rows: [{ count: "500" }] }, // mau
      { match: START_MATCH("2026-06-24T00:00:00.000Z"), rows: [{ count: "300" }] }, // wau
      { match: START_MATCH("2026-06-30T00:00:00.000Z"), rows: [{ count: "120" }] }, // dau
    ]);
    const res = await getActivity(crdb, "2026-06");
    expect(res).toEqual({ dau: 120, wau: 300, mau: 500, stickyFactor: 0.24 });
  });

  it("returns null sticky factor when mau is zero", async () => {
    const crdb = crdbMock([
      { match: START_MATCH("2026-06-01T00:00:00.000Z"), rows: [{ count: "0" }] },
      { match: START_MATCH("2026-06-24T00:00:00.000Z"), rows: [{ count: "0" }] },
      { match: START_MATCH("2026-06-30T00:00:00.000Z"), rows: [{ count: "0" }] },
    ]);
    const res = await getActivity(crdb, "2026-06");
    expect(res.stickyFactor).toBeNull();
  });
});

describe("getRetention", () => {
  it("maps cohort rows incl. retention_pct rounding and null safety", async () => {
    const crdb = crdbMock([
      {
        match: (sql: string) => sql.includes("sizes AS"),
        rows: [
          { cohort: "2026-01-01", age: 0, size: 10, active: 10, retention_pct: "100.00" },
          { cohort: "2026-01-01", age: 1, size: 10, active: 8, retention_pct: "80.00" },
          { cohort: "2026-03-01", age: 0, size: 20, active: 5, retention_pct: "25.00" },
          { cohort: "2026-03-01", age: 1, size: 20, active: 0, retention_pct: null },
        ],
      },
    ]);
    const res = await getRetention(crdb, "2026-06");
    expect(res.cohorts).toEqual([
      { cohort: "2026-01-01", age: 0, size: 10, active: 10, retentionPct: 100 },
      { cohort: "2026-01-01", age: 1, size: 10, active: 8, retentionPct: 80 },
      { cohort: "2026-03-01", age: 0, size: 20, active: 5, retentionPct: 25 },
      { cohort: "2026-03-01", age: 1, size: 20, active: 0, retentionPct: null },
    ]);
  });

  it("uses cohortsStart (period minus 5 months) as the cohort window start", async () => {
    let seen: unknown[] | undefined;
    const crdb = crdbMock([
      {
        match: (sql: string, params?: unknown[]) => {
          if (sql.includes("sizes AS")) {
            seen = params;
            return true;
          }
          return false;
        },
        rows: [],
      },
    ]);
    await getRetention(crdb, "2026-06");
    expect(seen?.[0]).toBe("2026-01-01T00:00:00.000Z");
    expect(seen?.[1]).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("analytics handlers", () => {
  const empty = crdbMock([]);

  it("funnel returns 200 with steps + conversion", async () => {
    const res = await handleAnalyticsFunnel({ period: "2026-06" }, empty);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.v).toBe(1);
    expect(body.period).toBe("2026-06");
    expect(body.steps).toHaveLength(4);
    expect(body.conversion).toHaveLength(3);
  });

  it("rejects an invalid period (400)", async () => {
    const res = await handleAnalyticsFunnel({ period: "junk" }, empty);
    expect(res.statusCode).toBe(400);
  });

  it("rejects a steps list containing an event outside the tracked catalog (400)", async () => {
    const res = await handleAnalyticsFunnel(
      { period: "2026-06", steps: "signup_completed,not_a_real_event" },
      empty,
    );
    expect(res.statusCode).toBe(400);
  });

  it("activity returns 200 with dau/wau/mau/stickyFactor", async () => {
    const res = await handleAnalyticsActivity({ period: "2026-06" }, empty);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dau).toBeTypeOf("number");
    expect(body.stickyFactor).toBeNull();
  });

  it("retention returns 200 with cohorts array", async () => {
    const res = await handleAnalyticsRetention({ period: "2026-06" }, empty);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.cohorts)).toBe(true);
  });
});
