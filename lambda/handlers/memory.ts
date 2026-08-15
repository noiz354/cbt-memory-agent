/**
 * Memory Handlers — GET/POST/DELETE /api/v1/memory
 *
 * Persistent graph CRUD terhadap CockroachDB:
 * - GET    → list memory_nodes + memory_edges milik user (md5(token)::uuid)
 * - POST   → upsert node (ON CONFLICT id DO UPDATE) atau edge (anti-duplikat)
 * - DELETE → hapus node (edges ter-cascade via FK ON DELETE CASCADE)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { logger } from "../lib/logger";

interface MemoryNodeRow {
  id: string;
  kind: string;
  title: string;
  excerpt: string | null;
  tags: string[] | null;
  weight: number | null;
  confidence: number | null;
  verified: boolean | null;
  ref_count: number | null;
  last_touched: string | null;
  x: number | null;
  y: number | null;
  crisis_flag: boolean | null;
  created_at?: string | null;
}

interface MemoryEdgeRow {
  id: string;
  source: string;
  target: string;
  label: string;
  created_at: string;
}

const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
};

export async function handleListMemory(
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    const userId = await getUserId(crdb, token);

    const nodes = await crdb.query<MemoryNodeRow>(
      `SELECT id, kind, title, excerpt, tags, weight, confidence, verified,
              ref_count, last_touched, x, y, crisis_flag, created_at
       FROM memory_nodes
       WHERE user_id = $1::uuid
       ORDER BY last_touched DESC NULLS LAST`,
      [userId],
    );

    const edges = await crdb.query<MemoryEdgeRow>(
      `SELECT id, source, target, label, created_at
       FROM memory_edges
       WHERE user_id = $1::uuid
       ORDER BY created_at ASC`,
      [userId],
    );

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        v: 1,
        nodes: nodes.map(toNode),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          createdAt: e.created_at,
        })),
      }),
    };
  } catch (err) {
    logger.error("memory.list_failed", "listMemory error", { err: err instanceof Error ? err.message : String(err) });
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Failed to list memories" }),
    };
  }
}

export async function handleUpsertMemory(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  let body: {
    v?: number;
    action?: string;
    node?: Partial<MemoryNodeRow> & { id: string; title: string; kind?: string };
    edge?: { id: string; source: string; target: string; label: string };
  };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (body.v !== 1 || body.action !== "upsert") {
    return badRequest('Expected { v: 1, action: "upsert" }');
  }

  try {
    const userId = await getUserId(crdb, token);

    if (body.node) {
      const node = body.node;
      if (!node.id || !node.title) return badRequest("Node requires id + title");

      await crdb.execute(
        `INSERT INTO memory_nodes (id, user_id, kind, title, excerpt, tags, weight, confidence, verified, ref_count, last_touched, x, y, crisis_flag)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           kind        = EXCLUDED.kind,
           title       = EXCLUDED.title,
           excerpt     = EXCLUDED.excerpt,
           tags        = EXCLUDED.tags,
           weight      = EXCLUDED.weight,
           confidence  = EXCLUDED.confidence,
           verified    = EXCLUDED.verified,
           ref_count   = EXCLUDED.ref_count,
           last_touched = EXCLUDED.last_touched,
           x           = EXCLUDED.x,
           y           = EXCLUDED.y,
           crisis_flag = EXCLUDED.crisis_flag
         WHERE memory_nodes.user_id = $2::uuid`,
        [
          node.id,
          userId,
          node.kind ?? "core",
          node.title,
          node.excerpt ?? null,
          node.tags ?? [],
          node.weight ?? 0.5,
          node.confidence ?? 0.6,
          node.verified ?? false,
          node.ref_count ?? 0,
          node.last_touched ?? new Date().toISOString(),
          node.x ?? 0,
          node.y ?? 0,
          node.crisis_flag ?? false,
        ],
      );
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ v: 1, ok: true, id: node.id }) };
    }

    if (body.edge) {
      const edge = body.edge;
      if (!edge.id || !edge.source || !edge.target) {
        return badRequest("Edge requires id, source, target");
      }
      try {
        await crdb.execute(
          `INSERT INTO memory_edges (id, user_id, source, target, label)
           VALUES ($1, $2::uuid, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label
           WHERE memory_edges.user_id = $2::uuid`,
          [edge.id, userId, edge.source, edge.target, edge.label ?? "custom"],
        );
      } catch (err: any) {
        // UNIQUE(source,target) violation → treat as already-linked, not an error
        if (err?.code !== "23505") throw err;
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ v: 1, ok: true, id: edge.id }) };
    }

    return badRequest("Expected node or edge");
  } catch (err) {
    logger.error("memory.upsert_failed", "upsertMemory error", { err: err instanceof Error ? err.message : String(err) });
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Failed to save memory" }),
    };
  }
}

export async function handleDeleteMemory(
  id: string,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    const userId = await getUserId(crdb, token);
    await crdb.execute(
      `DELETE FROM memory_nodes WHERE id = $1 AND user_id = $2::uuid`,
      [id, userId],
    );
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ v: 1, ok: true, deletedId: id }) };
  } catch (err) {
    logger.error("memory.delete_failed", "deleteMemory error", { err: err instanceof Error ? err.message : String(err) });
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Failed to delete memory" }),
    };
  }
}

export async function handleDeleteMemoryEdge(
  id: string,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  try {
    const userId = await getUserId(crdb, token);
    await crdb.execute(
      `DELETE FROM memory_edges WHERE id = $1 AND user_id = $2::uuid`,
      [id, userId],
    );
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ v: 1, ok: true, deletedEdgeId: id }) };
  } catch (err) {
    logger.error("memory.delete_edge_failed", "deleteMemoryEdge error", { err: err instanceof Error ? err.message : String(err) });
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Failed to delete memory edge" }),
    };
  }
}

async function getUserId(crdb: CrdbClient, token: string): Promise<string> {
  const row = await crdb.queryOne<{ user_id: string }>(
    `SELECT md5($1::string)::uuid::text AS user_id`,
    [token],
  );
  const userId = row?.user_id ?? "";

  await crdb.execute(
    `INSERT INTO users (id, email, display_name, auth_method)
     VALUES (md5($1::string)::uuid, $1, 'device-user', 'passkey')
     ON CONFLICT (id) DO NOTHING`,
    [token],
  );
  return userId;
}

function toNode(row: MemoryNodeRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    excerpt: row.excerpt ?? undefined,
    tags: row.tags ?? [],
    weight: Number(row.weight ?? 0.5),
    confidence: Number(row.confidence ?? 0.6),
    verified: !!row.verified,
    references: Number(row.ref_count ?? 0),
    lastTouched: row.last_touched ?? row.created_at ?? new Date().toISOString(),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    crisisFlag: !!row.crisis_flag,
  };
}

function badRequest(error: string): APIGatewayProxyResult {
  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error }) };
}
