# Riset: CockroachDB Distributed Vector Indexing (C-SPANN)

> Disusun: 2026-08-15 · Workflow: ADDY-OSMANI-SKILLS (Define → Plan) · Status: **RISET (Define+Plan), belum Build**
> Topik: *"Store and query embeddings at scale using CockroachDB's vector support with distributed indexing."*
> Konteks proyek: evaluasi apakah memory agent (`cbt-memory-agent`, CRDB cluster live `woozy-grivet` v26.2.5) bisa memakai vector search native CRDB untuk RAG/semantic retrieval, tanpa vector store terpisah.

---

## 1. Ringkasan Eksekutif

CockroachDB sudah punya **vector indexing GA** sejak v25.4 (Nov 2025). Implementasinya **bukan HNSW** — CRDB memakai **C-SPANN** (Cockroach SPANN): pohon k-means hierarkis (terinspirasi Microsoft SPANN/SPFresh + Google ScaNN) yang **terdistribusi sebagai KV ranges biasa**, bukan graf in-memory. `USING hnsw` diterima sebagai alias kompatibilitas pgvector yang tetap membangun index cspann.

Untuk use case **agent memory / RAG skala kecil–menengah (10k–1M embedding, node tunggal atau cluster kecil)**, native vector CRDB adalah pengganti vector store terpisah yang kredibel: GA, konsisten transaksional dengan data relasional, prefix-column untuk isolasi per-user/tenant, tanpa biaya operasional database kedua. Keterbatasan utama: hindari batch insert besar, writes diblokir selama backfill index, `IMPORT INTO` tidak didukung di tabel ber-index vector, dan operator pengukuran jarak tertentu belum di-accelerate.

**Temuan kunci untuk repo ini:** seluruh plumbing sudah ada tapi **mati**:
- Tabel `embeddings` + `VECTOR INDEX embeddings_vector_idx (embedding vector_l2_ops)` **sudah live** di cluster v26.2.5 (`feature.vector_index.enabled = t`).
- Handler `GET /api/v1/memory/semantic` sudah menjalankan cosine `<=>` + `generateEmbedding` (baai/bge-m3, 1024-dim).
- **TAPI tidak ada satu pun `INSERT INTO embeddings`** — tabel selalu 0 baris. Chat retrieval (`getMemoryContext` di `chatTurn.ts:192`) murni heuristik (verified + confidence≥0.6 + weight/last_touched), **tidak pernah menyentuh vector**.

Jadi pekerjaan nyata = **menulis writer embeddings** (saat memory upsert) + **opsional meng-arahkan `getMemoryContext` ke vector retrieval**, plus fix mismatch opclass L2-vs-cosine.

---

## 2. Fakta Teknis (dari dokumentasi resmi)

### 2.1 Tipe `VECTOR(N)`
- Array float fixed-length; N = dimensi, divalidasi saat tulis. Literal: `'[1.0, 0.0, 0.0]'`. Dideklarasi `embedding VECTOR(1536)`.
- Operator: `=`/`<>` (filter), `<->` (L2/Euclidean), `<#>` (negative inner product), `<=>` (cosine distance).
- Fungsi pgvector: `cosine_distance()`, `inner_product()`, `l1_distance()`, `l2_distance()`, `vector_dims()`, `vector_norm()` (immutable).
- Riwayat versi: **v24.2 (Agu 2024)** preview tanpa index; **v25.4** tanpa tag preview (efektif GA); v26.3 docs GA penuh.
- Ukuran: disarankan < 1 MB per nilai; di atas itu write amplification.
- **Encoding FLOAT32 pgvector-compatible** (wire/binary format PostgreSQL extended protocol didukung sejak v25.4 patch). Tidak ada dokumentasi resmi encoding "INT32".

