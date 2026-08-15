/**
 * Unit tests — semantic search (Gap 5: filter verified + prefix equality).
 *
 * Tidak menyentuh CockroachDB. Memakai mock CrdbClient untuk memverifikasi SQL
 * yang dikirim semanticSearch: hasil hanya node verified + prefix e.user_id
 * (index pruning) dan masih memakai cosine `<=>`.
 */

import { describe, expect, it, vi } from "vitest";
import { handleSemanticSearch } from "../handlers/semanticSearch";
import { toVectorLiteral } from "../lib/vectors";

function crdbMock(rows: unknown[] = []) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const crdb: any = {
    queries,
    async queryOne() {
      return { user_id: "00000000-0000-0000-0000-000000000001" };
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      return rows;
    },
    async execute() {},
  };
  return crdb;
}

function llmMock(embedding: number[]) {
  const generateEmbedding = vi.fn(async () => embedding);
  return { generateEmbedding } as any;
}

const EMBED = new Array(1024).fill(0.42);

describe("semantic search — verified filter + prefix", () => {
  it("filters verified=true and constrains e.user_id (prefix) on the cosine query", async () => {
    const crdb = crdbMock();
    const llm = llmMock(EMBED);
    const res = await handleSemanticSearch({ q: "anxious about noise" }, crdb, llm, "tok-1", "dev-1");

    expect(res.statusCode).toBe(200);
    expect(llm.generateEmbedding).toHaveBeenCalledWith("anxious about noise");
    expect(crdb.queries).toHaveLength(1);
    const sql = crdb.queries[0].sql;
    expect(sql).toContain("mn.verified = true");
    expect(sql).toContain("e.user_id = $2::uuid");
    expect(sql).toContain("mn.user_id = $2::uuid");
    expect(sql).toContain("<=>");
    expect(crdb.queries[0].params?.[0]).toBe(toVectorLiteral(EMBED));
  });

  it("returns matched nodes with score and matchReason vector", async () => {
    const crdb = crdbMock([{ id: "n1", title: "Panic", excerpt: "noise", score: 0.7779 }]);
    const res = await handleSemanticSearch({ q: "noise" }, crdb, llmMock(EMBED), "tok-1", "dev-1");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].node.id).toBe("n1");
    expect(body.results[0].score).toBe(0.7779);
    expect(body.results[0].matchReason).toBe("vector");
  });

  it("caps limit to 20 and honors minConfidence param", async () => {
    const crdb = crdbMock();
    await handleSemanticSearch({ q: "x", limit: "500", minConfidence: "0.8" }, crdb, llmMock(EMBED), "t", "d");
    expect(crdb.queries[0].params?.[3]).toBe(20);
    expect(crdb.queries[0].params?.[2]).toBe(0.8);
  });

  it("returns 400 when q is missing", async () => {
    const crdb = crdbMock();
    const res = await handleSemanticSearch({}, crdb, llmMock(EMBED), "t", "d");
    expect(res.statusCode).toBe(400);
    expect(crdb.queries).toHaveLength(0);
  });
});
