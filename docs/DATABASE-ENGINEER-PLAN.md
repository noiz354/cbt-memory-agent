# Database Engineer — CockroachDB Implementation Plan

> Rencana lengkap untuk semua deliverables Database Engineer dalam hackathon CockroachDB × AWS.
> Dokumen ini berisi **langkah-langkah eksekusi** + **command yang perlu dijalankan** untuk setup,
> deploy, dan verify CockroachDB sebagai persistent memory layer.

**Tanggal:** 2026-08-13  
**Owner:** Database Engineer (CockroachDB Specialist)  
**Target:** Semua deliverables selesai → backend bisa connect & query

---

## 📋 DELIVERABLES CHECKLIST

| # | Deliverable | Status | File Output |
|---|---|---|---|
| 1 | CockroachDB Cluster Provisioning | ⏳ Pending | `scripts/01-provision-cluster.sh` |
| 2 | Schema SQL (7 tables + pgvector + indexes) | ✅ Done | `schema/crdb-schema.sql` |
| 3 | CockroachDB MCP Server Setup | ⏳ Pending | `scripts/02-setup-mcp.sh` + `mcp/mcp-config.json` |
| 4 | Distributed Vector Indexing | ⏳ Pending | `scripts/03-setup-vector-index.sh` |
| 5 | Connection Patterns (decay, promote, recall) | ⏳ Pending | `scripts/04-query-patterns.sql` |
| 6 | ccloud CLI CI/CD Automation | ⏳ Pending | `.github/workflows/crdb-deploy.yml` |

---

## 🛠️ TOOLS YANG PERLU DI-INSTALL

### 1. ccloud CLI (WAJIB)

**Untuk:** Provisioning cluster, manage database, setup MCP server

```bash
# Install via Homebrew (Linux/macOS)
brew install cockroachdb/tap/ccloud

# Verifikasi
ccloud --version

# Login (akan buka browser untuk OAuth)
ccloud auth login

# Cek cluster yang sudah ada
ccloud cluster ls
```

**Alternatif jika brew tidak tersedia:**

```bash
# Option A: Install via Go (jika Go ter-install)
go install github.com/cockroachdb/ccloud-cli/cmd/ccloud@latest

# Option B: Download binary dari GitHub Releases
# Kunjungi: https://github.com/cockroachdb/ccloud/releases
# Download versi terbaru untuk linux-amd64
```

### 2. CockroachDB SQL CLI (untuk testing lokal)

**Untuk:** Run schema migration, query testing

```bash
# Install CockroachDB binary (untuk sql client)
curl https://binaries.cockroachdb.com/cockroach-v25.1.0.linux-amd64.tgz | tar -xz
sudo cp -i cockroach-v25.1.0.linux-amd64/cockroach /usr/local/bin/
cockroach version
```

### 3. jq (JSON processor — untuk scripting)

```bash
sudo apt-get install -y jq
# atau
brew install jq
```

### 4. PostgreSQL client (opsional — untuk local testing)

```bash
sudo apt-get install -y postgresql-client
# atau
brew install libpq
```

---

## 📦 STEP 1: Provision CockroachDB Cluster

### File yang akan dibuat: `scripts/01-provision-cluster.sh`

```bash
#!/usr/bin/env bash
# Provision CockroachDB Serverless cluster di AWS us-east-1
# Usage: bash scripts/01-provision-cluster.sh

set -euo pipefail

CLUSTER_NAME="woozy-grivet"
CLOUD_PROVIDER="aws"
REGION="us-east-1"
SPEND_LIMIT="0.00"  # WAJIB $0 untuk free tier hackathon

echo "🪳 Creating CockroachDB Serverless cluster..."
echo "   Name: $CLUSTER_NAME"
echo "   Cloud: $CLOUD_PROVIDER"
echo "   Region: $REGION"
echo "   Spend Limit: \$${SPEND_LIMIT}/month"

# 1. Create cluster
ccloud cluster create \
  --name "$CLUSTER_NAME" \
  --cloud "$CLOUD_PROVIDER" \
  --region "$REGION" \
  --spend-limit "$SPEND_LIMIT" \
  --wait

echo "✅ Cluster created!"

# 2. Get connection string
echo ""
echo "📡 Getting connection string..."
CONN_STRING=$(ccloud cluster sql-url --cluster "$CLUSTER_NAME")
echo "   Connection: $CONN_STRING"

# 3. Get CA certificate
echo ""
echo "🔐 Downloading CA certificate..."
mkdir -p certs
ccloud cluster ca-cert --cluster "$CLUSTER_NAME" > certs/crdb-ca.crt

echo ""
echo "🎉 Cluster ready!"
echo "   Next step: bash scripts/02-setup-mcp.sh"
```

