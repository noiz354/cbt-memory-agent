/**
 * Cluster health gate — cek status cluster CockroachDB Cloud sebelum menjalankan
 * reflection loop (Addition A).
 *
 * Hybrid:
 *   1. ccloud CLI (`ccloud cluster list -o json`) — filter `.id` == CRDB_CLUSTER_ID.
 *   2. Fallback REST v1 (`GET /api/v1/clusters/<id>`) — Bearer CCLOUD_API_KEY
 *      (atau CCLOUD_MCP_API_KEY), dipakai di Lambda yang tidak punya binary ccloud.
 *
 * Semua failure (no id/key, binary down, network, timeout, parse) menghasilkan
 * `{ healthy:true, skipped:true }` — caller melanjutkan loop seperti biasa.
 * Audit CLUSTER_HEALTH_CHECK hanya ditulis ketika status berhasil terbaca.
 */

import { execFile } from "child_process";
import type { CrdbClient } from "./crdb";
import { logger } from "./logger";

export interface ClusterHealth {
  healthy: boolean;
  status: string;
  nodeCount: number | null;
  skipped: boolean;
}

export const CLUSTER_HEALTH_TIMEOUT_MS =
  Number(process.env.CCLOUD_HEALTH_TIMEOUT_MS ?? 10000) || 10000;
export const CLUSTER_HEALTH_AUDIT_TYPE = "CLUSTER_HEALTH_CHECK";
export const CCLOUD_CLUSTERS_API = "https://cockroachlabs.cloud/api/v1/clusters";

const HEALTHY_STATUSES = new Set(["CREATED", "UNSPECIFIED"]);

interface RawCluster {
  id?: string;
  state?: string;
  operation_status?: string;
  regions?: { node_count?: number }[];
}

function parseHealth(raw: RawCluster): { status: string; nodeCount: number | null } {
  const status = String(raw.operation_status ?? raw.state ?? "UNKNOWN");
  const nodeCount = Array.isArray(raw.regions)
    ? raw.regions.reduce((sum, r) => sum + (typeof r.node_count === "number" ? r.node_count : 0), 0)
    : null;
  return { status, nodeCount };
}

/** Jalankan `ccloud cluster list -o json` dan temukan cluster dengan id ini. */
function runCcloudList(clusterId: string): Promise<RawCluster> {
  return new Promise((resolve, reject) => {
    execFile(
      "ccloud",
      ["cluster", "list", "-o", "json"],
      { timeout: CLUSTER_HEALTH_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const clusters = JSON.parse(stdout) as RawCluster[];
          const found = clusters.find((c) => c.id === clusterId);
          if (!found) return reject(new Error(`cluster ${clusterId} not found`));
          resolve(found);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      },
    );
  });
}

/** Fallback REST v1 — dipakai di Lambda (tanpa binary ccloud). */
async function fetchClusterViaRest(clusterId: string): Promise<RawCluster> {
  const key = process.env.CCLOUD_API_KEY ?? process.env.CCLOUD_MCP_API_KEY;
  if (!key) throw new Error("no CCLOUD API key configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLUSTER_HEALTH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${CCLOUD_CLUSTERS_API}/${clusterId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`REST HTTP ${resp.status}`);
    return (await resp.json()) as RawCluster;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cek health cluster. Tidak pernah melempar: gagal → `{healthy:true, skipped:true}`.
 * Sukses → tulis audit_events type=CLUSTER_HEALTH_CHECK (user_id NULL) + log.
 */
export async function checkClusterHealth(crdb: CrdbClient): Promise<ClusterHealth> {
  const startMs = Date.now();
  const clusterId = process.env.CRDB_CLUSTER_ID ?? "";
  let raw: RawCluster | null = null;

  try {
    if (clusterId) {
      try {
        raw = await runCcloudList(clusterId);
      } catch {
        raw = await fetchClusterViaRest(clusterId);
      }
    }
  } catch (err) {
    logger.warn("reflection.cluster_health_failed", "Cluster health check failed — continuing", {
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    });
    return { healthy: true, status: "UNKNOWN", nodeCount: null, skipped: true };
  }

  if (!raw) {
    return { healthy: true, status: "UNKNOWN", nodeCount: null, skipped: true };
  }

  const { status, nodeCount } = parseHealth(raw);
  const healthy = HEALTHY_STATUSES.has(status);

  try {
    await crdb.execute(
      `INSERT INTO audit_events (user_id, type, detail) VALUES ($2::uuid, $1, $3) ON CONFLICT DO NOTHING`,
      [
        CLUSTER_HEALTH_AUDIT_TYPE,
        null, // user_id NULL — event level cluster, bukan per-user
        JSON.stringify({ status, nodeCount, healthy, reason: healthy ? undefined : "degraded" }),
      ],
    );
  } catch (err) {
    logger.warn("reflection.cluster_health_audit_failed", "Cluster health audit insert failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("reflection.cluster_health", "Cluster health check", {
    status,
    nodeCount,
    healthy,
    durationMs: Date.now() - startMs,
  });

  return { healthy, status, nodeCount, skipped: false };
}
