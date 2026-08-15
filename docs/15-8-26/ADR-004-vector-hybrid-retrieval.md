# ADR-004: Hybrid RRF Retrieval + Prefix Vector Index + Chunking (FASE Vector Indexing)

- **Status**: Accepted
- **Date**: 2026-08-15
- **Deciders**: Principal Engineer (agent), per FASE-VECTOR-INDEXING-SPEC.md
- **Related**: RESEARCH-VECTOR-INDEXING.md, ADR-003 (analytics), schema/crdb-schema.sql
- **Amended**: 2026-08-15 — hybrid keyword+vector (full-text leg) + observability otomatis

## Context

Opsi A (writer embeddings + semantic endpoint) sudah live di cluster `woozy-grivet`
v26.2.5, tapi klaim marketing ("retrieval stay fast", "long-term agent memory",
"no reindexing pain", "distributed indexing") belum terpenuhi karena:

1. **Chat retrieval murni heuristik** — `getMemoryContext` (`chatTurn.ts:192`)
   `ORDER BY weight DESC, last_touched DESC LIMIT 8` tanpa vector; vector hanya
   dipakai endpoint `/memory/semantic`.
2. **Index tanpa prefix** — `VECTOR INDEX (embedding vector_cosine_ops)` = satu
   k-means tree global; C-SPANN merekomendasikan prefix column `user_id` untuk
   isolasi tenant (satu tree per user, biaya search per-tenant).
3. **Tidak ada backfill** — node lama/seed/gagal-embed tidak punya embeddings.
4. **Semantic tidak filter `verified`** — inkonsisten dgn retrieval (verified=true).
5. **Embedding text minimal** — hanya `title — excerpt` (tags diabaikan), satu
   embedding per node tanpa chunking.
6. **Index-belum-terbukti** — EXPLAIN dengan 2 baris memilih full scan; belum ada
   load test / EXPLAIN ANALYZE di skala.
7. **Observability tipis** — hanya `logger.warn`; tidak ada coverage/failure metrics.

## Decision

1. **Semantic chat retrieval (full per turn)** — `getMemoryContext(crdb, llm, userId,
   memoryIds, userMessage)`: jika `memoryIds` eksplisit → query by id (heuristik);
   jika tidak → embed `userMessage` + cosine, digabung dgn heuristik via RRF.
2. **Hybrid Reciprocal Rank Fusion (k=60, topN=8)** — fusion berbasis rank (bukan skor
   mentah) agar skala heuristik (weight) vs cosine tidak saling mendominasi. Hasil
   relevan secara semantik DAN sinyal operasional (weight/recency) tetap hadir.
3. **Prefix index `(user_id, embedding vector_cosine_ops)`** — satu k-means tree per
   user; semua query vector (semantic + chat) wajib equality-constraint
   `e.user_id = $n::uuid` agar index pruning aktif.
4. **Best-effort embedding dengan fallback** — kegagalan embedding (OpenRouter down,
   rate limit) TIDAK menggagalkan chat: fallback ke heuristik murni, tandai
   `failed=true`. Tanpa counter daily-cap lokal (cap di sisi account OpenRouter).
5. **Chunking window 2000 / overlap 100** — excerpt panjang dipecah jadi beberapa
   baris embeddings (`chunk-N`); query dedup-by-node pakai `DISTINCT ON (mn.id)` +
   ORDER BY score. `title — tags — excerpt` sebagai teks embedding.
6. **Backfill idempotent** — `scripts/backfill-embeddings.ts`: iterasi node tanpa
   embeddings, insert loop per-node (non-batch, sesuai best practice C-SPANN).
7. **Filter `verified = true` di semantic** — menyamakan kontrak semantic dgn
   retrieval.
8. **Observability** — span attrs `memory.mode`, `memory.embedding_ms`, `memory.failed`;
   query coverage di `schema/vector-queries.sql`.
9. **Tuning empiris** — load test ~10k embeddings ke user fake; `EXPLAIN ANALYZE`
   membuktikan operator `vector search`; coba `SET vector_search_beam_size`.

## Amendment (2026-08-15): hybrid keyword+vector + observability otomatis

Keputusan baru untuk menutup gap utilisasi (evaluasi klaim marketing — lihat
`docs/15-8-26/GAP-UTILISASI-VECTOR.md`):

10. **Hybrid keyword+vector** — `getMemoryContext` kini fuse **3 set** via RRF
    (k=60, top 8): heuristik + **keyword full-text** + vector. Keyword leg:
    `to_tsvector('english', title || excerpt) @@ plainto_tsquery('english', $n)`
    ORDER BY ts_rank, LIMIT 8, filter verified/confidence, equality `user_id`.
11. **Expression INVERTED INDEX, bukan computed column** — CRDB menolak computed
    column STORED berisi ekspresi context-dependent (`array_to_string(tags)`,
    `tags::text` → error). Solusi final: `CREATE INVERTED INDEX
    memory_nodes_search_idx ON memory_nodes (user_id, to_tsvector('english',
    title || ' ' || COALESCE(excerpt, '')))`. Ekspresi query keyword HARUS
    identik dgn ekspresi index agar index-accelerated. `tags` sengaja dikecualikan
    (cast string[] context-dependent; kalaupun dipakai, tak menambah recall signifikan).
12. **Plainto_tsquery tidak di-constant-fold** — di EXPLAIN ANALYZE plan-standalone
    dengan literal tsquery masih tampak full scan; namun dengan **custom plan**
    (PREPARE+EXECUTE, param string) query memakai `memory_nodes_search_idx` +
    operator `inverted filter` (terbukti live: kata langka → 1 row decoded).
    Runtime node-postgres memakai custom plan → index terpakai.
13. **Health-check otomatis** — `scripts/vector-health-check.ts` (npx tsx):
    per-user coverage (exclude user loadtest md5('loadtest-vectors')), index
    full-text ada, EXPLAIN ANALYZE vector berisi operator `vector search`.
    Exit 1 jika regresi; dijalankan oleh `.github/workflows/vector-health.yml`
    (cron 06:00 UTC + manual) dengan `CRDB_CONNECTION_URL` dari secrets.
14. **Dashboard observability** — `infra/grafana/vector-dashboard.json`
    (uid `vector-indexing`): coverage per user, distribusi text_source (chunking),
    node tanpa embedding (kandidat backfill), total embedding per user,
    penanda eksistensi `embeddings_vector_idx`. Di-import oleh
    `infra/grafana/grafana-provision.sh` (semua `infra/grafana/*.json`).

## Consequences

**Positif**: chat agent jadi semantic (RAG) dgn sinyal operasional tetap; biaya search
per-user (prefix); backfill menutup "reindexing pain"; semantic konsisten; data panjang
ter-representasi lebih baik (chunking); performa terbukti (EXPLAIN + latensi).

**Negatif**: +1 OpenRouter embedding call per chat turn (biaya/latensi, mitgasi fallback);
prefix index menambah sedikit ukuran; chunking menambah baris `embeddings` (dedup query
wajib); recreate index pada tabel non-empty butuh `SET sql_safe_updates=false` (tabel
kecil → cepat).

## Verified

- (diisi saat Verify — tsc, npm test, EXPLAIN ANALYZE, curl live, backfill coverage)
- 2026-08-15 (amendment): tsc clean; 86/86 tes; live EXPLAIN keyword → inverted
  index (custom plan); health-check OK (coverage 3/3 = 100%, index full-text ada,
  EXPLAIN vector search); frontend `npm run typecheck` clean.