### Command untuk eksekusi:

```bash
# 1. Pastikan sudah login
ccloud auth login

# 2. Run script provisioning
cd /home/norman2/14-8-26-aws-x-coachroachdb-merge
bash scripts/01-provision-cluster.sh

# 3. Verifikasi cluster running
ccloud cluster ls
ccloud cluster sql-url --cluster woozy-grivet
```

---

## 🔌 STEP 2: Setup CockroachDB MCP Server

### File yang akan dibuat: `scripts/02-setup-mcp.sh`

```bash
#!/usr/bin/env bash
# Setup CockroachDB Cloud Managed MCP Server
# Usage: bash scripts/02-setup-mcp.sh

set -euo pipefail

CLUSTER_NAME="woozy-grivet"
MCP_NAME="cbt-memory-mcp"

echo "🔌 Setting up CockroachDB MCP Server..."

# 1. Enable MCP pada cluster
ccloud mcp create \
  --cluster "$CLUSTER_NAME" \
  --name "$MCP_NAME" \
  --mode read-write

echo "✅ MCP Server created!"

# 2. Get MCP endpoint
MCP_URL=$(ccloud mcp describe --cluster "$CLUSTER_NAME" --name "$MCP_NAME" -o json | jq -r '.endpoint')
echo "   MCP Endpoint: $MCP_URL"

# 3. Generate MCP config untuk Claude Code / Cursor
cat > mcp/mcp-config.json <<EOF
{
  "mcpServers": {
    "cockroachdb": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-remote", "$MCP_URL"],
      "env": {
        "CLUSTER_NAME": "$CLUSTER_NAME"
      }
    }
  }
}
EOF

echo ""
echo "📝 MCP config written to mcp/mcp-config.json"
echo "   Next step: bash scripts/03-apply-schema.sh"
```

### Command untuk eksekusi:

```bash
# Run MCP setup
bash scripts/02-setup-mcp.sh

# Verify MCP endpoint
cat mcp/mcp-config.json

# Test MCP connection (jika Claude Code ter-install)
claude mcp list
```

---

## 📊 STEP 3: Apply Schema (7 Tables + Indexes + pgvector)

### File yang akan dibuat: `scripts/03-apply-schema.sh`

```bash
#!/usr/bin/env bash
# Apply schema ke CockroachDB cluster
# Usage: bash scripts/03-apply-schema.sh

set -euo pipefail

CLUSTER_NAME="woozy-grivet"
SCHEMA_FILE="schema/crdb-schema.sql"

echo "📊 Applying schema to CockroachDB cluster..."

# 1. Get SQL connection string
SQL_URL=$(ccloud cluster sql-url --cluster "$CLUSTER_NAME")

# 2. Apply schema
echo "   Running: $SCHEMA_FILE"
ccloud sql --cluster "$CLUSTER_NAME" -f "$SCHEMA_FILE"

echo "✅ Schema applied!"

# 3. Verify tables
echo ""
echo "🔍 Verifying tables..."
ccloud sql --cluster "$CLUSTER_NAME" -c "
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name;
"

# 4. Verify indexes
echo ""
echo "📋 Verifying indexes..."
ccloud sql --cluster "$CLUSTER_NAME" -c "
  SELECT table_name, index_name 
  FROM crdb_internal.table_indexes 
  WHERE schema_name = 'public' 
  ORDER BY table_name, index_name;
"

# 5. Verify pgvector extension
echo ""
echo "🧩 Verifying pgvector extension..."
ccloud sql --cluster "$CLUSTER_NAME" -c "
  SELECT extname, extversion 
  FROM pg_extension 
  WHERE extname = 'vector';
"

echo ""
echo "🎉 Schema ready!"
echo "   Next step: bash scripts/04-setup-vector-index.sh"
```