### 2.2 Vector index = **C-SPANN**, bukan HNSW
- **Struktur:** pohon k-means hierarkis; vektor dikelompokkan ke partitions (tiap partition punya centroid), di-cluster rekursif ke pohon lebar (fanout ~100). 1M vektor → ~3 level; 10B → ~5 level.
- **Distribusi:** partitions = KV rows kontigu dalam ranges → di-split/merge/rebalance otomatis seperti data biasa. Tanpa coordinator terpusat, tanpa struktur in-memory besar (partitions dari block cache). Klaim "near-linear scaling" saat nambah node.
- **Quantisasi:** entries di-quantize **RaBitQ** (~94% hemat, mis. 1536-dim ~3 KB → ~200 B), lalu **rerank** dengan vector asli dari tabel.
- **GA timeline:** v25.2 preview (hanya L2, di-gate `feature.vector_index.enabled` default false) → **v25.4 GA** (online table backfill, cosine+inner-product acceleration, incremental maintenance, default `true`, tersedia di Self-hosted + semua tier Cloud) → v26.1 fix multiple column families → v26.3 `EXPLAIN ANALYZE` report vector stats + `EXPLAIN` bisa rekomendasi vector index.
- **Parameter:** `vector_search_beam_size` (session, default **32**); `min_partition_size` (default 16, max 1024); `max_partition_size` (default 128, max 4096, ≥4× min); `build_beam_size` (default 8, jangan diutak-atik). Naikkan beam/partition = akurasi ↑, latensi+CPU ↑. Partition besar juga mempercepat insert.
- **Opclass (metric per index):** `vector_l2_ops` (default), `vector_cosine_ops`, `vector_ip_ops`. **Hanya metric yang cocok dengan opclass yang di-accelerate.** `vector_l1_ops`, `bit_hamming_ops`, `bit_jaccard_ops` TIDAK diimplementasikan (fungsi `l1_distance()` ada, index-nya tidak).

### 2.3 Perilaku di skala & batasan
- Index-based (operator plan `vector search`), bukan brute-force scan (yang jadi perilaku pre-v25.2).
- Contoh resmi: ~156,541 vektor 512-dim + index + prefix column, search tunggal ~14 ms di 1 node.
- **Prefiks columns** (kolom non-vector di depan): partition per nilai prefix — cocok untuk isolasi tenant/user (mis. `user_id`). Index hanya terpakai jika SEMUA prefix column di-constrain dengan equality (`=` atau `IN` pada tuple); range filter men-disable index. Disarankan prefix untuk "jutaan vektor atau lebih". Dengan `REGIONAL BY ROW`, prefix bisa co-locate index+data per region.
- **Batasan penting:**
  - Hindari **batch insert** vektor (degradasi performa) → single-row insert loop, atau `IMPORT INTO` dulu baru create index.
  - **`IMPORT INTO` tidak didukung** di tabel yang sudah punya vector index.
  - **Backfill** di tabel non-empty butuh `SET sql_safe_updates = false`; selama backfill **writes diblokir** (v25.4: online backfill → table tidak offline, reads lanjut, tapi writes diblokir).
  - Legacy schema changer tidak bisa create vector index (wajib declarative schema changer).
  - `USING hnsw` = alias `cspang`→`cspann` (tulisan saya salah, ini cspann) untuk kompatibilitas pgvector.
  - Bug historis: v25.2-beta index tidak kompatibel dengan rilis lanjutan (drop/recreate); PCR standby-reads salah hasil (fixed sebelum GA); multiple-column-families wrong results (fixed v26.1).
- **Tidak terverifikasi/dokumen-ambigu:** angka "64 MiB row limit" tidak saya temukan di docs v26.3 (yang terdokumentasi hanya rekomendasi <1 MB per vektor); tidak ada benchmark recall/throughput resmi yang dipublikasikan.

### 2.4 Kompatibilitas pgvector
- Subset, bukan port penuh: tipe `vector` saja (tidak ada `halfvec`/`bit`/`sparsevec`); 6 fungsi; 3 opclass index. Tidak ada `binary_quantize`/`subvector`.
- Wire encoding pgvector-compatible → library pgvector client bisa dipakai.
- Posisi: untuk skala kecil–menengah, "cukup" menggantikan pgvector tunggal-node (yang punya ceiling scaling node tunggal) dan vector DB dedicated.

### 2.5 Best practice resmi untuk RAG/agent memory
- Simpan source data + metadata (JSONB) + embedding **di tabel yang sama / satu query** (unified model). Contoh DDL resmi: `id UUID PK DEFAULT gen_random_uuid()`, `customer_id INT NOT NULL`, `name TEXT`, `embedding VECTOR(512)`, `VECTOR INDEX (customer_id, embedding)` (prefix tenant).
- Cosinus direkomendasikan untuk RAG dengan normalized embedding.
- Jangan batch insert; kalau bulk load, import dulu baru index.
- Tuning: beam/partition size di atas.
- Hybrid: native full-text (`tsvector`/`tsquery`) + trigram (`gin_trgm_ops`/`gist_trgm_ops`) untuk keyword+vector.

---

## 3. State Nyata di Repo Ini (temuan eksplorasi)

