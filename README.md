# CockroachDB × AWS — CBT Memory Agent

> CBT Memory Agent: on-device cognitive behavioral therapy workspace dengan
> **CockroachDB** sebagai persistent memory layer dan **AWS** (Lambda + S3) +
> **OpenRouter** (LLM inference) sebagai infrastruktur. Monorepo gabungan frontend (React) + backend (Lambda).

**Hackathon:** CockroachDB × AWS Agent Challenge 2026
**Tanggal:** 2026-08-13
**Merged:** 2026-08-14 (gabungan `13-8-26-aws-x-coachroachdb-database` + `13-8-26-aws-x-coachroachdb-frontend`)

---

## Hackathon Rules (Wajib Dipenuhi)

### 1. CockroachDB (Persistent Memory Layer) — WAJIB

Semua data user (memory nodes, edges, sessions, chat turns, audit events) disimpan di
CockroachDB — bukan hanya localStorage / file-based storage.

### 2. CockroachDB Tools (Pilih Minimal 2 dari 4) — **4/4 AKTIF**

| Tool | Status | Penggunaan |
|---|---|---|
| **CockroachDB Cloud Managed MCP Server** | ✅ **AKTIF (read-only)** | Agent query cluster via endpoint `https://cockroachlabs.cloud/mcp` (9 tool, bukti live di `docs/15-8-26/mcp-proof/`) |
| **CockroachDB Distributed Vector Indexing** | ✅ **AKTIF** | Semantic search + hybrid keyword/vector RAG untuk memory (`embeddings_vector_idx` C-SPANN) |
| ccloud CLI | ✅ **AKTIF** | Provisioning cluster + health gate CI (`scripts/ccloud-audit.sh`) |
| CockroachDB Agent Skills Repo | ✅ **AKTIF (vendor)** | `skills/cockroachdb-skills/` (34 skills, 10 domain) untuk agent tooling |

### 3. AWS Services (Pilih Minimal 1) — WAJIB

| Service | Status | Penggunaan |
|---|---|---|
| **AWS Lambda** | ✅ | Serverless API handler + agentic memory loop (reflection cron) |
| **Amazon S3** | ✅ | Frontend hosting (via CloudFront OAC) + export bundle storage |
| **Amazon CloudFront** | ✅ | CDN frontend (SPA) + proxy `/api/v1` → Lambda, security headers |
| **Amazon EventBridge** | ✅ | Schedule reflection job (rate 6 jam) → invoke Lambda |
| **Amazon CloudWatch** | ✅ | Logs + dashboard + Lambda health gate |
| **OpenRouter** | ✅ | LLM inference (Llama free) + embeddings (bge-m3) |

### 4. Submission Requirements — WAJIB

| Item | Status | Detail |
|---|---|---|
| **Public Open-Source Repository** | ✅ | GitHub + MIT License |
| **Functional Demo App URL** | ✅ | Frontend: `https://d2sbinyjz34sz4.cloudfront.net/` (SPA + `/api/v1/*` proxy live) · Backend API: `https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws/` |
| **Video Demo (≤3 Menit)** | ⏳ | Script siap: `docs/DEMO-SCRIPT.md` — rekam via YouTube/Vimeo |
| **Dokumentasi Tools** | ✅ | README + `docs/ARCHITECTURE.md` + `docs/COCKROACHDB-AGENT-READY.md` + `docs/MCP-STATUS.md` |

---

## Production Readiness Constraints

| Constraint | Alasan |
|---|---|
| **No raw media to backend** | Privacy: camera frames, audio PCM tetap on-device |
| **BYOK keys never leave device** | Security: API keys dienkripsi IndexedDB + WebCrypto |
| **Zero PII in LLM prompts** | Privacy: nama, email, phone tidak dikirim ke OpenRouter |
| **Crisis detection on-device** | Latency: regex lokal, tanpa network roundtrip |
| **Hard purge irreversible** | Compliance: user request = data hilang selamanya |
| **Auth token validation** | Security: setiap API call divalidasi |
| **Rate limiting** | Security: prevent abuse, DDoS protection |
| **Audit logging** | Compliance: semua mutation tercatat |

---

## Arsitektur