### Command untuk eksekusi:

```bash
# Run schema apply
bash scripts/03-apply-schema.sh

# Manual verify
ccloud sql --cluster woozy-grivet -c "SELECT * FROM information_schema.tables WHERE table_schema = 'public';"
```

---

## 🎯 STEP 4: Setup Distributed Vector Indexing

### File yang akan dibuat: `scripts/04-setup-vector-index.sh`

```bash
#!/usr/bin/env bash
# Setup & verify Distributed Vector Indexing
# Usage: bash scripts/04-setup-vector-index.sh

set -euo pipefail

CLUSTER_NAME="woozy-grivet"

echo "🎯 Setting up Distributed Vector Indexing..."

# 1. Verify vector column exists
echo "   Checking embeddings table..."
ccloud sql --cluster "$CLUSTER_NAME" -c "
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'embeddings' AND column_name = 'embedding';
"

# 2. Verify IVFFLAT index
echo ""
echo "   Checking IVFFLAT index..."
ccloud sql --cluster "$CLUSTER_NAME" -c "
  SELECT index_name, index_type 
  FROM crdb_internal.table_indexes 
  WHERE table_name = 'embeddings' AND index_name = 'embeddings_vector_idx';
"

# 3. Test vector similarity query (dry run — no data yet)
echo ""
echo "   Testing vector query syntax..."
ccloud sql --cluster "$CLUSTER_NAME" -c "
  SELECT 
    'vector_cosine_ops' AS index_opclass,
    1024 AS vector_dimension,
    'ivfflat' AS index_type
  FROM embeddings 
  LIMIT 0;
"

# 4. Show index tuning recommendations
echo ""
echo "📐 Index tuning recommendations:"
echo "   - num_lists = 100 (untuk < 100K vectors)"
echo "   - num_lists = 1000 (untuk 100K-1M vectors)"
echo "   - Gunakan cosine_distance() untuk similarity search"
echo "   - Query: ORDER BY embedding <=> '[...vector...]' LIMIT k"

echo ""
echo "🎉 Vector indexing ready!"
```

### Command untuk test vector query:

```bash
# Test cosine similarity query (setelah ada data)
ccloud sql --cluster woozy-grivet -c "
  SELECT 
    node_id, 
    text_source,
    1 - (embedding <=> '[0.1, 0.2, ...1024 dims...]'::vector(1024)) AS similarity
  FROM embeddings
  WHERE user_id = 'user-test-uuid'
  ORDER BY embedding <=> '[0.1, 0.2, ...1024 dims...]'::vector(1024)
  LIMIT 5;
"
```

---

## 💾 STEP 5: Query Patterns (Decay, Promote, Recall)

### File yang akan dibuat: `scripts/04-query-patterns.sql`

File ini berisi semua SQL query patterns yang dibutuhkan Memory Agent:

