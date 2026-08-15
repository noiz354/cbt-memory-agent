# Spec: FASE Vector Indexing — Semantic Chat Retrieval + Hybrid RRF + Distributed Indexing

> Status: **DRAFT → APPROVED** (2026-08-15) · Alur: Define → Plan → Build → Verify → Review → Ship
> Repo: `cbt-memory-agent` · Stack: Lambda Node 22 TS (`lambda/`) · CockroachDB (`woozy-grivet` v26.2.5) · Frontend React+Vite TS (`src/`)
> Basis: [RESEARCH-VECTOR-INDEXING.md](./RESEARCH-VECTOR-INDEXING.md) (Opsi A sudah live) · Workflow: ADDY-OSMANI-SKILLS

## 1. Objective

Memenuhi klaim marketing *"Store and query embeddings at scale ... Semantic search
and retrieval stay fast as your data grows — no separate vector store, no reindexing
pain, no consistency gaps"* dengan menyelesaikan **gap 1-8** terhadap Opsi A yang
sudah live (writer embeddings + index cosine + semantic endpoint):

| # | Gap | Capability | Effort |
|---|---|---|---|
| 1 | Chat retrieval masih murni heuristik, vector tidak dipakai | **Semantic chat retrieval** (embed userMessage + cosine) | M |
| 2 | Tidak ada hybrid keyword+vector | **Hybrid RRF** (heuristic ∪ vector) | M |
| 3 | Index tanpa prefix `user_id` | **Distributed index per-tenant** `(user_id, embedding)` | S |
| 4 | Tidak ada backfill tooling | **Backfill script** embeddings | S |
| 5 | Semantic tidak filter `verified` (inkonsisten dgn retrieval) | **Filter verified** di semantic | XS |
| 6 | Embedding text tanpa tags, tanpa chunking | **Tags + chunking** (window 2000/overlap 100) | S |
| 7 | Index belum terbukti dipakai + belum tuning | **Load test + EXPLAIN ANALYZE + tuning** | M |
| 8 | Tidak ada observability embedding | **Span attrs + coverage queries** | S |

**Sukses =** chat agent memakai vector retrieval (hybrid RRF) dengan fallback mulus
saat embedding gagal; index ber-prefix `user_id` (satu k-means tree per user); backfill
bisa mengisi node lama; semantic hanya mengembalikan node verified; embedding text
kaya (tags + chunked); EXPLAIN ANALYZE membuktikan operator `vector search`; coverage
embedding terlihat.

## 2. Capability Map

| Capability | Output | Dependensi |
|---|---|---|
| C1 Semantic filter verified + prefix | `semanticSearch.ts` SQL | embeddings, memory_nodes |
| C2 Prefix index | migration `vector-prefix` + `crdb-schema.sql` | embeddings |
| C3 Chunking + tags | `vectors.ts` (`embeddingText`, `buildEmbeddingChunks`), writer `memory.ts` | C2 |
| C4 Hybrid RRF retrieval | `lambda/lib/retrieval.ts` (baru) + `chatTurn.ts` | C3, C1 |
| C5 Observability | span attrs + `schema/vector-queries.sql` | C4 |
| C6 Backfill script | `scripts/backfill-embeddings.ts` | C3 |
| C7 Load test + tuning | `scripts/load-test-vectors.ts` | C2, C3 |

## 3. Kontrak Modul

### C1 `semanticSearch.ts` — filter verified + prefix equality
```sql
WHERE mn.user_id = $2::uuid
  AND e.user_id = $2::uuid        -- prefix equality (index pruning)
  AND mn.verified = true          -- konsisten dgn getMemoryContext
  AND mn.confidence >= $3
  AND e.embedding IS NOT NULL
```

### C2 Prefix index (migration idempotent)
```sql
SET sql_safe_updates = false;
DROP INDEX IF EXISTS embeddings_vector_idx;
CREATE VECTOR INDEX IF NOT EXISTS embeddings_vector_idx
  ON embeddings (user_id, embedding vector_cosine_ops);
```
Update `crdb-schema.sql:118` agar konsisten.

### C3 Chunking + tags (`vectors.ts`)
- `embeddingText(node)` → `title — tags — excerpt` (node bertambah `tags?: string[]`).
- `buildEmbeddingChunks(node)` → array `{ text, textSource }`:
  - text = `embeddingText(node)`; bila len > `CHUNK_SIZE` (2000) → potong window 2000, overlap `CHUNK_OVERLAP` (100) → `chunk-0, chunk-1, …`.
