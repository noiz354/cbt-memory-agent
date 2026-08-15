-- Migration: agentic memory loop — audit type REFLECTION_RAN
--
-- Handler reflection (cron EventBridge, tiap 6 jam) mencatat audit_events
-- dengan type 'REFLECTION_RAN' setiap kali satu user di-refleksi. Tipe ini
-- belum ada di CHECK constraint audit_events → drop + recreate constraint.
--
-- CATATAN (CRDB v26.2):
-- - Constraint nama asli (`check_type`) berasal dari inline CHECK pada
--   `type STRING NOT NULL CHECK (...)` di crdb-schema.sql (auto-named oleh
--   CRDB). Migration ini drop BOTH kemungkinan nama constraint yang
--   mengandung 'type', lalu recreate satu constraint eksplisit.
-- - CRDB tidak mendukung PL/pgSQL `EXECUTE` (dynamic SQL) → tidak dipakai.
--   `DROP CONSTRAINT IF EXISTS` didukung dan dipakai untuk idempotensi.
-- - Idempotent: bisa dijalankan ulang tanpa error (guard IF EXISTS).
-- - Non-destructive: hanya menambah satu nilai pada CHECK.

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
    'REFLECTION_RAN'
  )
);
