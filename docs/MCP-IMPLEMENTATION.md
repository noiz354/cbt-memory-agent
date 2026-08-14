# CockroachDB MCP Server — Implementation (WAJIB untuk Hackathon)

> Implementasi lengkap CockroachDB Cloud Managed MCP Server untuk backend Lambda.
> Ini adalah **salah satu dari 2 CockroachDB tools wajib** untuk submission hackathon
> (minimal 2 dari 4: MCP Server + Distributed Vector Indexing).

**Tanggal:** 2026-08-13  
**Status:** ✅ Setup scripts siap dijalankan  
**Hackathon Track:** CockroachDB × AWS

---

## 🎯 APA YANG SUDAH SELESAI

| Deliverable | Status | File |
|---|---|---|
| Schema SQL (7 tables + pgvector + indexes) | ✅ Done | `schema/crdb-schema.sql` |
| MCP setup script | ✅ Ready | `scripts/02-setup-mcp.sh` |
| MCP config template | ✅ Ready | `mcp/mcp-config.json` |
| Query patterns SQL | ✅ Ready | `scripts/04-query-patterns.sql` |
| Connection info script | ✅ Ready | `scripts/05-connection-info.sh` |
| Implementation plan | ✅ Done | `docs/DATABASE-ENGINEER-PLAN.md` |

---

## 📦 TOOLS YANG PERLU DI-INSTALL (BELUM DILAKUKAN)

### Prioritas 1: ccloud CLI (WAJIB)

```bash
# Download & install
curl -fsSL https://binaries.cockroachdb.com/ccloud | bash
sudo mv ccloud /usr/local/bin/
sudo chmod +x /usr/local/bin/ccloud

# Verifikasi
ccloud --version

# Login (headless — device-code flow, tanpa redirect browser)
ccloud auth login --no-redirect
```

### Prioritas 2: jq (JSON processor — untuk scripting)

```bash
sudo apt-get install -y jq
```

### Prioritas 3: CockroachDB SQL CLI (opsional — untuk local testing)

```bash
curl https://binaries.cockroachdb.com/cockroach-v25.1.0.linux-amd64.tgz | tar -xz
sudo cp -i cockroach-v25.1.0.linux-amd64/cockroach /usr/local/bin/
cockroach version
```

---

## 🚀 COMMANDS YANG PERLU DIJALANKAN (URUTAN EKSEKUSI)

### Step 1: Provision Cluster

```bash
cd /home/norman2/14-8-26-aws-x-coachroachdb-merge

# Pastikan sudah login (headless — device-code)
ccloud auth login --no-redirect

# Run provisioning script
bash scripts/01-provision-cluster.sh

# Verify cluster running
ccloud cluster ls
```

### Step 2: Setup MCP Server

```bash
# Run MCP setup script
bash scripts/02-setup-mcp.sh

# Verify MCP endpoint
cat mcp/mcp-config.json
```

### Step 3: Apply Schema

```bash
# Apply schema ke cluster
bash scripts/03-apply-schema.sh

# Verify tables
ccloud sql --cluster woozy-grivet -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

### Step 4: Setup Vector Indexing

```bash
# Verify vector index
bash scripts/04-setup-vector-index.sh

# Test vector query syntax (akan return 0 rows karena belum ada data)
ccloud sql --cluster woozy-grivet -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'embeddings' AND column_name = 'embedding';"
```

### Step 5: Extract Connection Info untuk Lambda

```bash
# Get connection details
bash scripts/05-connection-info.sh

