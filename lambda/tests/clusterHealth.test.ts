/**
 * Unit tests — cluster health gate (lambda/lib/clusterHealth.ts).
 *
 * `checkClusterHealth`: hybrid ccloud CLI → REST v1 fallback. Semua failure
 * (no id/key, binary down, network, timeout, parse) menghasilkan
 * `{ healthy:true, skipped:true }` agar caller melanjutkan loop —
 * TIDAK pernah melempar keluar. Audit CLUSTER_HEALTH_CHECK hanya ditulis
 * ketika health check berhasil (status terbaca).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "child_process";
import { checkClusterHealth, CLUSTER_HEALTH_AUDIT_TYPE } from "../lib/clusterHealth";

const CLUSTER_ID = "87275047-fbf8-4f18-8b8d-a5ff97a335e3";

const originalFetch = globalThis.fetch;

function crdbMock() {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const crdb: any = {
    queries,
    async execute(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
    },
    async query() {
      return [];
    },
  };
  return crdb;
}

function ccloudOk(payload: unknown) {
  (execFile as any).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, JSON.stringify(payload));
    },
  );
}

function ccloudFail(err: Error) {
  (execFile as any).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(err, "");
    },
  );
}

function restOk(body: unknown) {
  globalThis.fetch = vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => body,
      }) as unknown as Response,
  ) as any;
}

beforeEach(() => {
  (execFile as any).mockReset();
  process.env.CRDB_CLUSTER_ID = CLUSTER_ID;
  process.env.CCLOUD_API_KEY = "ccdb-test-key";
  delete process.env.CCLOUD_MCP_API_KEY;
  delete process.env.CCLOUD_HEALTH_TIMEOUT_MS;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.CRDB_CLUSTER_ID;
  delete process.env.CCLOUD_API_KEY;
  delete process.env.CCLOUD_MCP_API_KEY;
  delete process.env.CCLOUD_HEALTH_TIMEOUT_MS;
});

describe("checkClusterHealth", () => {
  it("returns healthy via ccloud CLI (no REST call) + writes audit with NULL user", async () => {
    ccloudOk([
      {
        id: CLUSTER_ID,
        state: "CREATED",
        operation_status: "UNSPECIFIED",
        regions: [{ node_count: 0 }, { node_count: 3 }],
      },
    ]);
    globalThis.fetch = vi.fn() as any;
    const crdb = crdbMock();

    const res = await checkClusterHealth(crdb);

    expect(res.healthy).toBe(true);
    expect(res.status).toBe("UNSPECIFIED"); // operation_status preferred
    expect(res.nodeCount).toBe(3); // sum over regions
    expect(res.skipped).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const audit = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"));
    expect(audit?.params?.[0]).toBe(CLUSTER_HEALTH_AUDIT_TYPE);
    expect(audit?.params?.[1]).toBeNull(); // user_id NULL (cluster-level event)
    const detail = JSON.parse(audit?.params?.[2] as string);
    expect(detail.healthy).toBe(true);
    expect(detail.status).toBe("UNSPECIFIED");
  });

  it("falls back to REST v1 when ccloud CLI fails", async () => {
    ccloudFail(new Error("ENOENT"));
    restOk({ state: "CREATED", operation_status: "UNSPECIFIED", regions: [{ node_count: 0 }] });
    const crdb = crdbMock();

    const res = await checkClusterHealth(crdb);

    expect(res.healthy).toBe(true);
    expect(res.status).toBe("UNSPECIFIED");
    expect(res.nodeCount).toBe(0);
    expect(res.skipped).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports unhealthy (skipped:false) when cluster is degraded", async () => {
    ccloudFail(new Error("ENOENT"));
    restOk({ state: "DEGRADED", operation_status: "NOT_READY", regions: [] });
    const crdb = crdbMock();

    const res = await checkClusterHealth(crdb);

    expect(res.healthy).toBe(false);
    expect(res.skipped).toBe(false);
    expect(res.status).toBe("NOT_READY");

    const audit = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"));
    const detail = JSON.parse(audit?.params?.[2] as string);
    expect(detail.healthy).toBe(false);
  });

  it("returns skipped:true (no audit) when both ccloud and REST fail", async () => {
    ccloudFail(new Error("ENOENT"));
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    const crdb = crdbMock();

    const res = await checkClusterHealth(crdb);

    expect(res.skipped).toBe(true);
    expect(res.healthy).toBe(true);
    expect(crdb.queries.some((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"))).toBe(false);
  });

  it("returns skipped:true with no network when CRDB_CLUSTER_ID missing", async () => {
    delete process.env.CRDB_CLUSTER_ID;
    globalThis.fetch = vi.fn() as any;
    const crdb = crdbMock();

    const res = await checkClusterHealth(crdb);

    expect(res.skipped).toBe(true);
    expect(res.healthy).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect((execFile as any).mock.calls.length).toBe(0);
  });
});