```sql
-- ─────────────────────────────────────────────
-- QUERY PATTERNS untuk CBT Memory Agent
-- CockroachDB native (SQL UPDATE, bukan Python loop)
-- ─────────────────────────────────────────────

-- 1. MEMORY DECAY (session-ordinal based)
-- weight = max(0, 1 - slope * (age - window + 1))
-- DECAY_WINDOW=1, DECAY_SLOPE=0.5
-- age 0 → 1.0 | age 1 → 0.5 | age 2 → 0.0 (forgotten)

UPDATE transcript_chunks
SET weight = GREATEST(0, 1 - 0.5 * (
  (SELECT ord FROM session_order WHERE session_id = s.session_id)
  - (SELECT MIN(ord) FROM session_order WHERE user_id = s.user_id)
))
FROM session_order s 
WHERE transcript_chunks.session_id = s.session_id
  AND transcript_chunks.user_id = $1;

-- 2. VECTOR SIMILARITY SEARCH (RAG)
-- Gunakan cosine_distance() — built-in CockroachDB pgvector function

SELECT 
  chunk_id,
  text,
  weight,
  1 - cosine_distance(embedding, $2::vector(1024)) AS similarity
FROM transcript_chunks
WHERE user_id = $1
  AND weight >= 0.05  -- TIER1_EXCLUDE_BELOW
ORDER BY embedding <=> $2::vector(1024)
LIMIT 5;

-- 3. PROMOTION (reference-gated)
-- PROMOTE_SIM_THRESHOLD = 0.60 → cosine_distance <= 0.40

SELECT chunk_id 
FROM transcript_chunks
WHERE user_id = $1
  AND cosine_distance(embedding, $2::vector(1024)) <= 0.40
  AND weight >= 0.05
ORDER BY embedding <=> $2::vector(1024) 
LIMIT 5;

-- 4. RECALL RANKING (core memories)
-- score = 0.70 * cosine + 0.30 * criticality
-- criticality = 0.5*crisis + 0.3*normalized_refs + 0.2*milestone

SELECT 
  unit_id,
  unit_json,
  reference_count,
  0.70 * (1 - cosine_distance(embedding, $2::vector(1024))) + 
  0.30 * (
    0.5 * (unit_json->>'risk_indicators'->>'crisis_triggered')::int +
    0.3 * LEAST(reference_count, 5) / 5.0 +
    0.2 * ((unit_json->>'progress_tracking'->>'user_milestone') IS NOT NULL)::int
  ) AS recall_score
FROM core_memories
WHERE user_id = $1
ORDER BY recall_score DESC
LIMIT 2;

-- 5. PROFILE DIGEST (compressed user model)

SELECT json_build_object(
  'total_sessions', (SELECT COUNT(*) FROM sessions WHERE user_id = $1),
  'total_memories', (SELECT COUNT(*) FROM memory_nodes WHERE user_id = $1),
  'crisis_count', (SELECT COUNT(*) FROM audit_events WHERE user_id = $1 AND type = 'CRISIS_ENGAGED'),
  'avg_mood', (SELECT AVG(mood) FROM sessions WHERE user_id = $1 AND mood IS NOT NULL),
  'last_active', (SELECT MAX(created_at) FROM chat_turns WHERE user_id = $1)
) AS profile_digest;

-- 6. INCREMENT REFERENCE (HANYA untuk top-k units)

UPDATE core_memories
SET reference_count = reference_count + 1
WHERE unit_id = ANY($1::uuid[])
  AND user_id = $2;

-- 7. MEMORY CRUD OPERATIONS

-- Upsert memory node
INSERT INTO memory_nodes (id, user_id, kind, title, excerpt, tags, weight, confidence, x, y)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  excerpt = EXCLUDED.excerpt,
  tags = EXCLUDED.tags,
  weight = EXCLUDED.weight,
  confidence = EXCLUDED.confidence,
  x = EXCLUDED.x,
  y = EXCLUDED.y,
  last_touched = now();

-- Upsert memory edge (prevent duplicates via UNIQUE constraint)
INSERT INTO memory_edges (id, user_id, source, target, label)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (source, target) DO UPDATE SET
  label = EXCLUDED.label;

-- Delete memory (CASCADE ke edges + embeddings)
DELETE FROM memory_nodes WHERE id = $1 AND user_id = $2;

-- 8. HARD PURGE (irreversible — delete all user data)

DELETE FROM users WHERE id = $1;
-- CASCADE akan delete: memory_nodes, memory_edges, embeddings, sessions, chat_turns, audit_events

-- 9. AUDIT LOGGING

INSERT INTO audit_events (user_id, type, detail)
VALUES ($1, $2, $3);

-- 10. SESSION MANAGEMENT

-- Save session
INSERT INTO sessions (id, user_id, title, status, mood, mood_label, started_at, duration_min, excerpt, thought, reframe)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  mood = EXCLUDED.mood,
  mood_label = EXCLUDED.mood_label,
  duration_min = EXCLUDED.duration_min,
  excerpt = EXCLUDED.excerpt,
  thought = EXCLUDED.thought,
  reframe = EXCLUDED.reframe;

-- List sessions
SELECT id, title, status, mood, mood_label, started_at, duration_min, excerpt
FROM sessions
WHERE user_id = $1
ORDER BY started_at DESC
LIMIT 50;
```

