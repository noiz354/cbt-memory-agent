# Engineering Roles — CBT Memory Agent × CockroachDB × AWS

> Panduan lengkap untuk setiap engineering role dalam hackathon CockroachDB × AWS.
> Frontend sudah supply data. Setiap role punya tanggung jawab spesifik untuk
> memenuhi syarat submission hackathon.

**Tanggal:** 2026-08-13
**Versi:** 1.0

---

## Arsitektur Overview

```
┌─────────────────────────────────────────────┐
│         FRONTEND (React + TypeScript)        │
│  - Sudah selesai, tinggal sync API           │
│  - apiClient.ts → 11 endpoints               │
│  - Zustand stores → sync ke backend          │
└───────────────────┬─────────────────────────┘
                    │ HTTPS (REST API)
                    ▼
┌─────────────────────────────────────────────┐
│         BACKEND (AWS Lambda)                 │  ← Software Engineer (Backend)
│  - API Gateway → Lambda handler              │
│  - Route ke CRDB / OpenRouter / S3              │
└───┬──────────┬───────────┬──────────────────┘
    │          │           │
    ▼          ▼           ▼
┌────────┐ ┌────────────┐ ┌────────┐
│ Cockr  │ │ OpenRouter │ │   S3   │
│ oachDB │ │ (LLM+Emb)  │ │(export)│
└───┬────┘ └───┬────────┘ └───┬────┘
    │          │           │
    ▼          ▼           ▼
 Database    ML/AI       Storage
 Engineer   Engineer    Engineer
```

---

## 1. Database Engineer (CockroachDB Specialist)

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **CockroachDB Cluster** | Provision cluster di CockroachDB Cloud | `docs/BACKEND-CONTRACT.md` (schema SQL) |
| **Schema Design** | 7 tables: users, memory_nodes, memory_edges, embeddings, sessions, chat_turns, audit_events | `docs/BACKEND-CONTRACT.md` § CockroachDB Schema |
| **Distributed Vector Indexing** | pgvector extension untuk semantic search | `GET /memory/semantic` endpoint |
| **CockroachDB MCP Server** | Setup MCP server untuk AI agent ↔ CRDB | Wajib untuk hackathon (tool #1) |
| **ccloud CLI** | Otomasi provisioning cluster | Wajib untuk hackathon (tool #3) |
| **Indexes** | Optimal query untuk user_id, session_id, vector similarity | Schema section |

### Deliverables

```sql
-- 1. Buat cluster
ccloud cluster create --name cbt-memory --cloud aws --region us-east-1

-- 2. Setup database
ccloud sql --cluster cbt-memory -f schema.sql

-- 3. Enable pgvector
ccloud sql --cluster cbt-memory -c "CREATE EXTENSION IF NOT EXISTS vector;"

-- 4. Setup MCP Server
ccloud mcp create --cluster cbt-memory --name cbt-mcp

-- 5. Verify
ccloud sql --cluster cbt-memory -c "SELECT * FROM information_schema.tables WHERE table_schema = 'public';"
```

### Schema SQL (copy dari BACKEND-CONTRACT.md)

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email STRING NOT NULL,
  display_name STRING NOT NULL,
  auth_method STRING NOT NULL,
  credential_id STRING,
  consent_version STRING,
  consent_accepted_at TIMESTAMPTZ,
  emergency_contact JSONB,
  goals STRING[],
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now()
);

-- Memory nodes
CREATE TABLE memory_nodes (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  kind STRING NOT NULL,
  title STRING NOT NULL,
  excerpt STRING,
  tags STRING[],
  weight FLOAT8,
  confidence FLOAT8,
  verified BOOL DEFAULT false,
  references INT DEFAULT 0,
  last_touched TIMESTAMPTZ,
  x FLOAT8,
  y FLOAT8,
  crisis_flag BOOL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX memory_nodes_user_idx (user_id)
);

-- Memory edges
CREATE TABLE memory_edges (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  source STRING NOT NULL REFERENCES memory_nodes(id),
  target STRING NOT NULL REFERENCES memory_nodes(id),
  label STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX memory_edges_user_idx (user_id)
);

-- Embeddings (vector)
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  node_id STRING NOT NULL REFERENCES memory_nodes(id),
  embedding vector(1024),
  text_source STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX embeddings_user_idx (user_id),
  INDEX embeddings_node_idx (node_id)
);

