-- CockroachDB Schema — CBT Memory Agent
-- Persistent memory layer untuk hackathon CockroachDB × AWS
--
-- Tables: users, memory_nodes, memory_edges, embeddings, sessions, chat_turns, audit_events
-- Extension: pgvector (untuk semantic search / RAG)

-- ─────────────────────────────────────────────
-- Enable pgvector extension
-- ─────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- Users (authenticated devices)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email STRING NOT NULL,
  display_name STRING NOT NULL,
  auth_method STRING NOT NULL CHECK (auth_method IN ('passkey', 'magic-link')),
  credential_id STRING,
  session_token STRING,
  consent_version STRING,
  consent_accepted_at TIMESTAMPTZ,
  emergency_contact JSONB,
  goals STRING[],
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now(),
  INDEX users_email_idx (email),
  INDEX users_auth_method_idx (auth_method)
);

-- ─────────────────────────────────────────────
-- Auth tokens (magic-link, single-use, short TTL)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email STRING NOT NULL,
  token_hash STRING NOT NULL,
  method STRING NOT NULL DEFAULT 'magic-link' CHECK (method IN ('magic-link')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX auth_tokens_email_idx (email),
  INDEX auth_tokens_hash_idx (token_hash)
);

-- ─────────────────────────────────────────────
-- Memory Nodes (graph vertices)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_nodes (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind STRING NOT NULL CHECK (kind IN ('core', 'transcript')),
  title STRING NOT NULL,
  excerpt STRING,
  tags STRING[],
  weight FLOAT8 CHECK (weight >= 0 AND weight <= 1),
  confidence FLOAT8 CHECK (confidence >= 0 AND confidence <= 1),
  verified BOOL DEFAULT false,
  ref_count INT DEFAULT 0 CHECK (ref_count >= 0),
  last_touched TIMESTAMPTZ,
  x FLOAT8,
  y FLOAT8,
  crisis_flag BOOL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX memory_nodes_user_idx (user_id),
  INDEX memory_nodes_kind_idx (kind),
  INDEX memory_nodes_confidence_idx (confidence),
  INDEX memory_nodes_crisis_idx (crisis_flag),
  INDEX memory_nodes_last_touched_idx (last_touched)
);

-- ─────────────────────────────────────────────
-- Memory Edges (graph relationships)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_edges (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  target STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  label STRING NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX memory_edges_user_idx (user_id),
  INDEX memory_edges_source_idx (source),
  INDEX memory_edges_target_idx (target),
  INDEX memory_edges_label_idx (label),
  -- Prevent duplicate edges (same source-target pair)
  UNIQUE (source, target)
);

-- ─────────────────────────────────────────────
-- Embeddings (vector index for semantic search)
-- ─────────────────────────────────────────────
-- Dimension 1024 = Cohere embed-english-v3 / amazon.titan-embed-text-v2

CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id STRING NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
  embedding vector(1024),
  text_source STRING, -- excerpt, title, atau chat content
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX embeddings_user_idx (user_id),
  INDEX embeddings_node_idx (node_id)
);

-- Vector index untuk semantic search
-- CockroachDB v25.2+ supports CREATE VECTOR INDEX
CREATE VECTOR INDEX IF NOT EXISTS embeddings_vector_idx ON embeddings (embedding);

-- ─────────────────────────────────────────────
-- Sessions (CBT therapy sessions)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title STRING NOT NULL,
  status STRING NOT NULL CHECK (status IN ('extracted', 'pending', 'interrupted')),
  mood INT CHECK (mood >= 0 AND mood <= 10),
  mood_label STRING,
  started_at TIMESTAMPTZ,
  duration_min INT CHECK (duration_min >= 0),
  excerpt STRING,
  thought STRING,
  reframe STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX sessions_user_idx (user_id),
  INDEX sessions_status_idx (status),
  INDEX sessions_started_idx (started_at),
  INDEX sessions_mood_idx (mood)
);

-- ─────────────────────────────────────────────
-- Chat Turns (conversation history)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id STRING REFERENCES sessions(id) ON DELETE SET NULL,
  role STRING NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content STRING NOT NULL,
  tokens_used INT CHECK (tokens_used >= 0),
  injected_memory_ids STRING[],
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX chat_turns_user_idx (user_id),
  INDEX chat_turns_session_idx (session_id),
  INDEX chat_turns_role_idx (role),
  INDEX chat_turns_created_idx (created_at)
);

-- ─────────────────────────────────────────────
-- Audit Events (compliance log)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type STRING NOT NULL CHECK (type IN (
    'CONSENT_GIVEN', 'CRISIS_ENGAGED', 'CRISIS_DISMISSED',
    'SESSION_FINALIZED', 'MEMORY_VERIFIED', 'MEMORY_PURGED',
    'EXPORT_MINTED', 'SESSION_REVOKED', 'HARD_PURGE', 'SIGN_OUT'
  )),
  detail STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX audit_events_user_idx (user_id),
  INDEX audit_events_type_idx (type),
  INDEX audit_events_created_idx (created_at)
);

-- ─────────────────────────────────────────────
-- Views (for common queries)
-- ─────────────────────────────────────────────

-- Active users in last 7 days
CREATE VIEW IF NOT EXISTS active_users_7d AS
SELECT id, email, display_name, last_active
FROM users
WHERE last_active >= now() - INTERVAL '7 days'
ORDER BY last_active DESC;

-- Memory statistics per user
CREATE VIEW IF NOT EXISTS user_memory_stats AS
SELECT
  u.id AS user_id,
  COUNT(DISTINCT mn.id) AS node_count,
  COUNT(DISTINCT me.id) AS edge_count,
  AVG(mn.confidence) AS avg_confidence,
  SUM(mn.ref_count) AS total_ref_count,
  COUNT(DISTINCT ct.id) AS chat_turn_count
FROM users u
LEFT JOIN memory_nodes mn ON mn.user_id = u.id
LEFT JOIN memory_edges me ON me.user_id = u.id
LEFT JOIN chat_turns ct ON ct.user_id = u.id
GROUP BY u.id;

-- Session summary with mood delta
CREATE VIEW IF NOT EXISTS session_summary AS
SELECT
  s.id,
  s.user_id,
  s.title,
  s.status,
  s.mood,
  s.mood_label,
  s.duration_min,
  (SELECT COUNT(*) FROM chat_turns ct WHERE ct.session_id = s.id) AS turn_count
FROM sessions s;
