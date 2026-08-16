-- Migration: emotional media attachments — kind='attachment' + attachments table
--
-- Feature "Emotional Media Attachments":
--   1. memory_nodes.kind diperluas menerima 'attachment' (media terindeks:
--      gambar/video/audio). Sebelumnya CHECK hanya ('core','transcript').
--   2. Tabel attachments menyimpan hasil analisis emosi on-device (analysis JSONB)
--      + narasi yang di-embed (embedded_narrative) + lokasi raw media di S3
--      (s3_key). FK memory_node_id → memory_nodes(id) ON DELETE CASCADE agar
--      hard purge & delete memory otomatis membersihkan baris attachments
--      (pola sama dengan embeddings).
--
-- CATATAN (CRDB v26.2):
-- - Migration drop BOTH kemungkinan nama constraint kind, lalu recreate satu
--   constraint eksplisit (pola sama dengan migration-2026-08-16-*-audit.sql).
-- - Idempotent: bisa dijalankan ulang tanpa error (guard IF EXISTS).
-- - Non-destructive: hanya menambah nilai CHECK + CREATE TABLE baru.
-- - Raw media TIDAK disimpan di sini — hanya s3_key. Byte-nya di S3.

SET sql_safe_updates = false;

-- 1. Perluas CHECK memory_nodes.kind untuk menerima 'attachment'
ALTER TABLE memory_nodes DROP CONSTRAINT IF EXISTS memory_nodes_kind_check;
ALTER TABLE memory_nodes DROP CONSTRAINT IF EXISTS check_kind;
ALTER TABLE memory_nodes ADD CONSTRAINT memory_nodes_kind_check CHECK (
  kind IN ('core', 'transcript', 'attachment')
);

-- 2. Tabel attachments — metadata hasil analisis emosi media
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_node_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  kind STRING NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  duration_ms INT,
  frame_count INT,
  analysis JSONB NOT NULL,
  embedded_narrative STRING NOT NULL,
  s3_key STRING NOT NULL,
  mime_type STRING,
  size_bytes INT,
  session_id STRING,
  turn_id STRING,
  extracted_on_device BOOL DEFAULT true,
  pipeline_version STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX attachments_user_idx (user_id),
  INDEX attachments_node_idx (memory_node_id),
  INDEX attachments_kind_idx (kind)
);
