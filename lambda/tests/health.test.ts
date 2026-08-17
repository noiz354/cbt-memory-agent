/**
 * Unit tests — handleHealth honesty.
 *
 * Badge "Backend ok" harus jujur: kuota LLM harian habis (quota_exhausted) →
 * status keseluruhan degraded, bukan "ok" (root cause bug-3: /credits 200
 * padahal chat 429). Ini memetakan hasil probe chat aktual ke payload /health.
 */

import { describe, expect, it, vi } from "vitest";
import { handleHealth } from "../handlers/health";

function llmMock(avail: { available: boolean; quotaExhausted: boolean }) {
  return { checkChatAvailability: vi.fn(async () => avail) } as any;
}

describe("handleHealth — LLM quota honesty", () => {
  it("reports degraded + llm=quota_exhausted when the free-tier daily quota is spent", async () => {
    const crdb: any = { healthCheck: vi.fn(async () => true) };
    const llm = llmMock({ available: false, quotaExhausted: true });
    const s3: any = { healthCheck: vi.fn(async () => true) };

    const res = await handleHealth(crdb, llm, s3);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.llm).toBe("quota_exhausted");
  });

  it("stays degraded (not ok) if another dependency is down even when LLM is fine", async () => {
    const crdb: any = { healthCheck: vi.fn(async () => false) };
    const llm = llmMock({ available: true, quotaExhausted: false });
    const s3: any = { healthCheck: vi.fn(async () => true) };

    const res = await handleHealth(crdb, llm, s3);
    const body = JSON.parse(res.body);

    expect(body.status).toBe("degraded");
    expect(body.llm).toBe("available");
    expect(body.crdb).toBe("disconnected");
  });

  it("reports ok only when every dependency (incl. LLM chat probe) is healthy", async () => {
    const crdb: any = { healthCheck: vi.fn(async () => true) };
    const llm = llmMock({ available: true, quotaExhausted: false });
    const s3: any = { healthCheck: vi.fn(async () => true) };

    const res = await handleHealth(crdb, llm, s3);
    const body = JSON.parse(res.body);

    expect(body.status).toBe("ok");
    expect(body.llm).toBe("available");
  });

  it("maps a generic LLM outage to llm=unavailable", async () => {
    const crdb: any = { healthCheck: vi.fn(async () => true) };
    const llm = llmMock({ available: false, quotaExhausted: false });
    const s3: any = { healthCheck: vi.fn(async () => true) };

    const res = await handleHealth(crdb, llm, s3);
    const body = JSON.parse(res.body);

    expect(body.status).toBe("degraded");
    expect(body.llm).toBe("unavailable");
  });
});