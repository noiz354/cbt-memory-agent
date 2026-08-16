/**
 * Contract test — HTTP trace contract + source-level guard.
 *
 * 1) Integration: SEMUA response (401/404) menyertakan `X-Trace-Id`, dan
 *    traceparent masuk (W3C) → X-Trace-Id == traceId (Loki ↔ Tempo correlation).
 * 2) Static: scan handler.ts — setiap route cabang didelegasikan ke handler,
 *    dan semua response melewati `finalizeResponse` (gagal PR kalau ada endpoint
 *    baru yang menambah response tanpa meneruskan context).
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mock DB — contract test tidak boleh menyentuh CockroachDB.
vi.mock("../lib/crdb", () => ({
  CrdbClient: class {
    async query() {
      return [];
    }
    async queryOne() {
      return null;
    }
    async execute() {}
    async executeCount() {
      return 0;
    }
    async healthCheck() {
      return false;
    }
    async close() {}
  },
}));

import { handler } from "../handler";

const HANDLER_SRC = readFileSync(fileURLToPath(new URL("../handler.ts", import.meta.url)), "utf8");

type HandlerEvent = Parameters<typeof handler>[0];

function makeEvent(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): HandlerEvent {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers,
    queryStringParameters: {},
  } as unknown as HandlerEvent;
}

describe("HTTP trace contract (integration)", () => {
  it("401 (missing auth) response carries X-Trace-Id", async () => {
    const res = await handler(makeEvent("GET", "/api/v1/memory"));
    expect(res.statusCode).toBe(401);
    expect(res.headers?.["X-Trace-Id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("404 (unknown route) response carries X-Trace-Id", async () => {
    const res = await handler(
      makeEvent("GET", "/api/v1/does-not-exist", {
        authorization: "Bearer abcdefgh12345678",
        "x-device-id": "dev-1",
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.headers?.["X-Trace-Id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("propagates incoming traceparent → X-Trace-Id equals traceId (W3C)", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const parentId = "00f067aa0ba902b7";
    const res = await handler(
      makeEvent("GET", "/api/v1/memory", { traceparent: `00-${traceId}-${parentId}-01` }),
    );
    expect(res.statusCode).toBe(401);
    expect(res.headers?.["X-Trace-Id"]).toBe(traceId);
  });

  it("OPTIONS/CORS preflight is not blocked by the contract", async () => {
    const res = await handler(
      makeEvent("OPTIONS", "/api/v1/chat/turn", { origin: "http://localhost:5173" }),
    );
    // OPTIONS bukan public route → 401, tetap membawa X-Trace-Id.
    expect([401, 404]).toContain(res.statusCode);
    expect(res.headers?.["X-Trace-Id"]).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("HTTP trace contract (static)", () => {
  function bodyBetween(start: string, end: string): string {
    const from = HANDLER_SRC.indexOf(start);
    const to = HANDLER_SRC.indexOf(end, from);
    if (from === -1 || to === -1) return "";
    return HANDLER_SRC.slice(from, to);
  }

  it("handler() applies finalizeResponse to every HTTP response path", () => {
    const handlerBody = bodyBetween("export async function handler", "interface RouteContext");
    // Branch EventBridge (scheduled reflection job) bukan HTTP request, jadi tidak
    // melalui finalizeResponse — scan dibatasi ke jalur HTTP mulai dari routing.
    const httpBody = handlerBody.slice(handlerBody.indexOf("const path = event.rawPath"));
    const bareReturns = httpBody.match(/return\s+(?!finalizeResponse\()/g) ?? [];
    expect(bareReturns).toEqual([]);
    const finalizeCalls = httpBody.match(/finalizeResponse\(/g) ?? [];
    expect(finalizeCalls.length).toBeGreaterThanOrEqual(2); // sukses + catch 500
  });

  it("handler() keeps the EventBridge scheduled reflection branch", () => {
    const handlerBody = bodyBetween("export async function handler", "interface RouteContext");
    expect(handlerBody).toContain('event.source === "agent.memory"');
    expect(handlerBody).toContain('event["detail-type"] === "reflect"');
    expect(handlerBody).toContain("handleReflect");
  });

  it("every route branch delegates to a handler (no inline bypass)", () => {
    const routeBody = bodyBetween("async function route", "function finalizeResponse");
    // Setiap dispatch route (if method===...) memiliki return ke handler.
    const dispatchCount = (routeBody.match(/if \(method === /g) ?? []).length;
    const handlerReturns = (routeBody.match(/return await handle/g) ?? []).length;
    expect(handlerReturns).toBe(dispatchCount);
    // Satu-satunya return inline adalah response auth-failure (401) yang
    // tetap dilewatkan ke finalizeResponse oleh handler(); bukan response route.
    const inlineReturns = routeBody.match(/return \{/g) ?? [];
    expect(inlineReturns.length).toBeLessThanOrEqual(1);
  });

  it("finalizeResponse injects X-Trace-Id from the active span", () => {
    const finalizeBody = bodyBetween("function finalizeResponse", "function corsHeaders");
    expect(finalizeBody).toContain('"X-Trace-Id"');
    expect(finalizeBody).toContain("span.spanContext().traceId");
  });

  it("required public + core routes are registered", () => {
    for (const route of [
      "/api/v1/health",
      "/api/v1/auth/magic-link",
      "/api/v1/auth/callback",
      "/api/v1/telemetry",
      "/api/v1/chat/turn",
      "/api/v1/memory",
      "/api/v1/memory/semantic",
      "/api/v1/session",
      "/api/v1/sessions",
      "/api/v1/export",
      "/api/v1/purge",
      "/api/v1/attachments",
      "/api/v1/attachments/presign",
      "/api/v1/metrics",
      "/api/v1/events",
      "/api/v1/monetization/cac",
      "/api/v1/monetization/summary",
      "/api/v1/analytics/funnel",
      "/api/v1/analytics/activity",
      "/api/v1/analytics/retention",
    ]) {
      expect(HANDLER_SRC).toContain(`path === "${route}"`);
    }
  });
});
