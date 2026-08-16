/**
 * Unit tests — monetization lib + events handler.
 *
 * Tidak menyentuh CockroachDB: memakai mock CrdbClient dengan dispatch
 * berbasis substring SQL (first-match), sehingga setiap query mengembalikan
 * fixture sesuai kebutuhan.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_MONETIZATION_EVENTS,
  calculateCAC,
  getMonetizationSummary,
  partitionEvents,
  validateEventsPayload,
} from "../lib/monetization";
import { handleTrackEvents } from "../handlers/events";

/** Mock CrdbClient — rows per SQL substring. */
function crdbMock(spec: Record<string, unknown[]>): any {
  return {
    async query(sql: string, _params?: unknown[]) {
      for (const [match, rows] of Object.entries(spec)) {
        if (sql.includes(match)) return rows;
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

describe("validateEventsPayload / partitionEvents", () => {
  it("accepts a valid batch", () => {
    const res = validateEventsPayload({
      events: [
        { name: "checkout_started", properties: { plan_id: "pro", amount: 29 } },
        { name: "payment_succeeded", properties: { plan_id: "pro", amount: 29 } },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.events).toHaveLength(2);
  });

  it("rejects batches larger than 50 events", () => {
    const events = Array.from({ length: 51 }, () => ({ name: "checkout_started" }));
    const res = validateEventsPayload({ events });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/50/);
  });

  it("rejects non-object body / missing events array / non-object properties", () => {
    expect(validateEventsPayload("nope").ok).toBe(false);
    expect(validateEventsPayload({}).ok).toBe(false);
    expect(validateEventsPayload({ events: [{ name: "checkout_started", properties: [1] }] }).ok).toBe(false);
    expect(validateEventsPayload({ events: [{ properties: {} }] }).ok).toBe(false);
  });

  it("allowlist contains exactly the 6 monetization events", () => {
    expect(ALLOWED_MONETIZATION_EVENTS).toEqual([
      "checkout_started",
      "checkout_completed",
      "payment_succeeded",
      "payment_failed",
      "subscription_upgraded",
      "subscription_cancelled",
    ]);
  });

  it("partitionEvents keeps only allowlisted events", () => {
    const { valid, rejected } = partitionEvents([
      { name: "checkout_started" },
      { name: "evil_event" },
      { name: "payment_failed" },
    ]);
    expect(valid.map((e) => e.name)).toEqual(["checkout_started", "payment_failed"]);
    expect(rejected.map((e) => e.name)).toEqual(["evil_event"]);
  });
});

describe("calculateCAC", () => {
  it("computes CAC = spend / newPayingUsers", async () => {
    const crdb = crdbMock({
      marketing_ad_spend: [{ spend: "1000.00" }],
      "started_date >= $1::timestamptz": [{ count: "5" }],
    });
    const res = await calculateCAC(crdb, "2026-06");
    expect(res).toEqual({ spend: 1000, newPayingUsers: 5, cac: 200 });
  });

  it("returns cac:null when no new paying accounts (avoid div/0)", async () => {
    const crdb = crdbMock({
      marketing_ad_spend: [{ spend: "1000.00" }],
      "started_date >= $1::timestamptz": [{ count: "0" }],
    });
    const res = await calculateCAC(crdb, "2026-06");
    expect(res.cac).toBeNull();
    expect(res.spend).toBe(1000);
  });
});

describe("getMonetizationSummary", () => {
  it("never emits NaN/Infinity on an empty database", async () => {
    const crdb = crdbMock({});
    const summary = await getMonetizationSummary(crdb, "2026-06");
    for (const [k, v] of Object.entries(summary)) {
      if (v === null) continue;
      expect(Number.isFinite(v), `${k} should be finite or null`).toBe(true);
    }
    expect(summary.ltvCac).toBeNull();
  });

  it("computes ARPU/ARPPU/LTV/LTV:CAC/churn/checkout/failed correctly", async () => {
    const crdb = crdbMock({
      "billing_cycle = 'yearly'": [{ mrr: "1000.00" }],
      active_users: [{ count: "100" }],
      "ended_date >= $1::timestamptz": [{ count: "10" }],
      churn_deltas: [{ lost: "50.00" }],
      "checkout_started')": [{ started: "30", completed: "20", succeeded: "18", failed: "2" }],
      marketing_ad_spend: [{ spend: "1000.00" }],
      "started_date >= $1::timestamptz": [{ count: "10" }],
      subscription_cancelled: [{ count: "1" }],
    });
    const summary = await getMonetizationSummary(crdb, "2026-06");
    expect(summary.mrr).toBe(1000);
    expect(summary.arr).toBe(12000);
    expect(summary.arpu).toBe(10);
    expect(summary.arppu).toBe(100);
    expect(summary.cac).toBe(100);
    // churnRate default = 1 cancel / 10 paying = 0.1 → LTV = (10*0.7)/0.1 = 70
    expect(summary.churnRate).toBe(0.1);
    expect(summary.ltv).toBe(70);
    expect(summary.ltvCac).toBe(0.7);
    expect(summary.revenueChurnRate).toBe(0.05);
    expect(summary.checkoutAbandonmentRate).toBe(0.33);
    expect(summary.failedPaymentRate).toBe(0.1);
  });

  it("honors grossMargin/churnRate overrides for LTV", async () => {
    const crdb = crdbMock({});
    const summary = await getMonetizationSummary(crdb, "2026-06", {
      grossMargin: 0.8,
      churnRate: 0.05,
    });
    // empty DB: revenue=0, arpu=null → LTV null, tapi tidak error
    expect(summary.grossMargin).toBe(0.8);
    expect(summary.churnRate).toBe(0.05);
    expect(summary.ltv).toBeNull();
  });
});

describe("handleTrackEvents", () => {
  function makeEvent(body: unknown) {
    return { body: JSON.stringify(body) } as any;
  }

  it("inserts only allowlisted events and reports rejection", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const crdb = {
      async queryOne() {
        return null;
      },
      async execute(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
      },
    };
    const res = await handleTrackEvents(
      makeEvent({
        events: [
          { name: "checkout_started", properties: { plan_id: "pro", amount: 29 } },
          { name: "not-a-real-event" },
        ],
      }),
      crdb as any,
      "token-abcdefgh",
      "device-1",
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.inserted).toBe(1);
    expect(body.rejected).toBe(1);

    const insert = calls.find((c) => c.sql.includes("INSERT INTO user_events"));
    expect(insert).toBeDefined();
    expect(insert!.params[1]).toBe("checkout_started");
    expect(insert!.params[2]).toBe(JSON.stringify({ plan_id: "pro", amount: 29 }));
    expect(insert!.params[4]).toBe("device-1");
  });

  it("returns 400 on invalid JSON / empty batch", async () => {
    const crdb = {
      async queryOne() {
        return null;
      },
      async execute() {},
    };
    const badJson = await handleTrackEvents({ body: "{not json" } as any, crdb as any, "token-abcdefgh", "device-1");
    expect(badJson.statusCode).toBe(400);

    const emptyBatch = await handleTrackEvents(makeEvent({ events: [] }), crdb as any, "token-abcdefgh", "device-1");
    expect(emptyBatch.statusCode).toBe(400);
  });

  it("returns 422 when no event in batch is allowlisted", async () => {
    const crdb = {
      async queryOne() {
        return null;
      },
      async execute() {},
    };
    const res = await handleTrackEvents(
      makeEvent({ events: [{ name: "whatever" }] }),
      crdb as any,
      "token-abcdefgh",
      "device-1",
    );
    expect(res.statusCode).toBe(422);
  });

  it("derives CRISIS_ENGAGED / CRISIS_DISMISSED audit rows from crisis events", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const crdb = {
      async queryOne() {
        return null;
      },
      async execute(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
      },
    };
    const res = await handleTrackEvents(
      makeEvent({
        events: [
          { name: "crisis_triggered", properties: { reason: "suicidal ideation" } },
          { name: "crisis_resolved" },
          { name: "page_view" },
        ],
      }),
      crdb as any,
      "token-abcdefgh",
      "device-1",
    );
    expect(res.statusCode).toBe(201);

    const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
    expect(audit).toBeDefined();
    // params: [userId, type1, detail1, type2, detail2]
    expect(audit!.params[1]).toBe("CRISIS_ENGAGED");
    const engaged = JSON.parse(audit!.params[2] as string);
    expect(engaged.event).toBe("crisis_triggered");
    expect(engaged.reason).toBe("suicidal ideation");
    expect(audit!.params[3]).toBe("CRISIS_DISMISSED");
    const dismissed = JSON.parse(audit!.params[4] as string);
    expect(dismissed.event).toBe("crisis_resolved");
    expect(audit!.sql).toContain("ON CONFLICT DO NOTHING");
  });

  it("does not write audit rows when batch has no crisis events", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const crdb = {
      async queryOne() {
        return null;
      },
      async execute(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
      },
    };
    const res = await handleTrackEvents(
      makeEvent({ events: [{ name: "page_view" }] }),
      crdb as any,
      "token-abcdefgh",
      "device-1",
    );
    expect(res.statusCode).toBe(201);
    expect(calls.some((c) => c.sql.includes("INSERT INTO audit_events"))).toBe(false);
  });

  it("never throws when the crisis audit insert fails", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const crdb = {
      async queryOne() {
        return null;
      },
      async execute(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.includes("INSERT INTO audit_events")) throw new Error("audit boom");
      },
    };
    const res = await handleTrackEvents(
      makeEvent({ events: [{ name: "crisis_triggered" }] }),
      crdb as any,
      "token-abcdefgh",
      "device-1",
    );
    expect(res.statusCode).toBe(201);
  });
});