-- Sessions
CREATE TABLE sessions (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  title STRING NOT NULL,
  status STRING NOT NULL,
  mood INT,
  mood_label STRING,
  started_at TIMESTAMPTZ,
  duration_min INT,
  excerpt STRING,
  thought STRING,
  reframe STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX sessions_user_idx (user_id),
  INDEX sessions_status_idx (status)
);

-- Chat turns
CREATE TABLE chat_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  session_id STRING REFERENCES sessions(id),
  role STRING NOT NULL,
  content STRING NOT NULL,
  tokens_used INT,
  injected_memory_ids STRING[],
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX chat_turns_user_idx (user_id),
  INDEX chat_turns_session_idx (session_id)
);

-- Audit events
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type STRING NOT NULL,
  detail STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX audit_events_user_idx (user_id),
  INDEX audit_events_type_idx (type)
);
```

### Checklist Hackathon

- [ ] CockroachDB cluster running (AWS region)
- [ ] 7 tables created dengan indexes
- [ ] pgvector extension enabled
- [ ] CockroachDB Cloud MCP Server setup (wajib tool #1)
- [ ] ccloud CLI di CI/CD pipeline (wajib tool #3)
- [ ] Connection string tersedia untuk Lambda

---

## 2. Machine Learning Engineer (Embeddings + LLM)

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **LLM via OpenRouter** | LLM chat (`openrouter/free`) + embeddings (`baai/bge-m3`) | `docs/BACKEND-CONTRACT.md` § AWS Services |
| **Embedding Model** | `baai/bge-m3` (1024-dim, free) via OpenRouter | GET `/memory/semantic` |
| **Vector Pipeline** | Generate embedding → store ke CRDB → query cosine distance | Distributed Vector Indexing |
| **Model Selection** | Pilih model terbaik untuk CBT context | Cost vs accuracy tradeoff |

### Deliverables

```python
# embedding_service.py — Lambda layer
# (contoh pseudocode — implementasi aktual: lambda/lib/openrouter.ts di TS)
import requests

OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings"
API_KEY = os.environ["OPENROUTER_API_KEY"]

def generate_embedding(text: str) -> list[float]:
    """Generate 1024-dim embedding untuk semantic search."""
    resp = requests.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"model": "baai/bge-m3", "input": text},
    )
    return resp.json()["data"][0]["embedding"]

def query_semantic(query: str, user_id: str, limit: int = 5, min_confidence: float = 0.6):
    """Query CRDB dengan vector similarity."""
    embedding = generate_embedding(query)
    # SQL: SELECT ... ORDER BY embedding <=> $1 LIMIT $2
    # WHERE user_id = $3 AND confidence >= $4
    ...
```

### Model Comparison

| Model | Dimensi | Cost/1K | Speed | CBT Suitability |
|---|---|---|---|---|
| baai/bge-m3 | 1024 | FREE | Fast | ✅ Good for therapy context |
| snowflake-arctic-embed-l | 1024 | paid | Fast | ✅ Free tier |
| BAAI/bge-m3 (multilingual) | 1024 | FREE | Fast | ✅ Support ID language |

### Checklist Hackathon

- [x] OpenRouter API key configured (SSM `/hackathon/openrouter/api-key`)
- [x] Embedding pipeline: text → vector → CRDB
- [ ] Semantic search working: query → vector → cosine distance → results
- [ ] Cost monitoring setup

---

## 3. AI Engineer (LLM Orchestration + MCP)

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **LLM (OpenRouter)** | `openrouter/free` untuk CBT response | POST `/chat/turn` |
| **CockroachDB MCP Server** | AI agent query CRDB via MCP protocol | Wajib tool #1 |
| **Prompt Engineering** | CBT system prompt + context injection | `src/shared/lib/llmClient.ts` (CBT_SYSTEM_PROMPT) |
| **Streaming** | SSE response dari OpenRouter | apiClient.ts streaming |
| **Context Window** | Memory nodes + chat history → prompt | RAG pattern |

### Deliverables

```python
# llm_handler.py — Lambda function untuk POST /chat/turn (pseudocode)
# Implementasi aktual: lambda/handlers/chatTurn.ts (TypeScript)
import json
import requests
from crdb_client import get_crdb_connection

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_KEY = os.environ["OPENROUTER_API_KEY"]

