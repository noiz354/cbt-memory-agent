-- Observability: coverage embedding + diagnostic vector queries (Gap 8)
--
-- Dipakai untuk memantau health FASE Vector Indexing: berapa node sudah punya
-- embedding (coverage), distribusi text_source (chunking), node tanpa embedding
-- (kandidat backfill), dan rencana eksekusi index.

-- 1. Coverage embedding — node dengan embeddings / total node (per user)
SELECT
  mn.user_id,
  COUNT(*) AS total_nodes,
  COUNT(DISTINCT e.node_id) AS nodes_with_embedding,
  ROUND(COUNT(DISTINCT e.node_id)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS coverage_pct
FROM memory_nodes mn
LEFT JOIN embeddings e ON e.node_id = mn.id AND e.user_id = mn.user_id
GROUP BY mn.user_id
ORDER BY total_nodes DESC;

-- 2. Distribusi text_source (chunking bekerja?)
SELECT text_source, COUNT(*) AS row_count
FROM embeddings
GROUP BY text_source
ORDER BY row_count DESC;

-- 3. Node TANPA embedding (kandidat backfill) — join mencakup chunking
SELECT mn.id, mn.title, mn.user_id
FROM memory_nodes mn
LEFT JOIN embeddings e ON e.node_id = mn.id AND e.user_id = mn.user_id
WHERE e.id IS NULL
ORDER BY mn.last_touched DESC;

-- 4. Total embeddings per user (multi-chunk node terlihat sebagai > 1 baris)
SELECT user_id, COUNT(*) AS embedding_rows, COUNT(DISTINCT node_id) AS nodes
FROM embeddings
GROUP BY user_id
ORDER BY embedding_rows DESC;

-- 5. Rencana eksekusi query vector chat (pastikan operator `vector search`,
--    bukan full scan; jalankan setelah backfill + load test).
--    Bentuk derived-table: subquery single-tabel (index vector search) →
--    JOIN memory_nodes dengan filter verified/confidence di WHERE luar.
EXPLAIN ANALYZE
SELECT mn.id, mn.title, COALESCE(mn.excerpt, '') AS excerpt,
       COALESCE(mn.crisis_flag, false) AS crisisFlag,
       1 - sub.distance AS score
FROM memory_nodes mn
JOIN (SELECT e.node_id, e.embedding <=> '[0.1,0.2,0.3,0.4]'::vector AS distance
      FROM embeddings e
      WHERE e.user_id = '00000000-0000-0000-0000-000000000000'::uuid
      ORDER BY e.embedding <=> '[0.1,0.2,0.3,0.4]'::vector
      LIMIT 16) sub ON sub.node_id = mn.id
WHERE mn.user_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND mn.verified = true
  AND mn.confidence >= 0.6
ORDER BY sub.distance
LIMIT 8;
