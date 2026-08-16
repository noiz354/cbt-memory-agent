# Plan — MCP Read-Only Step (1.5) in Reflection Loop + Audit Gap Fixes

> Disusun: 2026-08-16 · Status: Approved → Implementation
> Scope: **additive only**. Tidak ada perubahan pada steps 1–5 reflection loop yang sudah jalan.
> Kerangka kerja: ADDY-OSMANI-SKILLS.md (Define → Plan → Build → Verify → Review → Ship).

## Ringkasan

Menambahkan "step 1.5" di reflection loop: sebelum LLM distillation (`extractReflectionFacts`),
ambil core facts user yang sudah verified dari `memory_nodes` via CockroachDB Cloud Managed MCP
(read-only `select_query`) dan kirim sebagai konteks tambahan agar LLM tidak menduplikasi fakta
yang sudah dikenal. Semua write tetap lewat `pg.Pool` (tidak ada write via MCP).

Audit 6-dimensi menemukan 5 gap; plan ini sekaligus memperbaikinya:

| Gap | Severity | Perbaikan |
|---|---|---|
| 1. Tidak ada fetch timeout di MCP call | HIGH | `AbortSignal.timeout(MCP_FETCH_TIMEOUT_MS)` default 5000ms, env `MCP_FETCH_TIMEOUT_MS` |
| 2. Hang isolation per-user | MEDIUM | Tertutup penuh oleh Gap 1 — timeout mengubah hang → rejection yang ditangkap di dalam `fetchExistingCoreFacts`; **tidak perlu `Promise.race`** |
| 3. Bentuk audit detail ambigu (3 shape) | LOW | Normalisasi: selalu sertakan `mcp_context_used` + `mcp_facts_count` (true/n, true/0, false/0) |
| 4. `durationMs` hilang di log kegagalan | LOW | `const startMs = Date.now()` + `durationMs` di `reflection.mcp_failed` |
| 5. Durasi MCP tak terlihat di observability | LOW | Satu structured log `reflection.mcp_query` di `finally` (sukses & gagal) — tanpa OTel span |

## Fakta verifikasi runtime

- Lambda runtime `nodejs22.x` (infra/modules/lambda/main.tf:33) → `AbortSignal.timeout()` tersedia (Node 17.3+), ter-typed oleh `@types/node@22`.
- `tsconfig.json`: `strict: true`, `lib: ["ES2022"]`. `fetch`/`Response`/`AbortSignal` sudah dipakai openrouter.ts via `@types/node` → tanpa blocker.
- Produksi: `CCLOUD_API_KEY` sudah diset di Lambda (main.tf:48) → fallback key membuat step MCP **live** dengan timeout 5s pada cron 6-jam berikutnya.
- Test (CI) bebas network karena kedua key tidak diset → `fetchExistingCoreFacts` return `EMPTY_MCP_CONTEXT` tanpa network.

## File yang berubah

- **`lambda/lib/mcp.ts`** — BARU (Gap 1, 4, 5 baked-in + tipe `McpContext` ternormalisasi untuk Gap 3).
- **`lambda/lib/reflection.ts`** — wiring minimal (import, param `existingFacts`, provider threading) + perubahan konstruksi audit `detail` (Gap 3) saja.
- **`lambda/tests/mcp.test.ts`** — BARU (TDD).
- **`lambda/tests/reflection.test.ts`** — tambahan asersi (prompt + audit detail).

## Gap 2 — Jawaban definitif

**Gap 1 fully covers Gap 2; tidak perlu `Promise.race` di loop level.**

Timeout berada di *dalam* `fetchExistingCoreFacts` (mcp.ts). Endpoint MCP hang → `fetch` reject
`AbortError` setelah 5s → rejection ditangkap oleh `catch` mcp.ts sendiri (return `EMPTY_MCP_CONTEXT`).
Hang tidak pernah naik sebagai promise tak terselesaikan ke `reflectUser`/loop, sehingga
per-user `try/catch` di `runReflectionForActiveUsers` (reflection.ts:66-77) tidak pernah tersentuh
untuk kasus hang MCP. `Promise.race` di loop hanya melindungi hang di step lain (DB query, LLM,
embeddings) yang merupakan gap pra-eksisting di luar scope.

Catatan: timeout harus menutupi `fetch` **dan** pembacaan body (endpoint MCP streaming SSE).
`signal` yang dioper ke `fetch` berlaku untuk konsumsi body (termasuk `resp.text()` di `parseSseResult`).

## Diff 1 — `lambda/lib/mcp.ts` (baru)