def handle_chat_turn(event):
    """Process CBT chat turn via OpenRouter + CRDB."""
    body = json.loads(event["body"])
    user_id = event["headers"]["X-User-Id"]
    user_message = body["userMessage"]
    memory_ids = body.get("memoryIds", [])

    # 1. Get context from CRDB via MCP
    conn = get_crdb_connection()
    context_nodes = conn.query("""
        SELECT title, excerpt, tags FROM memory_nodes
        WHERE id = ANY($1) AND user_id = $2
    """, [memory_ids, user_id])

    # 2. Get semantic matches via vector index
    semantic_results = conn.query("""
        SELECT n.title, n.excerpt
        FROM embeddings e
        JOIN memory_nodes n ON e.node_id = n.id
        WHERE e.user_id = $1
        ORDER BY e.embedding <=> $2
        LIMIT 3
    """, [user_id, generate_embedding(user_message)])

    # 3. Build prompt with context
    prompt = build_cbt_prompt(user_message, context_nodes, semantic_results)

    # 4. Call OpenRouter (streaming)
    response = requests.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
        json={
            "model": "openrouter/free",
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
        },
        stream=True,
    )

    # 5. Stream response back
    return stream_sse_response(response)

def build_cbt_prompt(user_message, context_nodes, semantic_results):
    """Build CBT-optimized prompt with memory context."""
    return f"""You are a CBT (Cognitive Behavioral Therapy) assistant.

Context from user's memory:
{format_nodes(context_nodes)}

Related memories (semantic search):
{format_nodes(semantic_results)}

User message: {user_message}

Respond using CBT techniques: identify automatic thoughts, name cognitive distortions,
suggest evidence-based reframes. Be warm, concise (200-400 words), collaborative.
"""
```

### Checklist Hackathon

- [x] OpenRouter API key configured (LLM + embeddings)
- [x] MCP Server connected to CRDB cluster
- [x] CBT system prompt optimized (lihat `llmClient.ts`)
- [x] Streaming SSE working dari OpenRouter → Lambda → Frontend
- [ ] Context window management: memory + chat history → prompt

---

## 4. Backend Software Engineer (AWS Lambda + API)

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **AWS Lambda** | 11 endpoint handlers | `docs/BACKEND-CONTRACT.md` § API Contract |
| **API Gateway** | REST API routing + CORS | `/api/v1/*` |
| **Auth Middleware** | Validate session token + device ID | Semua endpoint kecuali `/health` |
| **Error Handling** | Graceful fallback, retry logic | apiClient.ts error patterns |
| **Deployment** | Serverless Framework / CDK | Infrastructure as Code |

### Deliverables

```typescript
// handler.ts — Lambda handler (TypeScript)
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "./crdb";
import { OpenRouterClient } from "./openrouter";
import { S3ClientService } from "./s3";

const crdb = new CrdbClient(process.env.CRDB_CONNECTION);
const llm = new OpenRouterClient();
const s3 = new S3ClientService(process.env.S3_BUCKET);

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const path = event.path;
  const method = event.httpMethod;
  const token = event.headers["Authorization"]?.replace("Bearer ", "");
  const deviceId = event.headers["X-Device-Id"];

  // Auth middleware
  if (!token && !path.startsWith("/health")) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  // Route handling
  try {
    if (method === "POST" && path === "/api/v1/chat/turn") {
      return await handleChatTurn(event, crdb, llm);
    }
    if (method === "GET" && path === "/api/v1/memory") {
      return await handleListMemory(event, crdb, token!, deviceId!);
    }
    if (method === "POST" && path === "/api/v1/memory") {
      return await handleUpsertMemory(event, crdb, token!, deviceId!);
    }
    if (method === "DELETE" && path.startsWith("/api/v1/memory/")) {
      const id = path.split("/").pop()!;
      return await handleDeleteMemory(event, crdb, id, token!, deviceId!);
    }
    if (method === "GET" && path === "/api/v1/memory/semantic") {
      return await handleSemanticSearch(event, crdb, llm, token!, deviceId!);
    }
    if (method === "POST" && path === "/api/v1/session") {
      return await handleSaveSession(event, crdb, token!, deviceId!);
    }
    if (method === "GET" && path === "/api/v1/sessions") {
      return await handleListSessions(event, crdb, token!, deviceId!);
    }
    if (method === "POST" && path === "/api/v1/export") {
      return await handleExport(event, crdb, s3, token!, deviceId!);
    }
    if (method === "POST" && path === "/api/v1/purge") {
      return await handlePurge(event, crdb, token!, deviceId!);
    }
    if (method === "GET" && path === "/api/v1/metrics") {
      return await handleMetrics(event, crdb, token!, deviceId!);
    }
    if (method === "GET" && path === "/api/v1/health") {
      return await handleHealth(crdb, llm, s3);
    }

    return { statusCode: 404, body: "Not found" };
  } catch (err) {
    console.error("API error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}
```

### Terraform Config

```hcl
# infra/modules/lambda/main.tf (ringkas)
environment {
  variables = {
    CRDB_CONNECTION  = data.aws_ssm_parameter.crdb_url.value
    OPENROUTER_API_KEY = data.aws_ssm_parameter.openrouter_api_key.value
    S3_BUCKET        = var.s3_bucket
    ALLOWED_ORIGIN   = var.allowed_origin
  }
}
```
          path: /api/v1/{proxy+}
          method: any
```

### Checklist Hackathon

- [ ] 11 endpoint handlers implemented
- [ ] Lambda Function URL deployed dengan CORS
- [ ] Auth middleware working (token + deviceId)
- [ ] Error handling + retry logic
- [ ] Lambda deployed ke AWS us-east-1
- [ ] Terraform stack di repo

---

## 5. Storage Engineer (Amazon S3)

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **S3 Bucket** | Export bundle storage | POST `/export` |
| **Presigned URLs** | 24h expiry untuk download | ExportResponse.s3Url |
| **Lifecycle Policy** | Auto-delete exports > 7 days | Cost optimization |
| **Encryption** | SSE-S3 untuk data at rest | Security requirement |

### Deliverables

```python
# s3_service.py
import boto3
from datetime import timedelta

s3 = boto3.client("s3", region_name="us-east-1")
BUCKET = "cbt-memory-exports"

def upload_export(user_id: str, bundle: dict) -> str:
    """Upload export bundle to S3, return presigned URL."""
    key = f"exports/{user_id}/{uuid4()}.json"
    
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=json.dumps(bundle),
        ContentType="application/json",
        ServerSideEncryption="AES256",
    )
    
    # Presigned URL (24h expiry)
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=86400,  # 24 hours
    )
    return url

def setup_lifecycle():
    """Auto-delete exports > 7 days."""
    s3.put_bucket_lifecycle_configuration(
        Bucket=BUCKET,
        LifecycleConfiguration={
            "Rules": [
                {
                    "Id": "DeleteOldExports",
                    "Status": "Enabled",
                    "Prefix": "exports/",
                    "Expiration": {"Days": 7},
                }
            ]
        },
    )
```

### Checklist Hackathon

- [ ] S3 bucket created (`cbt-memory-exports`)
- [ ] SSE-S3 encryption enabled
- [ ] Presigned URL generation working
- [ ] Lifecycle policy: 7-day expiry
- [ ] IAM policy for Lambda → S3 access

---

## 6. Software Development in Test (SDT) / QA Engineer

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **Frontend Tests** | Vitest + React Testing Library | `src/**/*.test.ts` |
| **API Contract Tests** | Validate request/response schema | `docs/BACKEND-CONTRACT.md` |
| **Integration Tests** | Lambda → CRDB → OpenRouter end-to-end | Hackathon demo flow |
| **Performance Tests** | Latency < 2s untuk chat turn | SLA requirement |
| **Security Tests** | Auth bypass, injection, XSS | Zero-cloud privacy |

### Test Plan

```typescript
// apiClient.test.ts — Frontend API contract tests
import { apiClient } from "@/shared/lib/apiClient";