# Simpan output untuk Lambda environment variables
# CRDB_HOST=...
# CRDB_PORT=...
# CRDB_DATABASE=...
# CRDB_SSL_MODE=verify-full
```

---

## 🔌 MCP SERVER CONFIG (SUDAH SIAP)

### File: `mcp/mcp-config.json`

```json
{
  "mcpServers": {
    "cockroachdb": {
      "url": "https://cockroachlabs.cloud/mcp",
      "cluster": "woozy-grivet",
      "mode": "read-write",
      "tools": [
        "search_memory",
        "get_profile",
        "add_chunk",
        "promote_to_core",
        "get_event_log"
      ]
    }
  }
}
```

### MCP Tools yang Akan Diekspose ke Backend Lambda

| Tool | Fungsi | Signature |
|---|---|---|
| `search_memory` | Semantic search via vector similarity | `(query_embedding: vector, top_k: int, user_id: string) → MemoryUnit[]` |
| `get_profile` | Get compressed user profile | `(user_id: string) → ProfileDigest` |
| `add_chunk` | Add transcript chunk dengan embedding | `(user_id, session_id, text, embedding, unit_json) → chunk_id` |
| `promote_to_core` | Promote chunk ke core memories | `(chunk_id, user_id) → unit_id` |
| `get_event_log` | Get audit events | `(user_id, limit: int) → EventLog[]` |

---

## 💻 LAMBDA INTEGRATION CODE (BELUM DIBUAT)

### File yang perlu dibuat: `lambda/lib/crdb-mcp.ts`

```typescript
// MCP client untuk Lambda → CockroachDB
import { McpClient } from '@modelcontextprotocol/sdk/client';

const MCP_URL = process.env.CRDB_MCP_URL || 'https://cockroachlabs.cloud/mcp';

let mcpClient: McpClient | null = null;

export async function getMcpClient(): Promise<McpClient> {
  if (!mcpClient) {
    mcpClient = new McpClient({
      url: MCP_URL,
      cluster: process.env.CRDB_CLUSTER || 'woozy-grivet',
    });
    await mcpClient.connect();
  }
  return mcpClient;
}

export async function searchMemory(
  queryEmbedding: number[],
  topK: number = 5,
  userId: string
) {
  const client = await getMcpClient();
  return client.callTool('search_memory', {
    query_embedding: queryEmbedding,
    top_k: topK,
    user_id: userId,
  });
}

export async function getProfile(userId: string) {
  const client = await getMcpClient();
  return client.callTool('get_profile', { user_id: userId });
}

export async function addChunk(params: {
  user_id: string;
  session_id: string;
  text: string;
  embedding: number[];
  unit_json: object;
}) {
  const client = await getMcpClient();
  return client.callTool('add_chunk', params);
}

export async function promoteToCore(chunkId: string, userId: string) {
  const client = await getMcpClient();
  return client.callTool('promote_to_core', {
    chunk_id: chunkId,
    user_id: userId,
  });
}

export async function getEventLog(userId: string, limit: number = 50) {
  const client = await getMcpClient();
  return client.callTool('get_event_log', { user_id: userId, limit });
}
```

---

## 📊 QUERY PATTERNS (SUDAH SIAP)

### File: `scripts/04-query-patterns.sql`

Berisi 10 SQL patterns yang akan digunakan via MCP:

1. **Memory Decay** — SQL UPDATE (bukan Python loop)
2. **Vector Similarity Search** — RAG via cosine_distance()
3. **Promotion** — Reference-gated (threshold 0.60)
4. **Recall Ranking** — score = 0.7·cosine + 0.3·criticality
5. **Profile Digest** — Compressed user model
6. **Increment Reference** — HANYA untuk top-k units
7. **Memory CRUD** — Upsert/delete nodes & edges
8. **Hard Purge** — Irreversible delete all user data
9. **Audit Logging** — Compliance events
10. **Session Management** — Save/list sessions

---

## ✅ VERIFICATION CHECKLIST (BELUM DILAKUKAN)

Setelah semua commands dijalankan, verifikasi:

```bash
# 1. Cluster running
ccloud cluster ls
# Expected: woozy-grivet | aws us-east-1 | active

# 2. MCP Server running
ccloud mcp ls --cluster woozy-grivet
# Expected: cbt-memory-mcp | read-write | active

# 3. Tables created (7 tables)
ccloud sql --cluster woozy-grivet -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
# Expected: 7

# 4. pgvector extension enabled
ccloud sql --cluster woozy-grivet -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
# Expected: vector

# 5. Indexes created (20+ indexes)
ccloud sql --cluster woozy-grivet -c "SELECT count(*) FROM crdb_internal.table_indexes WHERE schema_name = 'public';"
# Expected: 20+

# 6. Vector index working
ccloud sql --cluster woozy-grivet -c "SELECT index_name FROM crdb_internal.table_indexes WHERE table_name = 'embeddings' AND index_name LIKE '%vector%';"
# Expected: embeddings_vector_idx

