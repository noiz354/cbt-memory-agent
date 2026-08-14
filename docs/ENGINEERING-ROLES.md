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
│  - Route ke CRDB / Bedrock / S3              │
└───┬──────────┬───────────┬──────────────────┘
    │          │           │
    ▼          ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐
│ Cockr  │ │ Bedrock│ │   S3   │
│ oachDB │ │ (LLM)  │ │(export)│
└───┬────┘ └───┬────┘ └───┬────┘
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

## 2. Machine Learning Engineer (Embeddings + Bedrock)

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **Amazon Bedrock** | Setup model access (Claude + embeddings) | `docs/BACKEND-CONTRACT.md` § AWS Services |
| **Embedding Model** | `cohere.embed-english-v3` atau `amazon.titan-embed-text-v2` | GET `/memory/semantic` |
| **Vector Pipeline** | Generate embedding → store ke CRDB → query cosine distance | Distributed Vector Indexing |
| **Model Selection** | Pilih model terbaik untuk CBT context | Cost vs accuracy tradeoff |

### Deliverables

```python
# embedding_service.py — Lambda layer
import boto3
import json

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

def generate_embedding(text: str) -> list[float]:
    """Generate 1024-dim embedding untuk semantic search."""
    response = bedrock.invoke_model(
        modelId="cohere.embed-english-v3",
        body=json.dumps({
            "texts": [text],
            "input_type": "search_document",
        }),
    )
    body = json.loads(response["body"].read())
    return body["embeddings"][0]

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
| cohere.embed-english-v3 | 1024 | $0.10 | Fast | ✅ Good for therapy context |
| amazon.titan-embed-text-v2 | 1024 | $0.08 | Medium | ✅ AWS native |
| Cohere.embed-multilingual-v3 | 1024 | $0.10 | Fast | ✅ Support ID language |

### Checklist Hackathon

- [ ] Bedrock model access enabled (Claude + embeddings)
- [ ] Embedding pipeline: text → vector → CRDB
- [ ] Semantic search working: query → vector → cosine distance → results
- [ ] Cost monitoring setup

---

## 3. AI Engineer (LLM Orchestration + MCP)

### Tanggung Jawab

| Item | Detail | File Referensi |
|---|---|---|
| **Bedrock LLM** | Claude (Sonnet/Haiku) untuk CBT response | POST `/chat/turn` |
| **CockroachDB MCP Server** | AI agent query CRDB via MCP protocol | Wajib tool #1 |
| **Prompt Engineering** | CBT system prompt + context injection | `src/shared/lib/llmClient.ts` (CBT_SYSTEM_PROMPT) |
| **Streaming** | SSE response dari Bedrock | apiClient.ts streaming |
| **Context Window** | Memory nodes + chat history → prompt | RAG pattern |

### Deliverables

```python
# llm_handler.py — Lambda function untuk POST /chat/turn
import boto3
import json
from crdb_client import get_crdb_connection

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

def handle_chat_turn(event):
    """Process CBT chat turn via Bedrock + CRDB."""
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

    # 4. Call Bedrock (Claude)
    response = bedrock.invoke_model_with_response_stream(
        modelId="anthropic.claude-sonnet-4-20250514-v1:0",
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": prompt}],
        }),
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

- [ ] Bedrock Claude model access enabled
- [ ] MCP Server connected to CRDB cluster
- [ ] CBT system prompt optimized (lihat `llmClient.ts`)
- [ ] Streaming SSE working dari Bedrock → Lambda → Frontend
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
import { BedrockClient } from "./bedrock";
import { S3Client } from "./s3";

const crdb = new CrdbClient(process.env.CRDB_CONNECTION);
const bedrock = new BedrockClient();
const s3 = new S3Client();

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
      return await handleChatTurn(event, crdb, bedrock);
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
      return await handleSemanticSearch(event, crdb, bedrock, token!, deviceId!);
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
      return await handleHealth(crdb, bedrock, s3);
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

### Serverless Framework Config

```yaml
# serverless.yml
service: cbt-memory-agent

provider:
  name: aws
  runtime: nodejs22.x
  region: us-east-1
  environment:
    CRDB_CONNECTION: ${ssm:/cbt-memory/crdb-connection}
    BEDROCK_REGION: us-east-1

functions:
  api:
    handler: dist/handler.handler
    events:
      - httpApi:
          path: /api/v1/{proxy+}
          method: any
```

### Checklist Hackathon

- [ ] 11 endpoint handlers implemented
- [ ] API Gateway deployed dengan CORS
- [ ] Auth middleware working (token + deviceId)
- [ ] Error handling + retry logic
- [ ] Lambda deployed ke AWS us-east-1
- [ ] serverless.yml / CDK stack di repo

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
| **Integration Tests** | Lambda → CRDB → Bedrock end-to-end | Hackathon demo flow |
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
- [ ] Integration test: chat → CRDB → Bedrock → response
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
| **Amazon Bedrock** | ML Engineer + AI Engineer | ⏳ |
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
