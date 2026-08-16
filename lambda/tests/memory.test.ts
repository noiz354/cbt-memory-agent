/**
 * Unit tests — vector embedding writer (Opsi A: "writer + semantic aktif").
 *
 * Tidak menyentuh CockroachDB. Memakai mock CrdbClient + mock OpenRouterClient
 * untuk membuktikan: upsert node → tulis embeddings (best-effort), edge → tanpa
 * embedding, kegagalan embedding → upsert tetap sukses.
 */

import { describe, expect, it, vi } from "vitest";
import { handleUpsertMemory } from "../handlers/memory";
import { embeddingText, toVectorLiteral } from "../lib/vectors";

type ExecuteCall = { sql: string; params?: unknown[] };

/** Mock CrdbClient — merekam semua execute + query (user id deterministik). */
function crdbMock() {
  const executes: ExecuteCall[] = [];
  const crdb: any = {
    executes,
    async query() {
      return [];
    },
    async queryOne() {
      return { user_id: "00000000-0000-0000-0000-000000000001" };
    },
    async execute(sql: string, params?: unknown[]) {
      executes.push({ sql, params });
    },
    async executeCount() {
      return 0;
    },
  };
  return crdb;
}

/** Mock OpenRouterClient — generateEmbedding dapat di-spy / dibuat gagal. */
function llmMock(embedding: number[] | null) {
  const generateEmbedding = vi.fn(async () => {
    if (embedding === null) throw new Error("embedding failed");
    return embedding;
  });
  return { generateEmbedding } as any;
}

const NODE_BODY = (node: object) =>
  ({
    body: JSON.stringify({ v: 1, action: "upsert", node }),
  }) as any;

describe("vector writer — handleUpsertMemory", () => {
  it("upsert node writes an embedding (DELETE stale + INSERT)", async () => {
    const crdb = crdbMock();
    const llm = llmMock(new Array(1024).fill(0.5));
    const res = await handleUpsertMemory(NODE_BODY({ id: "n1", title: "Panic attack trigger", excerpt: "loud noise at noon" }), crdb, llm, "tok-1", "dev-1");

    expect(res.statusCode).toBe(200);
    expect(llm.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(llm.generateEmbedding).toHaveBeenCalledWith("Panic attack trigger — loud noise at noon");

    const deletes = crdb.executes.filter((c: ExecuteCall) => c.sql.includes("DELETE FROM embeddings"));
    const inserts = crdb.executes.filter((c: ExecuteCall) => c.sql.includes("INSERT INTO embeddings"));
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("embedding");
    expect(inserts[0].params?.[2]).toBe(toVectorLiteral(new Array(1024).fill(0.5)));
    expect(inserts[0].params?.[0]).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("upsert node without excerpt still embeds the title only", async () => {
    const crdb = crdbMock();
    const llm = llmMock(new Array(1024).fill(0.1));
    await handleUpsertMemory(NODE_BODY({ id: "n2", title: "Solo memory" }), crdb, llm, "tok-1", "dev-1");
    expect(llm.generateEmbedding).toHaveBeenCalledWith("Solo memory");
  });

  it("embedding failure does NOT fail the upsert (best-effort)", async () => {
    const crdb = crdbMock();
    const llm = llmMock(null);
    const res = await handleUpsertMemory(NODE_BODY({ id: "n3", title: "X" }), crdb, llm, "tok-1", "dev-1");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    // Node masih tersimpan, tapi tidak ada INSERT embeddings.
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO memory_nodes"))).toBe(true);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO embeddings"))).toBe(false);
  });

  it("upsert edge does NOT generate embeddings", async () => {
    const crdb = crdbMock();
    const llm = llmMock(new Array(1024).fill(0.5));
    const res = await handleUpsertMemory(
      { body: JSON.stringify({ v: 1, action: "upsert", edge: { id: "e1", source: "a", target: "b", label: "related" } }) } as any,
      crdb,
      llm,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(200);
    expect(llm.generateEmbedding).not.toHaveBeenCalled();
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO memory_edges"))).toBe(true);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("embeddings"))).toBe(false);
  });

  it("rejects malformed body (400)", async () => {
    const crdb = crdbMock();
    const llm = llmMock(new Array(1024).fill(0.5));
    const res = await handleUpsertMemory({ body: "{not json" } as any, crdb, llm, "tok-1", "dev-1");
    expect(res.statusCode).toBe(400);
    expect(llm.generateEmbedding).not.toHaveBeenCalled();
  });

  it("upsert node with tags embeds title — tags — excerpt (Gap 6)", async () => {
    const crdb = crdbMock();
    const llm = llmMock(new Array(1024).fill(0.5));
    await handleUpsertMemory(
      NODE_BODY({ id: "n4", title: "Panic", tags: ["anxiety", "noise"], excerpt: "loud noise" }),
      crdb,
      llm,
      "tok-1",
      "dev-1",
    );
    expect(llm.generateEmbedding).toHaveBeenCalledWith("Panic — anxiety,noise — loud noise");
  });

  it("upsert node with long excerpt writes one embedding per chunk (chunk-N)", async () => {
    const crdb = crdbMock();
    const llm = llmMock(new Array(1024).fill(0.5));
    const longExcerpt = "y".repeat(6200);
    await handleUpsertMemory(
      NODE_BODY({ id: "n5", title: "Long memory", excerpt: longExcerpt }),
      crdb,
      llm,
      "tok-1",
      "dev-1",
    );
    const inserts = crdb.executes.filter((c: ExecuteCall) => c.sql.includes("INSERT INTO embeddings"));
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    expect(inserts[0].params?.[3]).toBe("chunk-0");
    expect(inserts[1].params?.[3]).toBe("chunk-1");
    const deletes = crdb.executes.filter((c: ExecuteCall) => c.sql.includes("DELETE FROM embeddings"));
    expect(deletes).toHaveLength(1);
  });
});

describe("vectors lib", () => {
  it("toVectorLiteral serializes to 6-decimal vector literal", () => {
    expect(toVectorLiteral([1, 2, 3])).toBe("[1.000000,2.000000,3.000000]");
    expect(toVectorLiteral([])).toBe("[]");
  });

  it("embeddingText joins title + excerpt", () => {
    expect(embeddingText({ title: "T", excerpt: "E" })).toBe("T — E");
    expect(embeddingText({ title: "T" })).toBe("T");
    expect(embeddingText({ title: "T", excerpt: "   " })).toBe("T");
  });
});
