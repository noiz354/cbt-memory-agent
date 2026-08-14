# CockroachDB MCP Server — Setup Instructions

> Cara menghubungkan AI tools (Claude Code, Cursor, dll) ke cluster woozy-grivet via MCP.
> Cluster ID: `87275047-fbf8-4f18-8b8d-a5ff97a335e3`
> MCP Endpoint: `https://cockroachlabs.cloud/mcp`

**Tanggal:** 2026-08-13  
**Cluster:** woozy-grivet  
**Source:** CockroachDB Cloud Console

---

## 📋 APA ITU MCP?

MCP (Model Context Protocol) memungkinkan AI tools untuk:
- Explore schemas dalam natural language
- Diagnose slow queries
- Get index recommendations
- Query database langsung dari Claude Code/Cursor

---

## 🔧 CARA SETUP (PILIH SALAH SATU)

### Option 1: Via Claude Code CLI (Recommended)

```bash
# Add MCP server ke project config
claude mcp add cockroachdb-cloud https://cockroachlabs.cloud/mcp \
  --transport http \
  --header "mcp-cluster-id: 87275047-fbf8-4f18-8b8d-a5ff97a335e3"

# Authenticate
claude /mcp
# Pilih "cockroachdb-cloud" → "Authenticate"
# Browser akan buka untuk OAuth flow
```

### Option 2: Manual Config File

Tambahkan ini ke `.claude.json` di root project:

```json
{
  "mcpServers": {
    "cockroachdb-cloud": {
      "type": "http",
      "url": "https://cockroachlabs.cloud/mcp",
      "headers": {
        "mcp-cluster-id": "87275047-fbf8-4f18-8b8d-a5ff97a335e3"
      }
    }
  }
}
```

Kemudian:
```bash
claude /mcp
# Pilih "cockroachdb-cloud" → "Authenticate"
```

---

## 🔐 AUTHENTICATION FLOW

1. Setelah config setup, run `claude /mcp`
2. Pilih `cockroachdb-cloud`
3. Pilih `Authenticate`
4. Browser akan buka untuk OAuth login
5. Login dengan Google (seperti biasa)
6. Pilih permission level:
   - **Read-only** — untuk explore schema, diagnose queries
   - **Write** — untuk execute SQL, create indexes, dll

**Atau pakai API Key (tidak perlu browser):**

1. Buka https://cockroachlabs.cloud → Settings → API Keys
2. Generate API Key
3. Set environment variable:
   ```bash
   export CCLOUD_MCP_API_KEY="your-api-key-here"
   ```
4. Atau tambahkan ke config:
   ```json
   {
     "mcpServers": {
       "cockroachdb-cloud": {
         "type": "http",
         "url": "https://cockroachlabs.cloud/mcp",
         "headers": {
           "mcp-cluster-id": "87275047-fbf8-4f18-8b8d-a5ff97a335e3",
           "Authorization": "Bearer your-api-key-here"
         }
       }
     }
   }
   ```

---

## 🎯 SETUP UNTUK PROJECT INI

### Step 1: Buat File Config

```bash
cd /home/norman2/14-8-26-aws-x-coachroachdb-merge
```

Buat file `.claude.json`:

```json
{
  "mcpServers": {
    "cockroachdb-cloud": {
      "type": "http",
      "url": "https://cockroachlabs.cloud/mcp",
      "headers": {
        "mcp-cluster-id": "87275047-fbf8-4f18-8b8d-a5ff97a335e3"
      }
    }
  }
}
```

### Step 2: Authenticate

```bash
claude /mcp
# Pilih "cockroachdb-cloud" → "Authenticate"
# Browser akan buka → login dengan Google
```

### Step 3: Verify Connection

Setelah authenticated, test dengan bertanya ke Claude:
- "What tables are in the database?"
- "Show me the schema for embeddings table"
- "What indexes exist on the embeddings table?"

---

## 📊 MCP TOOLS YANG TERSEDIA

Setelah connect, AI bisa pakai tools ini:

| Tool | Fungsi | Permission |
|---|---|---|
| `explore_schema` | Explore table structure, columns, types | Read |
| `run_query` | Execute SQL queries | Read/Write |
| `diagnose_query` | Diagnose slow queries, get recommendations | Read |
| `list_indexes` | List indexes on a table | Read |
| `recommend_indexes` | Get index recommendations | Read |
| `explain_query` | EXPLAIN ANALYZE untuk query | Read |

---

## 🔗 DOKUMENTASI RESMI

- MCP Docs: https://cockroachlabs.cloud/docs/mcp
- Authorization: https://cockroachlabs.cloud/docs/mcp/authorize
- Cluster MCP: https://cockroachlabs.cloud/mcp

---

## ⚠️ NOTES PENTING

1. **Cluster ID:** `87275047-fbf8-4f18-8b8d-a5ff97a335e3` (WAJIB di header)
2. **MCP Endpoint:** `https://cockroachlabs.cloud/mcp`
3. **OAuth Flow:** Browser akan buka untuk login
4. **Permission:** Pilih read-only untuk explore, write untuk execute SQL
5. **API Key Alternative:** Jika tidak bisa OAuth, pakai API key dari Cloud Console

---

**Last Updated:** 2026-08-13  
**Cluster:** woozy-grivet  
**Status:** ⏳ Belum setup — perlu buat `.claude.json` + authenticate