```ts
import { logger } from "./logger";

export interface McpExistingFact { title: string; excerpt: string }
export interface McpContext { used: boolean; factsCount: number; facts: McpExistingFact[] }

export const EMPTY_MCP_CONTEXT: McpContext = { used: false, factsCount: 0, facts: [] };

export const MCP_ENDPOINT = "https://cockroachlabs.cloud/mcp";
export const MCP_CLUSTER_ID = process.env.MCP_CLUSTER_ID ?? "87275047-fbf8-4f18-8b8d-a5ff97a335e3";
export const MCP_MAX_FACTS = 25;
// Gap 1: env-configurable timeout, default 5000ms
export const MCP_FETCH_TIMEOUT_MS = Number(process.env.MCP_FETCH_TIMEOUT_MS ?? 5000) || 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mcpApiKey(): string {
  return process.env.CCLOUD_MCP_API_KEY ?? process.env.CCLOUD_API_KEY ?? "";
}

export async function fetchExistingCoreFacts(userId: string): Promise<McpContext> {
  const startMs = Date.now();                      // Gap 4
  let success = false;
  let factsCount = 0;

  try {
    const key = mcpApiKey();
    if (!key) {
      logger.warn("reflection.mcp_failed", "MCP key not set — continuing without context", { userId, err: "missing_mcp_key" });
      return EMPTY_MCP_CONTEXT;
    }
    if (!UUID_RE.test(userId)) {                    // mencegah SQL injection ke query interpolasi
      logger.warn("reflection.mcp_failed", "Invalid user id — continuing without context", { userId, err: "invalid_user_id" });
      return EMPTY_MCP_CONTEXT;
    }

    const query =
      "SELECT title, excerpt FROM memory_nodes " +
      "WHERE user_id = '" + userId + "' AND kind = 'core' AND verified = true " +
      "ORDER BY last_touched DESC LIMIT " + MCP_MAX_FACTS;

    const rows = await callSelectQuery(key, query);
    const facts = rows
      .map((r) => ({ title: String(r.title ?? "").slice(0, 60), excerpt: String(r.excerpt ?? "").slice(0, 200) }))
      .filter((f) => f.title.trim().length > 0)
      .slice(0, MCP_MAX_FACTS);

    success = true;
    factsCount = facts.length;
    return { used: true, factsCount, facts };
  } catch (err) {
    // Gap 4: durationMs di log kegagalan; catch menelan timeout/network/parse → graceful degradation
    logger.warn("reflection.mcp_failed", "MCP select_query failed — continuing without context", {
      userId,
      err: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    });
    return EMPTY_MCP_CONTEXT;
  } finally {
    // Gap 5: satu structured log line menutup path SUKSES dan GAGAL.
    // (`event` = argumen posisional pertama logger — logger.ts:71; field di bawah.)
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
  const resp = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-cluster-id": MCP_CLUSTER_ID,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "select_query", arguments: { database: "defaultdb", query } } }),
    signal: AbortSignal.timeout(MCP_FETCH_TIMEOUT_MS),   // Gap 1
  });

  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status} ${resp.statusText}`);
  return parseSseResult(resp);
}

