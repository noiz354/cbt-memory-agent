# Backend Contract — CBT Memory Agent × CockroachDB × AWS

> Dokumen ini adalah **kontrak antara frontend dan backend** untuk hackathon CockroachDB × AWS.
> Frontend **hanya** memanggil API endpoint di bawah ini. Backend bertanggung jawab penuh
> atas CockroachDB, AWS, vector indexing, dan LLM orchestration.

**Tanggal:** 2026-08-13
**Versi:** 1.0

---

## Arsitektur High-Level

```
┌──────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                       │
│  - UI: chat, memory graph, sessions, privacy                  │
│  - Zustand stores: cache (backend-primary)                    │
│  - IndexedDB: BYOK keys (WebCrypto encrypted)                 │
│  - Web Workers: face (luma), audio (RMS), VAD (Silero)       │
│                                                              │
│  Memanggil API:                                               │
│    POST /api/v1/chat/turn        → CBT response               │
│    GET  /api/v1/memory           → sync graph nodes/edges     │
│    POST /api/v1/memory           → upsert node/edge           │
│    DELETE /api/v1/memory/:id     → purge node                 │
│    GET  /api/v1/memory/semantic  → vector search (RAG)        │
│    POST /api/v1/session          → save session               │
│    GET  /api/v1/sessions         → list sessions              │
│    POST /api/v1/export           → mint JSON export           │
│    POST /api/v1/purge            → hard purge (server-side)   │
│    GET  /api/v1/metrics          → aggregate metrics          │
│    GET  /api/v1/health           → health check               │
└──────────────────────────────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    BACKEND (AWS + CockroachDB)                 │
│                                                              │
│  AWS Services (wajib ≥1):                                    │
│    - OpenRouter (API): LLM inference + embeddings            │
│    - AWS Lambda: serverless API handler                      │
│    - Amazon S3: export bundle storage                        │
│                                                              │
│  CockroachDB Tools (wajib ≥2):                               │
│    - CockroachDB Cloud MCP Server: AI agent ↔ CRDB           │
│    - Distributed Vector Indexing: semantic search / RAG      │
│    - ccloud CLI: cluster provisioning (CI/CD)                │
│    - Agent Skills Repo: automation scripts                   │
│                                                              │
│  CockroachDB (persistent memory layer):                      │
│    - Tables: users, memory_nodes, memory_edges, sessions,    │
│              chat_turns, audit_events, embeddings             │
│    - pgvector extension untuk semantic search                │
└──────────────────────────────────────────────────────────────┘
```

---

## Frontend — Apa yang HARUS Diubah

### Yang TETAP di Frontend (tidak berubah)

| Komponen | Alasan |
|---|---|
| Zustand stores (cache) | Tetap untuk offline-first, sync ke backend saat online |
| IndexedDB BYOK keys | Tetap, tidak ada key yang dikirim ke backend |
| Web Workers (face, audio, VAD) | Tetap on-device, tidak ada raw media yang dikirim |
| Crisis detection (regex) | Tetap on-device, latency-critical |
| Hard purge (localStorage) | Tetap on-device, irreversible |

### Yang HARUS Ditambah di Frontend

| File | Perubahan | Detail |
|---|---|---|
| `src/shared/lib/apiClient.ts` | **BARU** — HTTP client ke backend | fetch wrapper, auth header, retry logic |
| `src/features/chat/store/chatStore.ts` | Modifikasi `sendMessage` | Selain `callLLMWithFallback()`, juga POST ke `/api/v1/chat/turn` untuk sync ke CRDB |
| `src/features/memory/store/memoryStore.ts` | Modifikasi `linkNodes`, `finishPurge`, `moveNode` | POST/DELETE ke `/api/v1/memory` untuk sync ke CRDB |
| `src/features/sessions/store/sessionStore.ts` | Modifikasi `addSession`, `setStatus` | POST ke `/api/v1/session` |
| `src/features/privacy/lib/exportBundle.ts` | Tambah `uploadExportBundle()` | POST ke `/api/v1/export` |
| `src/features/auth/store/authStore.ts` | Tambah `sessionToken` di persist | Token auth untuk API calls |

