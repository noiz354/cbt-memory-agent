-- Migration: cluster health gate — audit type CLUSTER_HEALTH_CHECK
--
-- Reflection loop (Addition A) menulis audit_events dengan type
-- 'CLUSTER_HEALTH_CHECK' setiap kali gate health cluster dijalankan.
-- Perbedaan dari tipe lain:
--   - Event level cluster → user_id NULL (sebelumnya NOT NULL).
--   - Tipe belum ada di CHECK constraint audit_events → drop + recreate.
--
-- CATATAN (CRDB v26.2):
-- - Migration ini drop BOTH kemungkinan nama constraint yang mengandung
--   'type', lalu recreate satu constraint eksplisit (pola sama dengan
--   migration-2026-08-16-reflection-audit.sql).
-- - Idempotent: bisa dijalankan ulang tanpa error (guard IF EXISTS).
-- - Non-destructive: hanya menambah satu nilai pada CHECK + melonggarkan
--   user_id menjadi nullable.

SET sql_safe_updates = false;

-- Hapus constraint CHECK tipe lama (apa pun namanya) jika masih ada.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_type_check;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS check_type;

-- Recreate dengan nilai baru
ALTER TABLE audit_events ADD CONSTRAINT audit_events_type_check CHECK (
  type IN (
    'CONSENT_GIVEN', 'CRISIS_ENGAGED', 'CRISIS_DISMISSED',
    'SESSION_FINALIZED', 'MEMORY_VERIFIED', 'MEMORY_PURGED',
    'EXPORT_MINTED', 'SESSION_REVOKED', 'HARD_PURGE', 'SIGN_OUT',
    'REFLECTION_RAN', 'CLUSTER_HEALTH_CHECK'
  )
);

-- Event level cluster tidak punya user → longgarkan NOT NULL.
ALTER TABLE audit_events ALTER COLUMN user_id DROP NOT NULL;