async function parseSseResult(resp: Response): Promise<McpExistingFact[]> {
  const text = await resp.text();
  const dataLines = text.split("\n").map((l) => l.trim())
    .filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());

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
```

## Diff 2 — `lambda/lib/reflection.ts`

### Wiring A — import (setelah reflection.ts:18)

```ts
import { fetchExistingCoreFacts, EMPTY_MCP_CONTEXT } from "./mcp";
import type { McpContext } from "./mcp";
```

### Wiring B — `extractReflectionFacts` tambah param opsional `existingFacts` (reflection.ts:140-163)

```ts
export async function extractReflectionFacts(
  llm: OpenRouterClient,
  turns: { role: string; content: string }[],
  existingFacts: { title: string; excerpt: string }[] = [],
): Promise<ReflectionFact[]> {
  ...
  const existingBlock = existingFacts.length
    ? `\n\nAlready-known durable facts (DO NOT re-extract or duplicate these):\n${existingFacts
        .map((f) => `- ${f.title}: ${f.excerpt}`)
        .join("\n")}`
    : "";

  const userPrompt = `Conversation (no PII expected):
${transcript}
${existingBlock}

Output JSON array of durable facts:`;
```

System prompt tidak berubah (reflection.ts:148-158).

### Wiring C — `reflectUser` provider + threading (reflection.ts:91-133)

```ts
opts: { windowDays?: number; maxTurns?: number;
        existingFactsProvider?: (userId: string) => Promise<McpContext> } = {}
...
const provider = opts.existingFactsProvider ?? fetchExistingCoreFacts;
...
if (turns.length === 0) return { factsUpserted: 0, skipped: 0 };   // early return tidak berubah

const chronological = [...turns].reverse();
const mcpCtx = await provider(userId);                        // step 1.5
const facts = await extractReflectionFacts(llm, chronological, mcpCtx.facts);
...
await upsertReflectionFact(crdb, llm, userId, fact, mcpCtx);
```

### Gap 3 — konstruksi audit `detail` saja (reflection.ts:241-275)

```ts
async function upsertReflectionFact(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  userId: string,
  fact: ReflectionFact,
  mcpCtx: McpContext = EMPTY_MCP_CONTEXT,
): Promise<void> {
  ...
  const detail = JSON.stringify({
    factTitle: fact.title,
    mcp_context_used: mcpCtx.used,       // ternormalisasi: selalu hadir
    mcp_facts_count: mcpCtx.factsCount,  // true/n sukses · true/0 sukses-kosong · false/0 gagal/no-key
  });

  await crdb.execute(
    `INSERT INTO audit_events (user_id, type, detail)
     VALUES ($2::uuid, $1, $3)
     ON CONFLICT DO NOTHING`,
    [REFLECT_AUDIT_TYPE, userId, detail],
  );
```

Statement INSERT tidak berubah — hanya konstruksi `detail`.

## Konfirmasi per-gap

1. **Gap 1 — Fully resolved.** `callSelectQuery` memakai `signal: AbortSignal.timeout(MCP_FETCH_TIMEOUT_MS)` (env `MCP_FETCH_TIMEOUT_MS`, default 5000); abort → rejection yang ditelan `catch` mcp.ts → graceful degradation; tanpa retry.
2. **Gap 2 — Fully resolved oleh Gap 1; tanpa `Promise.race`.** Timeout mengubah hang → rejection yang ditangkap di dalam `fetchExistingCoreFacts` (return `EMPTY_MCP_CONTEXT`); tidak sampai `reflectUser`/loop. `Promise.race` di loop hanya melindungi hang DB/LLM/embedding (gap pra-eksisting, di luar scope).
3. **Gap 3 — Fully resolved.** `detail` selalu memuat `mcp_context_used` + `mcp_facts_count` (true/n sukses, true/0 sukses-kosong, false/0 gagal/no-key) lewat satu perubahan konstruksi; INSERT tidak disentuh. Catatan: `detail` audit tidak lagi byte-identical dengan pra-MCP — biaya normalisasi yang disengaja.
4. **Gap 4 — Fully resolved.** `const startMs = Date.now()` di awal `fetchExistingCoreFacts`; `reflection.mcp_failed` di catch kini memuat `durationMs: Date.now() - startMs`; tidak ada perubahan logging lain.
5. **Gap 5 — Fully resolved.** Satu `logger.info("reflection.mcp_query", …, { userId, durationMs, factsCount, success })` di `finally` menutup path sukses & gagal; durasi MCP queryable di Loki/Grafana tanpa memperkenalkan span.

## Verify (Build — TDD, additive only)

- `lambda/tests/mcp.test.ts` (baru): success (stub `globalThis.fetch` payload SSE → `{used:true, factsCount:n}`), failure (`fetch` reject → `EMPTY_MCP_CONTEXT`), timeout (stub `fetch` reject saat `signal` abort; `vi.useFakeTimers()` maju 5000ms → `EMPTY_MCP_CONTEXT`), no-key (hapus env → `EMPTY_MCP_CONTEXT`, tanpa network).
- `reflection.test.ts` (tambah): prompt memuat judul existing-fact + "DO NOT re-extract"; `reflectUser` audit `params[2]` parse → `mcp_context_used:false, mcp_facts_count:0` dengan provider stub; beri stub `existingFactsProvider: async () => EMPTY_MCP_CONTEXT` di test `reflectUser`/loop yang ada agar hermetic.
- Jalankan: `cd lambda && npm test && npm run typecheck:test && npx tsc --noEmit`.

## Review / Ship (pasca implementasi)

- Pass `code-review-and-quality` pada 2 file tersentuh; pastikan steps 1–5 logic tidak berubah.
- Update `docs/MCP-STATUS.md` §2 (sekarang: "Lambda MCP Client (deprecated — tidak dibuat)") dan `.env.example` (dokumentasikan `MCP_FETCH_TIMEOUT_MS`). Opsional: wire `CCLOUD_MCP_API_KEY` di `infra/modules/lambda/main.tf` (fallback ke `CCLOUD_API_KEY` yang sudah ada).
