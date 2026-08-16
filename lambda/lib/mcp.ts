/**
 * CockroachDB Cloud Managed MCP — client minimal & read-only untuk reflection.
 *
 * "Step 1.5" di reflection loop: ambil core facts user yang sudah verified dari
 * memory_nodes via MCP `select_query`, kirim ke LLM sebagai konteks tambahan
 * agar reflection tidak menduplikasi fakta yang sudah dikenal.
 *
 * Desain:
 *  - Read-only: hanya memanggil tool `select_query`. Semua write tetap lewat pg.Pool.
 *  - Stateless: setiap call re-establish HTTPS+SSE (cron 6 jam → tanpa pooling).
 *  - Timeout (AbortSignal.timeout) → hang diubah jadi throw → graceful degradation.
 *  - Kegagalan MCP tidak pernah menggagalkan reflection (catch → EMPTY_MCP_CONTEXT).
 */

import { logger } from "./logger";

export interface McpExistingFact {
  title: string;
  excerpt: string;
}

export interface McpContext {
  used: boolean;
  factsCount: number;
  facts: McpExistingFact[];
}

export const EMPTY_MCP_CONTEXT: McpContext = { used: false, factsCount: 0, facts: [] };

export const MCP_ENDPOINT = "https://cockroachlabs.cloud/mcp";
export const MCP_CLUSTER_ID = process.env.MCP_CLUSTER_ID ?? "87275047-fbf8-4f18-8b8d-a5ff97a335e3";
export const MCP_MAX_FACTS = 25;
export const MCP_FETCH_TIMEOUT_MS = Number(process.env.MCP_FETCH_TIMEOUT_MS ?? 5000) || 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mcpApiKey(): string {
  return process.env.CCLOUD_MCP_API_KEY ?? process.env.CCLOUD_API_KEY ?? "";
}

/**
 * Ambil core facts user yang verified via MCP (read-only).
 * Semua failure → log + EMPTY_MCP_CONTEXT (graceful degradation).
 */
export async function fetchExistingCoreFacts(userId: string): Promise<McpContext> {
  const startMs = Date.now();
  let success = false;
  let factsCount = 0;

  try {
    const key = mcpApiKey();
    if (!key) {
      logger.warn("reflection.mcp_failed", "MCP key not set — continuing without context", {
        userId,
        err: "missing_mcp_key",
      });
      return EMPTY_MCP_CONTEXT;
    }
    if (!UUID_RE.test(userId)) {
      logger.warn("reflection.mcp_failed", "Invalid user id — continuing without context", {
        userId,
        err: "invalid_user_id",
      });
      return EMPTY_MCP_CONTEXT;
    }

    const query =
      "SELECT title, excerpt FROM memory_nodes " +
      "WHERE user_id = '" +
      userId +
      "' AND kind = 'core' AND verified = true " +
      "ORDER BY last_touched DESC LIMIT " +
      MCP_MAX_FACTS;

    const rows = await callSelectQuery(key, query);
    const facts = rows
      .map((r) => ({
        title: String(r.title ?? "").slice(0, 60),
        excerpt: String(r.excerpt ?? "").slice(0, 200),
      }))
      .filter((f) => f.title.trim().length > 0)
      .slice(0, MCP_MAX_FACTS);

    success = true;
    factsCount = facts.length;
    return { used: true, factsCount, facts };
  } catch (err) {
    logger.warn("reflection.mcp_failed", "MCP select_query failed — continuing without context", {
      userId,
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    });
    return EMPTY_MCP_CONTEXT;
  } finally {
    logger.info("reflection.mcp_query", "MCP select_query", {
      userId,
      durationMs: Date.now() - startMs,
      factsCount,
      success,
    });
  }
}

interface SseMessage {
  error?: { message?: string };
  result?: { content?: { type?: string; text?: string }[] };
}

async function callSelectQuery(key: string, query: string): Promise<McpExistingFact[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-cluster-id": MCP_CLUSTER_ID,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "select_query", arguments: { database: "defaultdb", query } },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`MCP HTTP ${resp.status} ${resp.statusText}`);
    return await parseSseResult(resp);
  } finally {
    clearTimeout(timer);
  }
}

async function parseSseResult(resp: Response): Promise<McpExistingFact[]> {
  const text = await resp.text();
  const dataLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());

  for (const line of dataLines) {
    try {
      const msg = JSON.parse(line) as SseMessage;
      if (msg.error) throw new Error(`MCP error: ${msg.error.message ?? "unknown"}`);
      for (const c of msg.result?.content ?? []) {
        if (c.type === "text" && c.text) {
          const parsed = JSON.parse(c.text) as { rows?: McpExistingFact[] };
          if (Array.isArray(parsed.rows)) return parsed.rows;
        }
      }
    } catch {
      // Skip malformed SSE lines
    }
  }
  return [];
}