### 3.1 Schema (live, terverifikasi via psql)
- Tabel `memory_nodes` (graph: kind core/transcript, title, excerpt, tags string[], weight/confidence 0..1, verified, ref_count, last_touched, x/y, crisis_flag) — `schema/crdb-schema.sql:57`.
- Tabel `memory_edges` (graph relasi source→target, label) — `schema/crdb-schema.sql:84`.
- Tabel `embeddings` — `schema/crdb-schema.sql:104`:
  ```sql
  id UUID PK, user_id UUID FK users, node_id STRING FK memory_nodes,
  embedding vector(1024), text_source STRING, created_at,
  INDEX embeddings_user_idx (user_id), INDEX embeddings_node_idx (node_id),
  CREATE VECTOR INDEX embeddings_vector_idx ON embeddings (embedding);
  ```
  **Live di cluster v26.2.5** terverifikasi sebagai `VECTOR INDEX embeddings_vector_idx (embedding vector_l2_ops)` = **CSPANN, metric L2**. `feature.vector_index.enabled = t`. **0 baris.**
- `CREATE EXTENSION IF NOT EXISTS vector;` di `crdb-schema.sql:11`.

### 3.2 Alur retrieval saat ini
- **Chat** → `handleChatTurn` (`lambda/handlers/chatTurn.ts:45`) → span OTel `agent.memory.retrieve` (chatTurn.ts:80) → `getMemoryContext` (`chatTurn.ts:192`): SELECT id,title,excerpt,crisis_flag FROM memory_nodes WHERE user_id AND verified=true AND confidence>=0.6 AND (id=ANY(memoryIds) OR '{}') ORDER BY weight DESC, last_touched DESC LIMIT 8. **Murni heuristik, tanpa vector, tanpa full-text.** → prompt: memory sebagai *second system message* (chatTurn.ts:93-108).
- **Semantic search standalone** → `GET /api/v1/memory/semantic?q&limit&minConfidence` (`lambda/handlers/semanticSearch.ts:21`): `generateEmbedding(q)` (baai/bge-m3, 1024-dim via OpenRouter, `lambda/lib/openrouter.ts:53`, span `llm.embedding`) → query:
  ```sql
  SELECT mn.id, mn.title, COALESCE(mn.excerpt,'') AS excerpt, 1 - (e.embedding <=> $1::vector) AS score
  FROM embeddings e JOIN memory_nodes mn ON mn.id=e.node_id
  WHERE mn.user_id=$2::uuid AND mn.confidence>=$3 AND e.embedding IS NOT NULL
  ORDER BY e.embedding <=> $1::vector LIMIT $4
  ```
  → `toVectorLiteral` (presisi 6 desimal). **Ada, jalan, tapi `embeddings` kosong → selalu return `{results:[]}`.**
- **Tidak ada writer embeddings:** grep `INSERT INTO embeddings` = 0 hit. `handleUpsertMemory` (`lambda/handlers/memory.ts:95`) hanya insert/update `memory_nodes` + `memory_edges`.
- **Frontend:** MemoryPage search = backend semantic + fallback substring lokal; memoryStore seed graph + `syncNode` fire-and-forget; `memorySearched` telemetry sudah ada.

### 3.3 Gap yang harus diisi
1. **Writer embeddings** — saat memory di-upsert (memory.ts) atau post-process chat turn, generate embedding + `INSERT INTO embeddings` (atau update). Ini prasyarat SEMUA penggunaan vector.
2. **Mismatch opclass** — index live `vector_l2_ops`, tapi query semantic pakai cosine `<=>`. Hanya metric yang cocok opclass yang di-accelerate → saat ini cosine akan fallback ke full scan (dan dengan 0 baris tak terlihat; di skala besar = lambat). Opsi: (a) ganti index ke `vector_cosine_ops` (normalized embeddings → cosine = tepat), atau (b) ubah query ke L2 `<- >`.
3. **Chat retrieval belum semantic** — `getMemoryContext` tidak pakai vector. Untuk "RAG pipeline / long-term agent memory", perlu embed `userMessage` + query cosine (dengan filter verified/confidence/prefix user_id), menggantikan atau mengaugmentasi heuristik LIMIT 8.
4. **Prefiks user_id** — index sekarang tanpa prefix; untuk multi-user lebih baik `VECTOR INDEX (user_id, embedding)` + prefix equality. Untuk app single-user saat ini, tanpa prefix OK.

---

## 4. Plan: Opsi Implementasi (Define → Plan)