# 7. MCP tools accessible
# Test via Claude Code atau Cursor dengan mcp-config.json

# 8. Connection test dari Lambda
# Deploy Lambda dengan CRDB_MCP_URL env var
# Test: curl $LAMBDA_URL/api/v1/health
# Expected: {"status": "ok", "crdb": "connected", ...}
```

---

## 🚧 PEKERJAAN YANG BELUM SELESAI

### 1. Install ccloud CLI (DI MACHINE ANDA)

**Status:** ⏳ Belum dilakukan  
**Action:** Jalankan commands di section "TOOLS YANG PERLU DI-INSTALL"  
**Estimasi:** 5 menit

### 2. Provision CockroachDB Cluster

**Status:** ⏳ Script ready, belum dijalankan  
**Action:** `bash scripts/01-provision-cluster.sh`  
**Estimasi:** 3 menit (setelah ccloud CLI ter-install)

### 3. Setup MCP Server

**Status:** ⏳ Script ready, belum dijalankan  
**Action:** `bash scripts/02-setup-mcp.sh`  
**Estimasi:** 2 menit

### 4. Apply Schema ke Cluster

**Status:** ⏳ Script ready, belum dijalankan  
**Action:** `bash scripts/03-apply-schema.sh`  
**Estimasi:** 2 menit

### 5. Setup Vector Indexing

**Status:** ⏳ Script ready, belum dijalankan  
**Action:** `bash scripts/04-setup-vector-index.sh`  
**Estimasi:** 2 menit

### 6. Extract Connection Info untuk Lambda

**Status:** ⏳ Script ready, belum dijalankan  
**Action:** `bash scripts/05-connection-info.sh`  
**Estimasi:** 5 menit

### 7. Buat Lambda MCP Client (`lambda/lib/crdb-mcp.ts`)

**Status:** ⏳ Code template ready di file ini, belum dibuat  
**Action:** Copy code template ke `lambda/lib/crdb-mcp.ts`  
**Estimasi:** 5 menit

### 8. Test MCP End-to-End

**Status:** ⏳ Belum ada cluster/MCP running  
**Action:** Setelah cluster + MCP running, test semua 5 tools  
**Estimasi:** 15 menit

### 9. Setup CI/CD untuk Schema Deployment

**Status:** ⏳ Workflow template ready, belum di-commit  
**Action:** `cp .github/workflows/crdb-deploy.yml` → commit + push  
**Estimasi:** 10 menit

---

## 📋 TOTAL ESTIMASI SISA PEKERJAAN

| Task | Estimasi | Dependencies |
|---|---|---|
| Install ccloud CLI | 5 menit | - |
| Provision cluster | 3 menit | ccloud CLI installed |
| Setup MCP Server | 2 menit | Cluster running |
| Apply schema | 2 menit | Cluster running |
| Setup vector index | 2 menit | Schema applied |
| Extract connection info | 5 menit | Cluster running |
| Buat Lambda MCP client | 5 menit | - |
| Test MCP end-to-end | 15 menit | Semua di atas done |
| Setup CI/CD | 10 menit | GitHub repo access |
| **TOTAL** | **~49 menit** | |

---

## 🎯 NEXT STEPS (URUTAN PRIORITAS)

1. **Install ccloud CLI** → `curl -fsSL https://binaries.cockroachdb.com/ccloud | bash`
2. **Login** → `ccloud auth login --no-redirect`
3. **Provision cluster** → `bash scripts/01-provision-cluster.sh`
4. **Setup MCP** → `bash scripts/02-setup-mcp.sh`
5. **Apply schema** → `bash scripts/03-apply-schema.sh`
6. **Test connection** → `bash scripts/05-connection-info.sh`

Setelah cluster + MCP running, baru buat Lambda integration code (`lambda/lib/crdb-mcp.ts`).

---

## 📚 DOKUMENTASI TERKAIT

- `docs/DATABASE-ENGINEER-PLAN.md` — Rencana lengkap semua deliverables
- `schema/crdb-schema.sql` — Schema SQL (sudah ada)
- `scripts/04-query-patterns.sql` — Query patterns (sudah ada)
- `mcp/mcp-config.json` — MCP config (sudah ada)
