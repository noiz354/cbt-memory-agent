/**
 * Semantic Search Handler — GET /api/v1/memory/semantic
 *
 * Menggunakan Distributed Vector Indexing (pgvector) untuk cosine similarity.
 * 1. Embedding query via OpenRouter (arctic-embed, 1024-dim)
 * 2. SELECT memory_nodes JOIN embeddings ORDER BY embedding <=> $1::vector
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
              1 - (e.embedding <=> $1::vector) AS score
       FROM embeddings e
       JOIN memory_nodes mn ON mn.id = e.node_id
       WHERE mn.user_id = $2::uuid
         AND e.user_id = $2::uuid
         AND mn.verified = true
         AND mn.confidence >= $3
         AND e.embedding IS NOT NULL
       ORDER BY e.embedding <=> $1::vector
       LIMIT $4`,
      [toVectorLiteral(embedding), userId, minConfidence, limit],
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

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Device-Id",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
}