- Writer (`memory.ts writeNodeEmbedding`): loop chunk → DELETE stales per node → INSERT per chunk (non-batch).

### C4 Hybrid RRF retrieval
- `lambda/lib/retrieval.ts` (baru):
  - `reciprocalRankFusion<T>(sets: T[][], k = 60, topN = 8)` → rank-based fusion.
- `chatTurn.ts getMemoryContext(crdb, llm, userId, memoryIds, userMessage)`:
  - `memoryIds` non-empty → query by id (heuristik, tanpa embed) `mode=heuristic`.
  - else → `heuristicRows` (query lama) + `vectorRows` (embed userMessage → cosine
    query, filter verified/confidence/prefix, dedup-by-node score maks) → RRF top-8,
    `mode=hybrid`.
  - embedding gagal → heuristic murni, `mode=heuristic`, `failed=true`.
- Query vector chat (dedup chunking):
```sql
SELECT DISTINCT ON (mn.id) mn.id, mn.title, COALESCE(mn.excerpt,'') AS excerpt,
       COALESCE(mn.crisis_flag,false) AS crisisFlag,
       1 - (e.embedding <=> $1::vector) AS score
FROM embeddings e JOIN memory_nodes mn ON mn.id = e.node_id
WHERE mn.user_id = $2::uuid AND e.user_id = $2::uuid
  AND mn.verified = true AND mn.confidence >= $3 AND e.embedding IS NOT NULL
ORDER BY mn.id, e.embedding <=> $1::vector
LIMIT $4
```

### C5 Observability
- Span `agent.memory.retrieve`: `memory.mode`, `memory.embedding_ms`, `memory.failed`.
- `schema/vector-queries.sql`: coverage (total node vs ber-embedding), per text_source.

### C6 Backfill (`scripts/backfill-embeddings.ts`)
- npx tsx; iterasi node tanpa embeddings → `generateEmbedding` → INSERT (loop per-node).
- Idempotent; flags `--user <md5>|--all`, `--dry-run`; print coverage before/after;
  exit non-zero bila ada gagal.

### C7 Load test (`scripts/load-test-vectors.ts`)
- Seed ~10k embeddings ke user fake (`md5('loadtest-*')`), `EXPLAIN ANALYZE` cosine
  query (prefix user) → pastikan operator `vector search`; ukur latensi; coba
  `SET vector_search_beam_size`.

## 4. Kontrak Data (tidak berubah)

Tabel `embeddings` tetap: `(id, user_id, node_id, embedding vector(1024), text_source, created_at)`.
`text_source` kini bisa `title+excerpt` (chunk tanpa split) atau `chunk-N`.

## 5. Keputusan Terkunci (user approval 2026-08-15)
1. Gap 1: **full semantic tiap turn** (tanpa `memoryIds`).
2. Gap 2: **Hybrid RRF** (`k=60`).
3. Gap 4: **backfill dieksekusi live** untuk verifikasi.
4. Tanpa daily-cap counter lokal (cap di account OpenRouter); embedding best-effort.

## 6. Acceptance Criteria
- [ ] `getMemoryContext` hybrid: hasil relevan semantik lebih tinggi dari heuristik murni.
- [ ] Fallback mulus: embedding gagal → chat tetap jalan (heuristik), `failed=true`.
- [ ] Semantic hanya mengembalikan node `verified=true`.
- [ ] Index live `(user_id, embedding vector_cosine_ops)`; EXPLAIN pada data besar = `vector search`.
- [ ] Backfill: coverage naik ke 100%, idempotent (run ulang tidak insert duplikat).
- [ ] Chunking: excerpt 6000 char → ≥3 baris embeddings `chunk-N`.
- [ ] `cd lambda && npx tsc --noEmit && npm test` hijau (suite + tes baru).
- [ ] Span attrs mode/embedding_ms/failed muncul.

## 7. Boundaries
- Always: TDD per modul; jalankan seluruh suite sebelum commit.
- Ask first: mengubah schema (index drop/recreate) — sudah disetujui via migration; menambah dependency.
- Never: commit rahasia (.env/token); batch insert vektor; mengubah `EMBED_DIM`.

## 8. Open Questions
- Tuning beam/partition optimum di skala 10k — diukur saat load test (C7).