### Command untuk test query patterns:

```bash
# Test semua query patterns (setelah ada data)
ccloud sql --cluster woozy-grivet -f scripts/04-query-patterns.sql

# Test individual query
ccloud sql --cluster woozy-grivet -c "SELECT * FROM user_memory_stats;"
```

---

## 🔗 STEP 6: Connection Strategy (Lambda-safe)

### File yang akan dibuat: `scripts/05-connection-info.sh`

```bash
#!/usr/bin/env bash
# Extract connection info untuk Lambda environment variables
# Usage: bash scripts/05-connection-info.sh

set -euo pipefail

CLUSTER_NAME="woozy-grivet"

echo "🔗 Extracting connection info for Lambda..."

# 1. Get connection string
CONN_URL=$(ccloud cluster sql-url --cluster "$CLUSTER_NAME")

# 2. Parse components
HOST=$(echo "$CONN_URL" | sed -n 's|.*//\([^:]*\):.*|\1|p')
PORT=$(echo "$CONN_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DBNAME=$(echo "$CONN_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

echo "Host:     $HOST"
echo "Port:     $PORT"
echo "Database: $DBNAME"
echo "SSL Mode: verify-full"

# 3. Get CA cert
echo ""
echo "🔐 CA Certificate:"
ccloud cluster ca-cert --cluster "$CLUSTER_NAME"

# 4. Export untuk Lambda environment variables
echo ""
echo "📤 Lambda Environment Variables:"
echo "   CRDB_HOST=$HOST"
echo "   CRDB_PORT=$PORT"
echo "   CRDB_DATABASE=$DBNAME"
echo "   CRDB_SSL_MODE=verify-full"
echo "   CRDB_SSL_CERT=/tmp/crdb-ca.crt  # Download dari ccloud cluster ca-cert"
```

### Connection string format untuk Lambda:

```typescript
// lambda/lib/crdb.ts
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.CRDB_HOST,
  port: parseInt(process.env.CRDB_PORT || '26257'),
  database: process.env.CRDB_DATABASE || 'defaultdb',
  user: process.env.CRDB_USER || 'defaultdb',
  password: process.env.CRDB_PASSWORD,
  ssl: {
    ca: fs.readFileSync('/tmp/crdb-ca.crt').toString(),
    rejectUnauthorized: true,
  },
  // Pool settings — hemat RU
  min: 1,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

---

## 🚀 STEP 7: CI/CD Automation (ccloud CLI)

### File yang akan dibuat: `.github/workflows/crdb-deploy.yml`

```yaml
name: Deploy CockroachDB Schema

on:
  push:
    branches: [main]
    paths:
      - 'schema/**/*.sql'
      - 'scripts/**/*.sh'

jobs:
  deploy-schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install ccloud CLI
        run: |
          curl -fsSL https://binaries.cockroachdb.com/ccloud | bash
          sudo mv ccloud /usr/local/bin/

      - name: Authenticate with CockroachDB Cloud
        run: |
          # CI bersifat non-interaktif → pakai REST API v1 (bukan device-code).
          # Script berikut exit 0 bila CCLOUD_API_KEY valid (setup secrets di GitHub).
          bash scripts/ccloud-auth.sh api --quiet
          ccloud cluster ls

      - name: Apply schema migrations
        run: |
          ccloud sql --cluster woozy-grivet -f schema/crdb-schema.sql

      - name: Verify deployment
        run: |
          ccloud sql --cluster woozy-grivet -c "
            SELECT table_name, creation_time 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name;
          "

      - name: Update MCP Server
        run: |
          ccloud mcp sync --cluster woozy-grivet