```
┌──────────────────────────────────────────────────────────────┐
│                     FRONTEND (React 19 + Vite)                │
│  - Zustand stores (cache, offline-first)                      │
│  - apiClient.ts → 11 endpoint /api/v1                         │
│  - On-device: face, audio, VAD, crisis detection              │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTPS (REST API, same-origin /api/v1)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│              AWS Lambda (Node.js 22) via Function URL         │
│  - 11 endpoint handlers (handler.ts + handlers/)              │
│  - Auth middleware (session token + device ID)                │
│  - Error handling + retry logic                               │
│  - Agentic memory loop: getMemoryContext (3-set RRF:          │
│    heuristik + keyword fulltext + vector) → SSE               │
│    injectedMemoryIds; reflection job tiap 6 jam               │
│    (EventBridge → reflect.ts) ekstrak durable facts dari      │
│    chat_turns, tulis memory_nodes kind=core verified +        │
│    embedding, lalu surface lagi via RRF di turn berikutnya    │
└───┬──────────────┬───────────────┬───────────────────────────┘
    │              │               │
    ▼              ▼               ▼
┌────────┐   ┌───────────┐   ┌──────────┐
│ Cockr  │   │ OpenRouter│   │    S3    │
│ oachDB │   │ (LLM+Emb) │   │ (export) │
│  ▲     │   └───────────┘   └──────────┘
│  │ (agent tooling, read-only)
│  └── CockroachDB Cloud Managed MCP + ccloud CLI + Agent Skills
└────────┘
```

---

## Struktur Project (Monorepo)

```
14-8-26-aws-x-coachroachdb-merge/
├── README.md                    # File ini (monorepo)
├── LICENSE                      # MIT License
├── .env.example                 # Template env (salin → .env)
│
├── src/                         # FRONTEND (React 19 + Vite 6 + TS)
│   ├── app/                     # App shell, router, layout
│   ├── features/                # auth, chat, crisis, memory, privacy, sessions
│   ├── shared/                  # apiClient, llmClient, metrics, stores, ui
│   ├── workers/                 # VAD, audio, face (on-device processing)
│   ├── main.tsx
│   └── vite-env.d.ts
├── package.json                 # Frontend deps (npm ci)
├── vite.config.ts
├── Dockerfile                   # Multi-stage build → nginx
├── docker-compose.yml
├── nginx.conf                   # SPA + CSP + proxy /api/v1
├── index.html
│
├── lambda/                      # BACKEND (TypeScript, Node 22)
│   ├── package.json             # Lambda dependencies
│   ├── tsconfig.json
│   ├── handler.ts               # Main Lambda handler (HTTP routes + EventBridge scheduled job)
│   ├── middleware/
│   │   └── auth.ts              # Auth validation middleware
│   ├── handlers/
│   │   ├── chatTurn.ts          # POST /chat/turn (3-set RRF retrieval + SSE)
│   │   ├── memory.ts            # GET/POST/DELETE /memory
│   │   ├── semanticSearch.ts    # GET /memory/semantic
│   │   ├── reflect.ts           # EventBridge scheduled reflection job
│   │   ├── session.ts           # GET/POST /session
│   │   ├── export.ts            # POST /export (S3)
│   │   ├── purge.ts             # POST /purge
│   │   └── health.ts            # GET /health, /metrics
│   └── lib/
│       ├── crdb.ts              # CockroachDB client (pg Pool)
│       ├── openrouter.ts        # OpenRouter client (LLM + embeddings)
│       ├── vectors.ts           # buildEmbeddingChunks, toVectorLiteral
│       ├── retrieval.ts         # reciprocalRankFusion (RRF)
│       ├── vectorWriter.ts      # writeNodeEmbedding (shared by memory + reflection)
│       ├── reflection.ts        # extractReflectionFacts, reflectUser, parseReflectionJson
│       └── s3.ts                # S3 client (presigned URLs)
│
├── schema/
│   ├── crdb-schema.sql          # CockroachDB DDL (12 tables + vector index + fulltext)
│   └── migration-*.sql          # Idempotent migrations (audit_events REFLECTION_RAN)
├── infra/                       # INFRASTRUCTURE (Terraform)
│   ├── main.tf / root.tf / backend.tf / outputs.tf / variables.tf
│   ├── modules/                 # apigw, budget, eventbridge, iam, lambda, ssm
│   ├── environments/hackathon.tfvars
├── scripts/                     # ccloud-bootstrap, ccloud-audit, setup-ssm-params, setup-cloudwatch, vector-health-check
├── mcp/
│   └── mcp-config.json          # CockroachDB Cloud Managed MCP (read-only)
├── .mcp.json                    # Claude Code / editor MCP config
├── skills/
│   └── cockroachdb-skills/      # Vendored Agent Skills repo (34 skills)
├── docs/                        # Architektur, MCP status, ADRs, audit docs
└── .github/
    └── workflows/
        ├── deploy.yml           # CI/CD + ccloud health gate
        └── vector-health.yml    # Scheduled vector coverage health check
```