### Yang TIDAK Perlu Diubah di Frontend

| Komponen | Alasan |
|---|---|
| `detectCrisis.ts` | Regex on-device, tidak perlu backend |
| `CameraPip.tsx` | Face analysis tetap on-device |
| `audioClient.ts` | Audio analysis tetap on-device |
| `hardPurge.ts` | LocalStorage cleanup tetap lokal |
| `byokKeyManager.ts` | API keys tetap di IndexedDB, tidak dikirim |

---

## Backend API Contract

### Base URL

```
https://api.cbt-memory-agent.example.com/api/v1
```

### Authentication

Semua endpoint kecuali `/health` memerlukan header:

```
Authorization: Bearer <session-token>
X-Device-Id: <browser-fingerprint-hash>
```

Token didapat saat user complete auth di frontend. Backend memvalidasi token terhadap CockroachDB `users` table.

---

### 1. Chat Turn

**POST** `/chat/turn`

Simpan chat turn ke CockroachDB dan dapatkan response dari LLM (via OpenRouter).

**Request:**
```json
{
  "v": 1,
  "sessionId": "ses_abc123",
  "userMessage": "Saya merasa cemas saat meeting besok...",
  "memoryIds": ["mem_breath", "mem_reframe"],
  "clientTs": "2026-08-13T08:03:12.000Z",
  "deviceOnly": true
}
```

**Response (streaming SSE):**
```
event: token
data: {"t": "Itu terdengar seperti anticipatory anxiety."}

event: token
data: {"t": " Mari kita identifikasi thought-nya..."}

event: done
data: {"turnId": "turn_xyz", "tokensUsed": 245}
```

**Response (non-streaming):**
```json
{
  "v": 1,
  "turnId": "turn_xyz",
  "assistantMessage": "Itu terdengar seperti anticipatory anxiety...",
  "tokensUsed": 245,
  "latencyMs": 1200
}
```

**Backend melakukan:**
1. Simpan user message ke `chat_turns` table
2. Ambil memory nodes dari `memory_nodes` table (by IDs)
3. Generate embedding dari user message → query `embeddings` table (vector index)
4. Panggil OpenRouter (LLM) dengan context: memory + vector results
5. Simpan assistant response ke `chat_turns` table
6. Update `memory_nodes.references` untuk nodes yang di-inject

---

### 2. Memory — List

**GET** `/memory`

**Response:**
```json
{
  "v": 1,
  "nodes": [
    {
      "id": "mem_breath",
      "kind": "core",
      "title": "Sunday kitchen spiral",
      "excerpt": "Catastrophizing after a delayed text...",
      "tags": ["anxiety", "automatic thought"],
      "weight": 0.86,
      "confidence": 0.91,
      "verified": true,
      "references": 4,
      "lastTouched": "2026-08-11T09:20:00.000Z",
      "x": 140,
      "y": 120
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "mem_breath",
      "target": "chunk_slack",
      "label": "situation",
      "createdAt": "2026-08-13T08:04:00.000Z"
    }
  ]
}
```

**Backend melakukan:** Query `memory_nodes` dan `memory_edges` WHERE user_id = ?

---

### 3. Memory — Upsert

**POST** `/memory`

**Request:**
```json
{
  "v": 1,
  "action": "upsert",
  "node": {
    "id": "mem_new",
    "kind": "core",
    "title": "New insight",
    "excerpt": "...",
    "tags": ["reframe"],
    "weight": 0.5,
    "confidence": 0.8,
    "x": 300,
    "y": 200
  }
}
```

atau untuk edge:

```json
{
  "v": 1,
  "action": "upsert",
  "edge": {
    "id": "e_new",
    "source": "mem_breath",
    "target": "mem_new",
    "label": "related"
  }
}
```

