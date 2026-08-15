/**
 * Unit tests — hybrid semantic chat retrieval (Gap 1+2).
 *
 * `getMemoryContext`:
 * - memoryIds eksplisit → query by id (heuristik), TANPA embedding.
 * - tanpa memoryIds → embed userMessage + keyword (full-text) + cosine query,
 *   digabung via Reciprocal Rank Fusion (mode=hybrid, 3 set).
 * - embedding gagal → fallback heuristik murni (mode=heuristic, failed=true).
 */

import { describe, expect, it, vi } from "vitest";
import { getMemoryContext } from "../handlers/chatTurn";

function crdbMock(heuristicRows: any[] = [], vectorRows: any[] = [], keywordRows: any[] = []) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const crdb: any = {
    queries,
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes("@@ plainto_tsquery('english'")) return keywordRows;
      if (sql.includes("ORDER BY e.embedding <=> $1::vector")) return vectorRows;
      return heuristicRows;
    },
  };
  return crdb;
}

function llmMock(embedding: number[] | null) {
  const generateEmbedding = vi.fn(async () => {
    if (embedding === null) throw new Error("embedding failed");
    return embedding;
  });
  return { generateEmbedding } as any;
}

const H = [
  { id: "h1", title: "Heuristic strong", excerpt: "x", crisisFlag: false },
  { id: "h2", title: "Heuristic mid", excerpt: "x", crisisFlag: false },
];
const V = [
  { id: "v1", title: "Vector best", excerpt: "x", crisisFlag: false },
  { id: "h1", title: "Heuristic strong", excerpt: "x", crisisFlag: false },
];
const EMBED = new Array(1024).fill(0.31);

describe("getMemoryContext — hybrid retrieval", () => {
  it("uses explicit memoryIds without embedding (heuristic mode)", async () => {
    const crdb = crdbMock(H);
    const llm = llmMock(EMBED);
    const res = await getMemoryContext(crdb, llm, "u1", ["h1", "h2"], "hello");
    expect(llm.generateEmbedding).not.toHaveBeenCalled();
    expect(res.mode).toBe("heuristic");
    expect(res.rows.map((r) => r.id)).toEqual(["h1", "h2"]);
    expect(crdb.queries[0].sql).toContain("id = ANY");
  });

  it("embeds userMessage and fuses heuristic + keyword + vector via RRF (hybrid mode)", async () => {
    const crdb = crdbMock(H, V, [H[1]]);
    const llm = llmMock(EMBED);
    const res = await getMemoryContext(crdb, llm, "u1", [], "anxious about noise");
    expect(llm.generateEmbedding).toHaveBeenCalledWith("anxious about noise");
    expect(res.mode).toBe("hybrid");
    expect(crdb.queries).toHaveLength(3);
    // heuristic (0) → keyword full-text (1) → vector (2)
    const keywordSql = crdb.queries[1].sql;
    expect(keywordSql).toContain("to_tsvector('english', mn.title || ' ' || COALESCE(mn.excerpt, '')) @@ plainto_tsquery('english', $2)");
    expect(keywordSql).toContain("mn.user_id = $1::uuid");
    expect(keywordSql).toContain("ts_rank(to_tsvector('english', mn.title || ' ' || COALESCE(mn.excerpt, '')), plainto_tsquery('english', $2)) DESC");
    expect(crdb.queries[1].params?.[0]).toBe("u1");
    const vectorSql = crdb.queries[2].sql;
    expect(vectorSql).toContain("mn.verified = true");
    expect(vectorSql).toContain("e.user_id = $2::uuid");
    expect(vectorSql).toContain("ORDER BY e.embedding <=> $1::vector");
    expect(vectorSql).not.toContain("IS NOT NULL");
    expect(crdb.queries[2].params?.[0]).toBeTruthy();
    // RRF boost: h1 hadir di heuristik (rank1) + vector (rank2) → naik di atas
    // h2 (heuristik + keyword), dan v1 (vector-only) ikut masuk.
    expect(res.rows[0].id).toBe("h1");
    expect(res.rows.map((r) => r.id)).toContain("v1");
    expect(res.rows.map((r) => r.id)).toContain("h2");
  });

  it("falls back to heuristic when embedding fails (mode=heuristic, failed=true)", async () => {
    const crdb = crdbMock(H);
    const llm = llmMock(null);
    const res = await getMemoryContext(crdb, llm, "u1", [], "hello");
    expect(res.mode).toBe("heuristic");
    expect(res.failed).toBe(true);
    expect(res.rows.map((r) => r.id)).toEqual(["h1", "h2"]);
    expect(crdb.queries).toHaveLength(1);
  });

  it("returns empty rows when nothing matches", async () => {
    const crdb = crdbMock([], []);
    const llm = llmMock(EMBED);
    const res = await getMemoryContext(crdb, llm, "u1", [], "nothing");
    expect(res.rows).toEqual([]);
  });
});
