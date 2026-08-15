-- Migration: hybrid keyword+vector (full-text search) — Gap utilisasi vector
--
-- Tambah full-text search ke memory_nodes agar retrieval chat punya jalur keyword
-- (tsvector) di samping heuristik + vector. Dipakai expression INVERTED INDEX
-- (GIN) ber-prefix user_id — CRDB menolak computed column STORED karena
-- concatenation/cast bersifat context-dependent; expression index adalah cara
-- resmi untuk FTS (lihat docs full-text-search: CREATE INDEX ... USING GIN
-- (to_tsvector('english', ...))).
--
-- CATATAN:
-- - Harus config 'english' eksplisit di to_tsvector.
-- - Inverted index = GIN di CRDB; GIN/GiST identik.
-- - Keterbatasan CRDB: `@@` dengan kedua sisi variable tidak di-index-accelerate
--   → query pakai plainto_tsquery('english', $2) (satu sisi variable) agar
--   masih bisa memakai inverted index.
-- - Ekspresi TIDAK menyertakan tags (array cast context-dependent → ditolak).
-- - Tabel non-empty → SET sql_safe_updates = false.
-- - Idempotent: bisa dijalankan ulang.

SET sql_safe_updates = false;

DROP INDEX IF EXISTS memory_nodes_search_idx;

CREATE INVERTED INDEX IF NOT EXISTS memory_nodes_search_idx
  ON memory_nodes (user_id, to_tsvector('english', title || ' ' || COALESCE(excerpt, '')));