---

## Quick Start

### 0. Environment

```bash
cp .env.example .env   # isi nilai asli (CRDB + ccloud API key + VITE_API_URL)
```

### 1. Frontend (dev)

```bash
npm install
npm run dev            # http://localhost:5173
```

### 2. Backend — Setup CockroachDB

```bash
bash scripts/ccloud-bootstrap.sh   # provision cluster + apply schema + MCP config
```

### 3. Backend — Lambda

```bash
cd lambda/
npm install
npm run build          # tsc
npx serverless deploy --stage prod   # ATAU pakai Terraform (lihat infra/README.md)
```

### 4. Backend — Infra (Terraform)

```bash
cd infra/
terraform init
terraform plan -var-file=environments/hackathon.tfvars
terraform apply -var-file=environments/hackathon.tfvars
```

### 5. Test

```bash
curl https://YOUR_FUNCTION_URL/api/v1/health
# Expected: {"status":"ok","crdb":"connected","llm":"available","s3":"available"}
```

### 6. Docker (opsional, full app)

```bash
docker compose up -d --build   # nginx:80, proxy /api/v1 ke Lambda
```

---

## API Contract (11 Endpoint, `/api/v1`)

| Method | Path | Deskripsi | Status Backend |
|---|---|---|---|
| POST | `/chat/turn` | Simpan chat turn + LLM response (SSE, RRF retrieval) | ✅ Live |
| GET | `/memory` | List memory nodes + edges | ✅ Live |
| POST | `/memory` | Upsert node/edge | ✅ Live |
| DELETE | `/memory/:id` | Delete node | ✅ Live |
| GET | `/memory/semantic` | Semantic search (vector index) | ✅ Live |
| POST | `/session` | Save session | ✅ Live |
| GET | `/sessions` | List sessions | ✅ Live |
| POST | `/export` | Mint export → S3 | ✅ Live |
| POST | `/purge` | Hard purge user data | ✅ Live |
| GET | `/metrics` | Metrics dari audit_events | ✅ Live |
| GET | `/health` | Health check | ✅ Live |

> Kontrak lengkap: `docs/BACKEND-CONTRACT.md`. Selain itu Lambda punya **scheduled job**
> (EventBridge `rate(6 hours)`, event `{source: agent.memory, detail-type: reflect}`)
> yang mengeksekusi refleksi memory (lihat `docs/ARCHITECTURE.md`).

---

## Hackathon Submission Checklist

- [x] CockroachDB sebagai persistent memory layer
- [x] CockroachDB Cloud Managed MCP Server (tool #1, read-only live)
- [x] Distributed Vector Indexing (tool #2, C-SPANN + hybrid RRF)
- [x] ccloud CLI (tool #3, provisioning + CI health gate)
- [x] Agent Skills Repo (tool #4, vendored 34 skills)
- [x] OpenRouter LLM + embeddings
- [x] AWS Lambda + S3 + EventBridge + CloudWatch
- [x] Functional Demo URL (frontend live via CloudFront + backend `/api/v1/health` OK)
- [ ] Video Demo ≤3 menit (script: `docs/DEMO-SCRIPT.md`)
- [x] Dokumentasi tools (README + docs/ARCHITECTURE.md + docs/MCP-STATUS.md)
- [x] Public repo + MIT License

---

## Production Roadmap (Setelah Lomba)

| Phase | Item | Priority |
|---|---|---|
| P0 | Multi-region CRDB (ap-southeast-3 + us-east-1) | High |
| P0 | OAuth2/OIDC auth (ganti session token) | High |
| P0 | Load testing (k6, 1000 concurrent users) | High |
| P1 | Datadog/Grafana monitoring | Medium |
| P1 | Automated backup + point-in-time recovery | Medium |
| P1 | WebLLM on-device (ganti OpenRouter fallback) | Medium |
| P2 | Multi-tenant support | Low |
| P2 | Custom domain + SSL | Low |
| P2 | SOC 2 compliance audit | Low |
