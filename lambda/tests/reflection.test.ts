/**
 * Unit tests — agentic memory loop (reflection lib).
 *
 * `parseReflectionJson`: parse output LLM yang strict dan lenient.
 * `extractReflectionFacts`: kirim turn → LLM → facts (via mock).
 * `reflectUser`: ambil turns → ekstrak → upsert node + embedding + audit.
 * `runReflectionForActiveUsers`: loop per-user, error satu user tidak mematikan
 *   user lain.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  parseReflectionJson,
  extractReflectionFacts,
  reflectUser,
  runReflectionForActiveUsers,
  REFLECT_AUDIT_TYPE,
} from "../lib/reflection";
import { EMPTY_MCP_CONTEXT } from "../lib/mcp";

// Hermetic: health gate + skills loader tidak pernah menyentuh network/fs
// di dalam tes (dev box punya ccloud live + CCLOUD_API_KEY di .env).
vi.mock("../lib/clusterHealth", () => ({
  checkClusterHealth: vi.fn(async () => ({ healthy: true, skipped: true, status: "CREATED", nodeCount: 0 })),
}));
vi.mock("../lib/agentSkills", () => ({
  loadReflectionSkills: vi.fn(async () => ({ content: "", names: [] })),
}));

beforeEach(() => {
  // Hermetic: pastikan MCP default provider tidak pernah menyentuh network.
  delete process.env.CCLOUD_MCP_API_KEY;
  delete process.env.CCLOUD_API_KEY;
});

describe("parseReflectionJson", () => {
  it("parses a strict JSON array", () => {
    const facts = parseReflectionJson(
      JSON.stringify([
        { title: "Prefers morning sessions", excerpt: "User works best early", confidence: 0.9, tags: ["routine"] },
      ]),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].title).toBe("Prefers morning sessions");
    expect(facts[0].confidence).toBe(0.9);
    expect(facts[0].tags).toEqual(["routine"]);
  });

  it("strips prose and extracts the JSON array from LLM output", () => {
    const facts = parseReflectionJson(
      'Here are the durable facts:\n[{"title":"Sleep anxiety","excerpt":"struggles to fall asleep","confidence":0.85}]\nThat should help.',
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].title).toBe("Sleep anxiety");
  });

  it("parses a bare object as single-element array", () => {
    const facts = parseReflectionJson('{"title":"Mood swings","excerpt":"often","confidence":0.7}');
    expect(facts).toHaveLength(1);
    expect(facts[0].title).toBe("Mood swings");
  });

  it("drops empty/blank facts and clamps confidence", () => {
    const facts = parseReflectionJson(
      JSON.stringify([
        { title: "", excerpt: "blank title", confidence: 2 },
        { title: "good", excerpt: "valid", confidence: -1 },
      ]),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].title).toBe("good");
    expect(facts[0].confidence).toBe(0); // -1 clamped ke 0
  });

  it("defaults blank/NaN confidence to 0.8", () => {
    const facts = parseReflectionJson(
      JSON.stringify([{ title: "T", excerpt: "E", confidence: "not-a-number" }]),
    );
    expect(facts[0].confidence).toBe(0.8);
  });

  it("returns [] for unparseable output", () => {
    expect(parseReflectionJson("no json here")).toEqual([]);
    expect(parseReflectionJson("[]")).toEqual([]);
  });
});

describe("extractReflectionFacts", () => {
  it("calls LLM chat and returns parsed facts", async () => {
    const llm = {
      chat: vi.fn(async () => ({
        content: JSON.stringify([{ title: "T", excerpt: "E", confidence: 0.9 }]),
        tokensUsed: 10,
      })),
    } as any;

    const facts = await extractReflectionFacts(llm, [
      { role: "user", content: "I can't sleep at night" },
      { role: "assistant", content: "Let's explore that." },
    ]);

    expect(facts).toHaveLength(1);
    expect(facts[0].title).toBe("T");
    // Prompt harus meminta tanpa PII
    const messages = (llm.chat as any).mock.calls[0][0] as { role: string; content: string }[];
    const prompt = messages.map((m) => m.content).join(" ");
    expect(prompt).toContain("NEVER extract");
    expect(prompt).toContain("STRICT JSON");
  });

  it("returns [] when LLM fails", async () => {
    const llm = {
      chat: vi.fn(async () => {
        throw new Error("llm down");
      }),
    } as any;
    const facts = await extractReflectionFacts(llm, [{ role: "user", content: "x" }]);
    expect(facts).toEqual([]);
  });

  it("appends already-known facts to the user prompt (no dup instructions)", async () => {
    const llm = {
      chat: vi.fn(async () => ({
        content: JSON.stringify([{ title: "New fact", excerpt: "E", confidence: 0.9 }]),
        tokensUsed: 10,
      })),
    } as any;

    await extractReflectionFacts(
      llm,
      [{ role: "user", content: "I can't sleep" }],
      [{ title: "Sleep anxiety", excerpt: "struggles to fall asleep" }],
    );

    const messages = (llm.chat as any).mock.calls[0][0] as { role: string; content: string }[];
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("Sleep anxiety");
    expect(userMsg).toContain("DO NOT re-extract");
  });

  it("appends skills context to the user prompt when provided", async () => {
    const llm = {
      chat: vi.fn(async () => ({
        content: JSON.stringify([{ title: "New fact", excerpt: "E", confidence: 0.9 }]),
        tokensUsed: 10,
      })),
    } as any;

    await extractReflectionFacts(
      llm,
      [{ role: "user", content: "I can't sleep" }],
      [],
      "--- CockroachDB Agent Skills Context ---\ncockroachdb-sql: use UPSERT",
    );

    const messages = (llm.chat as any).mock.calls[0][0] as { role: string; content: string }[];
    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    expect(userMsg).toContain("CockroachDB Agent Skills Context");
    expect(userMsg).toContain("use UPSERT");
  });
});

describe("reflectUser", () => {
  function crdbMock(facts: any[]) {
    const queries: { sql: string; params?: unknown[] }[] = [];
    const crdb: any = {
      queries,
      async query(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        if (sql.includes("FROM chat_turns")) {
          return [
            { role: "user", content: "I feel anxious at night" },
            { role: "assistant", content: "Tell me more" },
          ];
        }
        if (sql.includes("::uuid::text")) return [{ node_id: "11111111-2222-3333-4444-555555555555" }];
        return facts;
      },
      async queryOne(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        if (sql.includes("::uuid::text")) return { node_id: "11111111-2222-3333-4444-555555555555" };
        return null;
      },
      async execute(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        return;
      },
      async executeCount(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        return 1;
      },
    };
    return crdb;
  }

  function llmMock() {
    return {
      generateEmbedding: vi.fn(async () => new Array(1024).fill(0.5)),
      chat: vi.fn(async () => ({
        content: JSON.stringify([
          { title: "Sleep anxiety", excerpt: "struggles to fall asleep", confidence: 0.9, tags: ["sleep"] },
        ]),
        tokensUsed: 5,
      })),
    } as any;
  }

  it("extracts facts, upserts core node with verified=true + embedding + audit", async () => {
    const crdb = crdbMock([]);
    const llm = llmMock();
    const res = await reflectUser(crdb, llm, "u1", { maxTurns: 20 });

    expect(res.factsUpserted).toBe(1);

    const insert = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO memory_nodes"));
    const insertSql = insert?.sql ?? "";
    expect(insertSql).toContain("ON CONFLICT (id) DO UPDATE");
    expect(insertSql).toContain("verified    = true");
    // kind (param $3) = 'core'
    expect(insert?.params?.[2]).toBe("core");

    // embedding ditulis via vectorWriter
    expect(llm.generateEmbedding).toHaveBeenCalled();

    // audit REFLECTION_RAN (type via param $1)
    const audit = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"));
    expect(audit?.params?.[0]).toBe(REFLECT_AUDIT_TYPE);
  });

  it("returns 0 when no turns exist", async () => {
    const crdb: any = {
      async query(sql: string) {
        if (sql.includes("FROM chat_turns")) return [];
        return [];
      },
      async execute() {},
    };
    const llm = llmMock();
    const res = await reflectUser(crdb, llm, "u1");
    expect(res.factsUpserted).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("writes normalized mcp fields in audit detail (false/0 when MCP unused)", async () => {
    const crdb = crdbMock([]);
    const llm = llmMock();
    await reflectUser(crdb, llm, "u1", {
      maxTurns: 20,
      existingFactsProvider: async () => EMPTY_MCP_CONTEXT,
    });

    const audit = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"));
    const detail = JSON.parse(audit?.params?.[2] as string);
    expect(detail.mcp_context_used).toBe(false);
    expect(detail.mcp_facts_count).toBe(0);
  });

  it("writes normalized mcp fields in audit detail (true/n when MCP used)", async () => {
    const crdb = crdbMock([]);
    const llm = llmMock();
    await reflectUser(crdb, llm, "u1", {
      maxTurns: 20,
      existingFactsProvider: async () => ({
        used: true,
        factsCount: 2,
        facts: [{ title: "Sleep anxiety", excerpt: "struggles to fall asleep" }],
      }),
    });

    const audit = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"));
    const detail = JSON.parse(audit?.params?.[2] as string);
    expect(detail.mcp_context_used).toBe(true);
    expect(detail.mcp_facts_count).toBe(2);
  });

  it("writes normalized skills fields in audit detail (skills injected)", async () => {
    const { loadReflectionSkills } = await import("../lib/agentSkills");
    (loadReflectionSkills as any).mockResolvedValue({
      content: "--- CockroachDB Agent Skills Context ---\ncockroachdb-sql: use UPSERT",
      names: ["cockroachdb-sql"],
    });

    const crdb = crdbMock([]);
    const llm = llmMock();
    await reflectUser(crdb, llm, "u1", { maxTurns: 20 });

    const audit = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"));
    const detail = JSON.parse(audit?.params?.[2] as string);
    expect(detail.skills_used).toEqual(["cockroachdb-sql"]);
    expect(detail.skills_injected).toBe(true);
  });

  it("writes normalized skills fields in audit detail (no skills)", async () => {
    const { loadReflectionSkills } = await import("../lib/agentSkills");
    (loadReflectionSkills as any).mockResolvedValue({ content: "", names: [] });

    const crdb = crdbMock([]);
    const llm = llmMock();
    await reflectUser(crdb, llm, "u1", { maxTurns: 20 });

    const audit = crdb.queries.find((q: { sql: string; params?: unknown[] }) => q.sql.includes("INSERT INTO audit_events"));
    const detail = JSON.parse(audit?.params?.[2] as string);
    expect(detail.skills_used).toEqual([]);
    expect(detail.skills_injected).toBe(false);
  });
});

describe("runReflectionForActiveUsers", () => {
  it("loops users and tolerates per-user errors", async () => {
    const crdb: any = {
      async query(sql: string) {
        if (sql.includes("DISTINCT ct.user_id")) {
          return [{ user_id: "u1" }, { user_id: "u2" }];
        }
        if (sql.includes("FROM chat_turns")) return [{ role: "user", content: "x" }];
        if (sql.includes("::uuid::text")) return [{ node_id: "11111111-2222-3333-4444-555555555555" }];
        return [];
      },
      async queryOne() {
        return { node_id: "11111111-2222-3333-4444-555555555555" };
      },
      async execute() {},
      async executeCount() {
        return 1;
      },
    };
    const llm: any = {
      generateEmbedding: vi.fn(async () => new Array(1024).fill(0.5)),
      chat: vi.fn(async () => ({ content: "[]", tokensUsed: 0 })), // no facts → skipped
    };

    const res = await runReflectionForActiveUsers(crdb, llm, { limitUsers: 10 });
    expect(res.errors).toBe(0);
    expect(res.skipped).toBeGreaterThanOrEqual(0);
  });

  it("counts errors when a user reflection throws", async () => {
    const crdb: any = {
      async query(sql: string) {
        if (sql.includes("DISTINCT ct.user_id")) return [{ user_id: "u1" }];
        if (sql.includes("FROM chat_turns")) throw new Error("db down"); // error di level query turns
        return [];
      },
      async queryOne() {
        return { node_id: "11111111-2222-3333-4444-555555555555" };
      },
      async execute() {},
    };
    const llm: any = {
      generateEmbedding: vi.fn(async () => new Array(1024).fill(0.5)),
      chat: vi.fn(async () => ({
        content: JSON.stringify([{ title: "T", excerpt: "E", confidence: 0.9 }]),
        tokensUsed: 1,
      })),
    };

    const res = await runReflectionForActiveUsers(crdb, llm, { limitUsers: 10 });
    expect(res.errors).toBe(1);
  });

  it("skips the whole run when the cluster is unhealthy (healthy:false)", async () => {
    const { checkClusterHealth } = await import("../lib/clusterHealth");
    (checkClusterHealth as any).mockResolvedValue({ healthy: false, skipped: false, status: "DEGRADED", nodeCount: 0 });

    const crdb: any = {
      query: vi.fn(async () => [{ user_id: "u1" }]),
      async execute() {},
    };
    const llm: any = { chat: vi.fn() };

    const res = await runReflectionForActiveUsers(crdb, llm, { limitUsers: 10 });

    expect(res.userFacts).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.errors).toBe(0);
    // Tidak ada query user aktif → tidak memproses user mana pun.
    expect(crdb.query).not.toHaveBeenCalled();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("continues when the health check itself failed (skipped:true)", async () => {
    const { checkClusterHealth } = await import("../lib/clusterHealth");
    (checkClusterHealth as any).mockResolvedValue({ healthy: true, skipped: true, status: "UNKNOWN", nodeCount: null });

    const crdb: any = {
      async query(sql: string) {
        if (sql.includes("DISTINCT ct.user_id")) return [{ user_id: "u1" }];
        if (sql.includes("FROM chat_turns")) return [{ role: "user", content: "x" }];
        if (sql.includes("::uuid::text")) return [{ node_id: "11111111-2222-3333-4444-555555555555" }];
        return [];
      },
      async queryOne() {
        return { node_id: "11111111-2222-3333-4444-555555555555" };
      },
      async execute() {},
      async executeCount() {
        return 1;
      },
    };
    const llm: any = {
      generateEmbedding: vi.fn(async () => new Array(1024).fill(0.5)),
      chat: vi.fn(async () => ({ content: "[]", tokensUsed: 0 })),
    };

    const res = await runReflectionForActiveUsers(crdb, llm, { limitUsers: 10 });
    expect(res.errors).toBe(0);
  });
});