**Response:**
```json
{ "v": 1, "ok": true, "id": "mem_new" }
```

**Backend melakukan:** INSERT/UPDATE ke `memory_nodes` atau `memory_edges`

---

### 4. Memory — Delete (Purge)

**DELETE** `/memory/:id`

**Response:**
```json
{ "v": 1, "ok": true, "deletedId": "mem_new" }
```

**Backend melakukan:**
1. DELETE dari `memory_nodes` WHERE id = ?
2. DELETE dari `memory_edges` WHERE source = ? OR target = ?
3. DELETE dari `embeddings` WHERE node_id = ?
4. Log ke `audit_events` (MEMORY_PURGED)

---

### 5. Memory — Semantic Search (RAG)

**GET** `/memory/semantic?q=...&limit=5`

**Request query:**
- `q` (required): search query
- `limit` (optional, default 5): max results
- `minConfidence` (optional, default 0.6): filter by confidence

**Response:**
```json
{
  "v": 1,
  "results": [
    {
      "node": { "id": "mem_breath", "title": "...", "excerpt": "..." },
      "score": 0.92,
      "matchReason": "vector_similarity"
    }
  ]
}
```

**Backend melakukan:**
1. Generate embedding dari query `q` via OpenRouter `baai/bge-m3`
2. Query `embeddings` table dengan `<=>` (pgvector cosine distance)
3. JOIN dengan `memory_nodes` untuk ambil metadata
4. Filter by `confidence >= minConfidence`
5. Return top `limit` results

**CockroachDB tool yang dipakai:** **Distributed Vector Indexing** (wajib untuk hackathon)

---

### 6. Session — Save

**POST** `/session`

**Request:**
```json
{
  "v": 1,
  "session": {
    "id": "ses_new",
    "title": "Anxiety about meeting",
    "status": "extracted",
    "mood": 4,
    "moodLabel": "anxious",
    "startedAt": "2026-08-13T08:02:00.000Z",
    "durationMin": 18,
    "excerpt": "Unsent drafts. Tight chest.",
    "thought": "If I send the wrong thing...",
    "reframe": "A delayed message can still be safe."
  }
}
```

**Response:**
```json
{ "v": 1, "ok": true, "id": "ses_new" }
```

**Backend melakukan:** INSERT/UPDATE ke `sessions` table

---

### 7. Sessions — List

**GET** `/sessions?status=all&query=...`

**Response:**
```json
{
  "v": 1,
  "sessions": [
    {
      "id": "ses_slack",
      "title": "Slack spiral",
      "status": "extracted",
      "mood": 4,
      "moodLabel": "anxious",
      "startedAt": "2026-08-13T08:02:00.000Z",
      "durationMin": 18,
      "excerpt": "Unsent drafts. Tight chest."
    }
  ]
}
```

---

### 8. Export

**POST** `/export`

**Request:**
```json
{
  "v": 1,
  "kinds": ["chat", "mood", "memory"]
}
```

**Response:**
```json
{
  "v": 2,
  "exportedAt": "2026-08-13T00:00:00.000Z",
  "consentVersion": "2026.08-cbt-1",
  "deviceOnly": true,
  "s3Url": "https://s3.amazonaws.com/cbt-exports/user_abc/export_xyz.json",
  "expiresAt": "2026-08-14T00:00:00.000Z"
}
```

**Backend melakukan:**
1. Ambil data dari semua table (chat_turns, sessions, memory_nodes, memory_edges)
2. Build JSON bundle
3. Upload ke **Amazon S3** (wajib untuk hackathon)
4. Generate presigned URL (expires 24h)
5. Log ke `audit_events` (EXPORT_MINTED)

---

### 9. Purge (Server-Side)

**POST** `/purge`

**Request:**
```json
{
  "v": 1,
  "confirmation": "HAPUS SELURUH DATA SAYA",
  "deviceToken": "<webauthn-signature>"
}
```

**Response:**
```json
{ "v": 1, "ok": true, "deletedRows": 1234 }
```

