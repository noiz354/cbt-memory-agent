-- Migration: Vector index opclass L2 → cosine (2026-08-15)
--
-- Alasan:
-- 1) Query semantic search memakai operator cosine `<=>` (semanticSearch.ts).
--    Hanya metric yang cocok dengan opclass index yang di-accelerate oleh
--    C-SPANN. Index lama `vector_l2_ops` (default `CREATE VECTOR INDEX`)
--    TIDAK meng-accelerate cosine → akan jatuh ke full scan di skala besar.
-- 2) bge-m3 menghasilkan embeddings yang cocok diukur dengan cosine similarity
--    (normalized untuk RAG) — `vector_cosine_ops` adalah pilihan tepat.
--
-- Aman untuk tabel kosong / dev. Untuk tabel besar: backfill non-empty
-- membutuhkan `SET sql_safe_updates = false` dan menulis terblokir selama
-- backfill (batasan resmi CockroachDB v25.4+).
--
-- Idempotent: bisa dijalankan ulang.

DROP INDEX IF EXISTS embeddings_vector_idx;

CREATE VECTOR INDEX embeddings_vector_idx
  ON embeddings (embedding vector_cosine_ops);