```

### Secrets yang perlu ditambahkan ke GitHub:

```bash
# Di GitHub repo → Settings → Secrets → Actions
CCLOUD_API_KEY=<api-key-dari-cockroachdb-cloud>
CRDB_CONNECTION_STRING=<connection-string-dari-ccloud>
```

---

## ✅ VERIFICATION CHECKLIST

Setelah semua script dijalankan, verifikasi:

```bash
# 1. Cluster running
ccloud cluster ls
# Expected: woozy-grivet | aws us-east-1 | active

# 2. MCP Server running
ccloud mcp ls --cluster woozy-grivet
# Expected: cbt-memory-mcp | read-write | active

# 3. Tables created
ccloud sql --cluster woozy-grivet -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
# Expected: 7 (users, memory_nodes, memory_edges, embeddings, sessions, chat_turns, audit_events)

# 4. pgvector extension enabled
ccloud sql --cluster woozy-grivet -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
# Expected: vector

# 5. Indexes created
ccloud sql --cluster woozy-grivet -c "SELECT count(*) FROM crdb_internal.table_indexes WHERE schema_name = 'public';"
# Expected: 20+ indexes

# 6. Vector index working
ccloud sql --cluster woozy-grivet -c "SELECT index_name FROM crdb_internal.table_indexes WHERE table_name = 'embeddings' AND index_name LIKE '%vector%';"
# Expected: embeddings_vector_idx

# 7. Connection test dari local
cockroach sql --url "$(ccloud cluster sql-url --cluster woozy-grivet)" -c "SELECT 1;"
# Expected: 1 row

# 8. Views working
ccloud sql --cluster woozy-grivet -c "SELECT * FROM user_memory_stats LIMIT 1;"
# Expected: empty result (belum ada data) tapi query berhasil
```

---

## 🎯 SUMMARY: Files yang Akan Dibuat

| File | Tujuan | Status |
|---|---|---|
| `scripts/01-provision-cluster.sh` | Provision CRDB cluster | ⏳ |
| `scripts/02-setup-mcp.sh` | Setup MCP Server | ⏳ |
| `scripts/03-apply-schema.sh` | Apply schema SQL | ⏳ |
| `scripts/04-setup-vector-index.sh` | Verify vector indexing | ⏳ |
| `scripts/04-query-patterns.sql` | SQL patterns (decay, promote, recall, CRUD) | ⏳ |
| `scripts/05-connection-info.sh` | Extract Lambda env vars | ⏳ |
| `.github/workflows/crdb-deploy.yml` | CI/CD schema deployment | ⏳ |
| `mcp/mcp-config.json` | MCP config untuk Claude/Cursor | ⏳ |

**Total: 8 files baru**

---

## 📚 SKILLS YANG AKAN DIGUNAKAN

Semua skills sudah ter-install di `.agents/skills/`:

| Skill | Dipakai Untuk |
|---|---|
| `cockroachdb-sql` | Schema design best practices |
| `analyzing-range-distribution` | Vector index tuning (num_lists) |
| `designing-application-transactions` | Memory CRUD ON CONFLICT patterns |
| `profiling-statement-fingerprints` | Query optimization |
| `configuring-private-connectivity` | Lambda → CRDB SSL connection |
| `managing-cluster-capacity` | RU estimation & monitoring |
| `configuring-audit-logging` | Audit events compliance |
| `provisioning-cluster-for-production` | Cluster setup checklist |

---

## ⏱️ ESTIMASI WAKTU

| Step | Durasi | Dependencies |
|---|---|---|
| Install ccloud CLI | 5 menit | - |
| Provision cluster | 3 menit | ccloud auth |
| Setup MCP Server | 2 menit | Cluster running |
| Apply schema | 2 menit | Cluster + MCP |
| Setup vector index | 2 menit | Schema applied |
| Query patterns | 10 menit | Schema applied |
| Connection info | 5 menit | Cluster running |
| CI/CD setup | 10 menit | GitHub repo access |
| **TOTAL** | **~40 menit** | |

---

**Next Action:** Jalankan `bash scripts/01-provision-cluster.sh` setelah ccloud CLI ter-install.
