-- Migration: prefix index (user_id) untuk vector embeddings (Gap 3)
--
-- Satu k-means tree (C-SPANN) per user → biaya search per-tenant, bukan seluruh
-- tabel. Semua query vector (semantic + chat retrieval) WAJIB equality-constraint
-- `e.user_id = $n::uuid` agar index pruning aktif.
--
-- Tabel embeddings non-empty → butuh SET sql_safe_updates = false (tabel kecil).
-- Idempotent: bisa dijalankan ulang.

SET sql_safe_updates = false;

DROP INDEX IF EXISTS embeddings_vector_idx;

CREATE VECTOR INDEX IF NOT EXISTS embeddings_vector_idx
  ON embeddings (user_id, embedding vector_cosine_ops);
