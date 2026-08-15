/**
 * Semantic Search Handler — GET /api/v1/memory/semantic
 *
 * Menggunakan Distributed Vector Indexing (pgvector) untuk cosine similarity.
 * 1. Embedding query via OpenRouter (arctic-embed, 1024-dim)
 * 2. Derived-table subquery (prefix user_id) → JOIN memory_nodes, filter verified
 * 3. Return { v:1, results:[{node, score, matchReason}] }
 */

import { CrdbClient } from "../lib/crdb";
import { OpenRouterClient } from "../lib/openrouter";
import { toVectorLiteral } from "../lib/vectors";
import { logger } from "../lib/logger";
import { withSpan } from "../lib/telemetry";
import { Context } from "@opentelemetry/api";

interface SearchRow {
  id: string;
  title: string;
  excerpt: string | null;
  score: number;
}

export async function handleSemanticSearch(
  qs: Record<string, string | undefined>,
  crdb: CrdbClient,
  llm: OpenRouterClient,
  token: string,
  deviceId: string,
  rootCtx?: Context,
) {
  const q = qs.q?.trim() ?? "";
  const limit = Math.min(Number(qs.limit ?? 5) || 5, 20);
  const minConfidence = Number(qs.minConfidence ?? 0.6) || 0.6;

  if (!q) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Missing required query parameter: q" }),
    };
  }

  try {
    const userId = await getUserId(crdb, token);
    const embedStartedAt = Date.now();
    const embedding = await llm.generateEmbedding(q);
    const embeddingMs = Date.now() - embedStartedAt;

    const rows = await crdb.query<SearchRow>(
      `SELECT mn.id, mn.title, COALESCE(mn.excerpt, '') AS excerpt,
              1 - sub.distance AS score
       FROM memory_nodes mn
       JOIN (SELECT e.node_id, e.embedding <=> $1::vector AS distance
             FROM embeddings e
             WHERE e.user_id = $2::uuid
             ORDER BY e.embedding <=> $1::vector
             LIMIT $3) sub ON sub.node_id = mn.id
       WHERE mn.user_id = $2::uuid
         AND mn.verified = true
         AND mn.confidence >= $4
       ORDER BY sub.distance
       LIMIT $5`,
      [toVectorLiteral(embedding), userId, candidateLimit(limit), minConfidence, limit],
    );

    if (rootCtx) {
      withSpan(
        "memory.semantic_search",
        rootCtx,
        async (span) => {
          span.setAttribute("memory.matched", rows.length);
          span.setAttribute("memory.embedding_ms", embeddingMs);
        },
        { attributes: { "memory.matched": rows.length } },
      );
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        v: 1,
        results: rows.map((r) => ({
          node: { id: r.id, title: r.title, excerpt: r.excerpt },
          score: Math.round(r.score * 10000) / 10000,
          matchReason: "vector",
        })),
      }),
    };
  } catch (err) {
    logger.error("semantic.search_failed", "semanticSearch error", {
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Semantic search failed" }),
    };
  }
}

async function getUserId(crdb: CrdbClient, token: string): Promise<string> {
  const row = await crdb.queryOne<{ user_id: string }>(
    `SELECT md5($1::string)::uuid::text AS user_id`,
    [token],
  );
  return row?.user_id ?? "";
}

function candidateLimit(limit: number): number {
  return Math.min(Math.max(limit * 4, 16), 80);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
}