Keputusan lingkup yang perlu user pilih sebelum Build. (Konsisten dengan risk-profil proyek: pakai vector native CRDB, bukan vector store terpisah.)

| Opsi | Deskripsi | Effort | Risiko |
|---|---|---|---|
| **A. Writer + Semantic aktif** (minimum viable) | Backfill writer embeddings saat upsert memory; index cosine; biarkan chat heuristik; semantic endpoint mulai benar-benar berguna | S | Rendah |
| **B. A + semantic chat retrieval** | A + `getMemoryContext` pakai embedding query + cosine (augment heuristik: verified/confidence tetap sebagai filter, hasil vektor sebagai ranking) | M | Sedang (biaya embedding per chat, fallback) |
| **C. B + hybrid keyword+vector + prefix user_id** | Tambah full-text/trigram + index ber-prefix + tuning beam/partition; "full RAG" | L | Tinggi (perlu ukur recall/latensi) |

**Rekomendasi:** **Opsi A** sebagai FASE berikutnya (mengaktifkan infrastruktur yang sudah terpasang, bounded, dapat diverifikasi dengan tes + curl live), lalu evaluasi B setelah data terkumpul. Konsisten dengan pola fase-fase sebelumnya (FASE 4 → FASE 1-3).

**Catatan versi:** cluster live v26.2.5 mendukung penuh (GA) vector index. DDL `CREATE VECTOR INDEX` tanpa opclass eksplisit → default `vector_l2_ops` (sesuai temuan live). Jika pilih cosine, DDL perlu `USING cspann` eksplisit + opclass cosine.

---

## 5. Sumber (Sources)

Dokumentasi resmi CockroachDB (docs.cockroachlabs.com):
1. https://docs.cockroachlabs.com/docs/stable/vector — tipe VECTOR (v26.3)
2. https://docs.cockroachlabs.com/docs/v26.3/vector-indexes.md — Vector Indexes v26.3 (C-SPANN, parameter, prefix, best practice)
3. https://docs.cockroachlabs.com/docs/v25.2/vector-indexes.md — v25.2 (preview)
4. https://docs.cockroachlabs.com/docs/v25.4/vector-indexes.md — v25.4 (GA)
5. https://docs.cockroachlabs.com/docs/v26.1/vector-indexes.md — v26.1
6. https://docs.cockroachlabs.com/docs/v26.2/vector-indexes.md — v26.2
7. https://docs.cockroachlabs.com/docs/v26.3/create-index.md — CREATE INDEX (`USING cspann`/`hnsw` alias)
8. https://docs.cockroachlabs.com/docs/v26.3/functions-and-operators.md — fungsi pgvector
9. https://docs.cockroachlabs.com/docs/v26.3/cockroachdb-and-ai.md — CockroachDB & AI
10. https://docs.cockroachlabs.com/docs/releases/v24.2.md · https://docs.cockroachlabs.com/docs/releases/v25.2.md · https://docs.cockroachlabs.com/docs/releases/v25.4.md · https://docs.cockroachlabs.com/docs/releases/v26.1.md · https://docs.cockroachlabs.com/docs/releases/v26.3.md — release notes
11. https://www.cockroachlabs.com/blog/cspann-real-time-indexing-billions-vectors/ — arsitektur C-SPANN + RaBitQ (2025-06-23)
12. https://www.cockroachlabs.com/blog/tutorial-rag-with-cockroachdb/ — tutorial RAG (2025-06-13)
13. https://www.cockroachlabs.com/blog/vector-search-pgvector-cockroachdb/ — intro vector search (v24.2 preview)

Verifikasi live (psql → cluster `woozy-grivet`, database defaultdb):
- `SELECT version()` → CockroachDB CCL **v26.2.5** (built 2026/07/28)
- `SHOW CLUSTER SETTING feature.vector_index.enabled` → **t**
- `pg_indexes` → `embeddings_vector_idx` = `USING cspann (embedding vector_l2_ops)`
- `SELECT count(*) FROM embeddings` → **0**

---

## 6. Status & Next

- [x] Define: riset web + codebase + verifikasi live
- [x] Plan: opsi A/B/C + rekomendasi
- [ ] **Build** (menunggu keputusan user): paling disarankan Opsi A
- [ ] Verify: tes lambda (writer embedding, query cosine), curl live, EXPLAIN ANALYZE pakai vektor asli
- [ ] Review + Ship: ADR + commit (mengikuti pola fase sebelumnya)