**Backend melakukan:**
1. Validasi device token
2. DELETE dari semua table WHERE user_id = ?
3. DELETE dari `embeddings` WHERE user_id = ?
4. Log ke `audit_events` (HARD_PURGE)
5. Return count deleted rows

---

### 10. Metrics

**GET** `/metrics`

**Response:**
```json
{
  "v": 2,
  "releasedAt": "2026-08-13T00:00:00.000Z",
  "metrics": [
    { "id": 1, "name": "Crisis precision", "value": 85.7, "denominator": 7 },
    { "id": 7, "name": "Hard-halt integrity", "value": 100, "denominator": 7 }
  ],
  "northStar": { "activation": 12, "crashFree": 100, "hardHaltIntegrity": 100 },
  "guardrails": { "falseCrisisRate": 0, "distressNoAutoHalt": 100 }
}
```

**Backend melakukan:**
1. Aggregate dari `audit_events` table
2. Compute metrics di server-side
3. Return JSON

---

### 11. Health Check

**GET** `/health`

**Response:**
```json
{
  "status": "ok",
  "crdb": "connected",
  "llm": "available",
  "s3": "available",
  "version": "0.1.0"
}
```

---

## CockroachDB Schema

### Tables

```sql
-- Users (authenticated devices)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email STRING NOT NULL,
  display_name STRING NOT NULL,
  auth_method STRING NOT NULL, -- 'passkey' | 'magic-link'
  credential_id STRING,
  consent_version STRING,
  consent_accepted_at TIMESTAMPTZ,
  emergency_contact JSONB,
  goals STRING[],
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now()
);

-- Memory nodes (graph)
CREATE TABLE memory_nodes (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  kind STRING NOT NULL, -- 'core' | 'transcript'
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

-- Memory edges (relationships)
CREATE TABLE memory_edges (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  source STRING NOT NULL REFERENCES memory_nodes(id),
  target STRING NOT NULL REFERENCES memory_nodes(id),
  label STRING,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX memory_edges_user_idx (user_id)
);

-- Embeddings (vector index for semantic search)
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  node_id STRING NOT NULL REFERENCES memory_nodes(id),
  embedding vector(1024), -- pgvector, dimension sesuai model embedding (baai/bge-m3)
  text_source STRING, -- excerpt, title, atau chat content
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX embeddings_user_idx (user_id),
  INDEX embeddings_node_idx (node_id)
);

-- Sessions
CREATE TABLE sessions (
  id STRING PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  title STRING NOT NULL,
  status STRING NOT NULL, -- 'extracted' | 'pending' | 'interrupted'
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
  role STRING NOT NULL, -- 'user' | 'assistant' | 'system'
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

---

## CockroachDB Tools — Yang Dipakai (Wajib ≥2)

| Tool | Peran | Di mana dipakai |
|---|---|---|
| **CockroachDB Cloud MCP Server** | AI agent (backend) query CRDB langsung via protocol MCP | Saat generate CBT response, ambil memory context |
| **Distributed Vector Indexing** | Semantic search untuk RAG — query embedding terdistribusi | GET `/memory/semantic` |
| ccloud CLI | Provisioning cluster di CI/CD | GitHub Actions deploy pipeline |
| Agent Skills Repo | Automation scripts untuk operasional CRDB | Backup, migration, monitoring |

**Minimal 2 yang dipakai:** MCP Server + Distributed Vector Indexing ✅

---

## AWS Services — Yang Dipakai (Wajib ≥1)

| Service | Peran | Di mana dipakai |
|---|---|---|
| **OpenRouter** | LLM inference (`openrouter/free`) + embeddings (`baai/bge-m3`) | POST `/chat/turn`, GET `/memory/semantic` |
| **AWS Lambda** | Serverless API handler | Semua endpoint API |
| **Amazon S3** | Export bundle storage | POST `/export` |

**Minimal 1 yang dipakai:** OpenRouter + Lambda + S3 ✅ (3 services)

---

## Role Responsibilities

### Frontend (React app)

| Tugas | File |
|---|---|
| UI rendering (chat, graph, sessions) | `src/features/**` |
| Zustand state management (cache) | `src/shared/store/**` |
| On-device analysis (face, audio, VAD) | `src/workers/**` |
| Crisis detection (regex) | `src/features/crisis/lib/detectCrisis.ts` |
| BYOK key storage (IndexedDB + WebCrypto) | `src/shared/lib/byokKeyManager.ts` |
| API calls ke backend | `src/shared/lib/apiClient.ts` (BARU) |
| Sync data ke backend saat online | Modifikasi stores di atas |

### Backend (AWS Lambda + CockroachDB)

| Tugas | Endpoint |
|---|---|
| LLM inference via OpenRouter | POST `/chat/turn` |
| Memory CRUD | GET/POST/DELETE `/memory` |
| Semantic search (vector) | GET `/memory/semantic` |
| Session CRUD | GET/POST `/sessions`, `/session` |
| Export bundle (S3) | POST `/export` |
| Hard purge (server-side) | POST `/purge` |
| Metrics aggregate | GET `/metrics` |
| Auth validation | Semua endpoint (middleware) |

---

## Submission Checklist

| Item | Status | Detail |
|---|---|---|
| **Public Open-Source Repo** | ✅ | GitHub URL + MIT License |
| **Functional Demo App URL** | ✅ | Deployed frontend (Vercel/Netlify) |
| **Video Demo (≤3 menit)** | ⏳ | YouTube/Vimeo — tunjukkan: chat → memory graph → semantic search → CockroachDB MCP |
| **Dokumentasi Tools** | ✅ | File ini + README |
| **CockroachDB (wajib)** | ✅ | Persistent memory layer |
| **CockroachDB Tools (≥2)** | ✅ | MCP Server + Distributed Vector Indexing |
| **AWS Services (≥1)** | ✅ | OpenRouter + Lambda + S3 |

---

## Frontend API Client (Skeleton)

```typescript
// src/shared/lib/apiClient.ts — BARU

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const apiClient = {
  chatTurn: (body: object) => api("/chat/turn", { method: "POST", body: JSON.stringify(body) }),
  listMemory: () => api("/memory"),
  upsertMemory: (body: object) => api("/memory", { method: "POST", body: JSON.stringify(body) }),
  deleteMemory: (id: string) => api(`/memory/${id}`, { method: "DELETE" }),
  searchMemory: (q: string, limit = 5) => api(`/memory/semantic?q=${encodeURIComponent(q)}&limit=${limit}`),
  saveSession: (body: object) => api("/session", { method: "POST", body: JSON.stringify(body) }),
  listSessions: (status = "all", query = "") => api(`/sessions?status=${status}&query=${encodeURIComponent(query)}`),
  exportBundle: (kinds: string[]) => api("/export", { method: "POST", body: JSON.stringify({ v: 1, kinds }) }),
  purge: (confirmation: string) => api("/purge", { method: "POST", body: JSON.stringify({ v: 1, confirmation }) }),
  metrics: () => api("/metrics"),
  health: () => api("/health"),
};
```

---

## Verifikasi End-to-End

1. **Frontend build** → `npm run typecheck` → lolos
2. **Frontend dev** → `npm run dev` → app jalan di localhost:5173
3. **Backend deploy** → `serverless deploy` atau `cdk deploy` → Lambda + API Gateway aktif
4. **CockroachDB cluster** → `ccloud cluster create` → cluster running
5. **Health check** → `GET /api/v1/health` → `{"status": "ok"}`
6. **Chat turn** → `POST /api/v1/chat/turn` → streaming response dari OpenRouter
7. **Semantic search** → `GET /api/v1/memory/semantic?q=anxiety` → vector results
8. **Export** → `POST /api/v1/export` → S3 presigned URL
9. **Video demo** → rekam alur 1-8, ≤3 menit, upload ke YouTube