describe("apiClient", () => {
  test("health returns ok status", async () => {
    const res = await apiClient.health();
    expect(res.status).toBe("ok");
    expect(res.crdb).toBe("connected");
  });

  test("chatTurn streams response", async () => {
    const chunks: string[] = [];
    await apiClient.chatTurn(
      {
        v: 1,
        sessionId: "ses_test",
        userMessage: "Hello",
        clientTs: new Date().toISOString(),
        deviceOnly: true,
      },
      "test-token",
      "test-device",
      (delta, done) => {
        if (delta) chunks.push(delta);
      },
    );
    expect(chunks.length).toBeGreaterThan(0);
  });

  test("searchMemory returns results", async () => {
    const res = await apiClient.searchMemory("anxiety", "token", "device");
    expect(res.results).toBeDefined();
    expect(res.results.length).toBeLessThanOrEqual(5);
  });
});
```

### Checklist Hackathon

- [ ] Frontend unit tests: 80%+ coverage
- [ ] API contract tests: all 11 endpoints
- [ ] Integration test: chat → CRDB → OpenRouter → response
- [ ] Latency test: chat turn < 2s p95
- [ ] Security scan: no XSS, no SQL injection

---

## 7. DevOps / Platform Engineer

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **CI/CD Pipeline** | GitHub Actions: build → test → deploy | `.github/workflows/deploy.yml` |
| **Infrastructure as Code** | CDK / Terraform untuk AWS + CRDB | `infra/` directory |
| **Monitoring** | CloudWatch logs + alarms | Lambda errors, CRDB latency |
| **Secrets Management** | AWS SSM Parameter Store | CRDB connection string |

### Deliverables

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      
      - name: Install dependencies
        run: npm ci
      
      - name: Typecheck
        run: npm run typecheck
      
      - name: Run tests
        run: npm test
      
      - name: Deploy frontend
        run: npm run build
        env:
          VITE_API_URL: ${{ secrets.API_URL }}
      
      - name: Deploy backend
        run: npx serverless deploy
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Checklist Hackathon

- [ ] GitHub Actions CI/CD pipeline
- [ ] Frontend auto-deploy (Vercel/Netlify)
- [ ] Backend auto-deploy (Serverless/CDK)
- [ ] CRDB connection via SSM Parameter Store
- [ ] CloudWatch alarms for Lambda errors

---

## 8. Security Engineer

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **Auth Validation** | Session token + device ID verification | API middleware |
| **Data Encryption** | At-rest (CRDB) + in-transit (HTTPS) | Zero-cloud privacy |
| **Input Validation** | Schema validation untuk semua endpoints | `docs/BACKEND-CONTRACT.md` |
| **Audit Logging** | All mutations logged to audit_events | Privacy compliance |

### Security Checklist

- [ ] HTTPS enforced (API Gateway)
- [ ] Auth token validation (JWT or session)
- [ ] Input schema validation (Zod/Yup)
- [ ] SQL injection prevention (parameterized queries)
- [ ] CORS restricted to frontend domain
- [ ] Rate limiting on Lambda (prevent abuse)
- [ ] Audit log for all data mutations
- [ ] BYOK keys never sent to backend (IndexedDB only)

---

## Submission Checklist — Semua Role

| Item | Owner | Status |
|---|---|---|
| **Public Open-Source Repo** | DevOps | ⏳ |
| **MIT License** | DevOps | ⏳ |
| **Functional Demo App URL** | Frontend + Backend | ⏳ |
| **Video Demo (≤3 menit)** | All | ⏳ |
| **Dokumentasi Tools** | All | ✅ BACKEND-CONTRACT.md + ENGINEERING-ROLES.md |
| **CockroachDB (persistent layer)** | Database Engineer | ⏳ |
| **CockroachDB MCP Server** | AI Engineer + DB Engineer | ⏳ |
| **Distributed Vector Indexing** | ML Engineer + DB Engineer | ⏳ |
| **ccloud CLI** | DevOps + DB Engineer | ⏳ |
| **OpenRouter LLM** | AI Engineer | ✅ |
| **AWS Lambda** | Backend Engineer | ⏳ |
| **Amazon S3** | Storage Engineer | ⏳ |

---

## Frontend Summary — Yang Sudah Dikerjakan

| File | Perubahan | Status |
|---|---|---|
| `src/shared/lib/apiClient.ts` | **BARU** — 11 endpoint calls | ✅ |
| `src/features/chat/store/chatStore.ts` | POST `/chat/turn` sync | ✅ |
| `src/features/memory/store/memoryStore.ts` | POST/DELETE `/memory` sync | ✅ |
| `src/features/sessions/store/sessionStore.ts` | POST `/session` sync | ✅ |
| `src/features/privacy/lib/exportBundle.ts` | POST `/export` sync | ✅ |

Frontend sudah selesai. **Backend team mulai dari sini.**
