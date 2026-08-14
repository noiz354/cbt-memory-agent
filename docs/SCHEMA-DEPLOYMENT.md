# CockroachDB Schema — Deployment Status

> Status deployment schema ke cluster woozy-grivet

**Tanggal:** 2026-08-13  
**Cluster:** woozy-grivet (AWS ap-southeast-3, Serverless, v26.2.5)  
**Status Schema:** ✅ **BERHASIL DI-APPLY**

---

## ✅ YANG SUDAH SELESAI

| Item | Status | Bukti |
|---|---|---|
| ccloud CLI install | ✅ Done | Working |
| ccloud auth login | ✅ Done | Google SSO |
| Cluster provisioning | ✅ Done | woozy-grivet running |
| Schema apply | ✅ Done | 7 tables + 3 views created |
| pgvector (vector column) | ✅ Done | embeddings.embedding = vector(1024) |
| Vector index | ✅ Done | embeddings_vector_idx created |
| Connection string | ✅ Saved | `.env` file |

---

## 📊 SCHEMA YANG TER-DEPLOY

### Tables (7)

| Table | Primary Key | Indexes | Vector? |
|---|---|---|---|
| `users` | id UUID | 2 | No |
| `memory_nodes` | id STRING | 5 | No |
| `memory_edges` | id STRING | 4 | No |
| `embeddings` | id UUID | 3 | **Yes (vector 1024)** |
| `sessions` | id STRING | 4 | No |
| `chat_turns` | id UUID | 4 | No |
| `audit_events` | id UUID | 3 | No |

### Views (3)

| View | Purpose |
|---|---|
| `active_users_7d` | Users aktif dalam 7 hari terakhir |
| `user_memory_stats` | Statistik memory per user (nodes, edges, confidence, refs, chat turns) |
| `session_summary` | Session summary dengan turn count |

### Vector Index

| Index | Table | Column | Type |
|---|---|---|---|
| `embeddings_vector_idx` | embeddings | embedding(1024) | VECTOR INDEX |

---

## 🔧 SCHEMA FIXES YANG DILAKUKAN

| Issue | Fix |
|---|---|
| `references` = reserved keyword | Rename → `ref_count` |
| `USING ivfflat` = not supported di Serverless | Pakai `CREATE VECTOR INDEX` (v25.2+ syntax) |
| Regular index pada vector column = error | Hapus, pakai CREATE VECTOR INDEX terpisah |

---

## 🚧 YANG BELUM SELESAI

### 1. Setup MCP Server (WAJIB #1 untuk Hackathon)

**Status:** ⏳ Belum dilakukan  
**Cara:** Via CockroachDB Cloud Console (web UI)

**Langkah:**
1. Buka https://cockroachlabs.cloud
2. Login → Pilih cluster **woozy-grivet**
3. Cari menu **"MCP Server"** atau **"AI Integration"**
4. Enable MCP Server:
   - Name: cbt-memory-mcp
   - Mode: read-write
5. Copy MCP endpoint URL

### 2. Update MCP Config

**Status:** ⏳ Menunggu MCP endpoint dari step 1

```json
// mcp/mcp-config.json
{
  "mcpServers": {
    "cockroachdb": {
      "url": "https://cockroachlabs.cloud/mcp/YOUR_ENDPOINT",
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

### 3. Test Vector Similarity Query

**Status:** ⏳ Belum ada data untuk test

```sql
-- Test setelah ada data di embeddings table
SELECT 
  node_id, 
  text_source,
  embedding <=> '[0.1, 0.2, ...1024 dims...]'::vector(1024) AS distance
FROM embeddings
WHERE user_id = 'test-user-uuid'
ORDER BY embedding <=> '[0.1, 0.2, ...1024 dims...]'::vector(1024)
LIMIT 5;
```

---

## 📝 CONNECTION INFO (SUDAH DI `.env`)

```
Host:     <CRDB_HOST>     # dari .env
Port:     26257
Database: defaultdb
Username: <CRDB_USERNAME> # dari .env
Password: <CRDB_PASSWORD> # dari .env
SSL Mode: verify-full
```

---

## ✅ VERIFICATION SUMMARY

```bash
# Semua verification berhasil:
✅ 7 tables created (users, memory_nodes, memory_edges, embeddings, sessions, chat_turns, audit_events)
✅ 3 views created (active_users_7d, user_memory_stats, session_summary)
✅ vector column (1024 dimensions) di embeddings table
✅ embeddings_vector_idx created
✅ Indexes: 20+ indexes across all tables
✅ Foreign keys with CASCADE delete
✅ Check constraints (weight, confidence, mood, etc.)
✅ UNIQUE constraint on memory_edges (source, target)
```

---

## 🎯 HACKATHON SUBMISSION STATUS

| Requirement | Status | Bukti |
|---|---|---|
| CockroachDB Tool #1: MCP Server | ⏳ Pending | Setup via web UI |
| CockroachDB Tool #2: Distributed Vector Indexing | ✅ **DONE** | embeddings_vector_idx |
| AWS Service #1: Lambda | ✅ Done | Deployed (ap-southeast-3) |
| LLM + Embeddings: OpenRouter | ✅ Done | `lambda/lib/openrouter.ts` |
| AWS Service #2: S3 | ✅ Done | Export bucket |

**Progress: 1/2 CockroachDB tools done (50%)**

---

**Last Updated:** 2026-08-13 23:15 UTC  
**Next Action:** Setup MCP Server via Cloud Console
