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

### 2. CockroachDB Tools (Pilih Minimal 2 dari 4) — WAJIB

| Tool | Status | Penggunaan |
|---|---|---|
| **CockroachDB Cloud Managed MCP Server** | ✅ WAJIB | AI agent query CRDB via MCP protocol |
| **CockroachDB Distributed Vector Indexing** | ✅ WAJIB | Semantic search / RAG untuk memory |
| ccloud CLI | ✅ Opsional | Cluster provisioning di CI/CD |
| CockroachDB Agent Skills Repo | ✅ Opsional | Automation scripts |

> **Catatan:** Repo sumber (`13-8-26-aws-x-coachroachdb-database`) berisi 133 agent skills
> (`.agents/`, `.claude/`, `.skills/`, `skills-lock.json`) yang **tidak ikut di-merge** ke
> monorepo ini. Jika dibutuhkan, salin dari repo sumber.

### 3. AWS Services (Pilih Minimal 1) — WAJIB

| Service | Status | Penggunaan |
|---|---|---|
| **AWS Lambda** | ✅ WAJIB | Serverless API handler |
| **Amazon S3** | ✅ WAJIB | Export bundle storage |
| **OpenRouter** | ✅ WAJIB | LLM inference (Llama free) + embeddings (bge-m3) |

### 4. Submission Requirements — WAJIB

| Item | Status | Detail |
|---|---|---|
| **Public Open-Source Repository** | ✅ | GitHub + MIT License |
| **Functional Demo App URL** | ⏳ | Deploy frontend + backend |
| **Video Demo (≤3 Menit)** | ⏳ | YouTube/Vimeo |
| **Dokumentasi Tools** | ✅ | README + docs/ di repo |

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
└───┬──────────────┬───────────────┬───────────────────────────┘
    │              │               │
    ▼              ▼               ▼
┌────────┐   ┌───────────┐   ┌──────────┐
│ Cockr  │   │ OpenRouter│   │    S3    │
│ oachDB │   │ (LLM+Emb) │   │ (export) │
└────────┘   └───────────┘   └──────────┘
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
│   ├── handler.ts               # Main Lambda handler (11 routes)
│   ├── middleware/
│   │   └── auth.ts              # Auth validation middleware
│   ├── handlers/
│   │   ├── chatTurn.ts          # POST /chat/turn
│   │   ├── memory.ts            # GET/POST/DELETE /memory
│   │   ├── semanticSearch.ts    # GET /memory/semantic
│   │   ├── session.ts           # GET/POST /session
│   │   ├── export.ts            # POST /export (S3)
│   │   ├── purge.ts             # POST /purge
│   │   └── health.ts            # GET /health, /metrics
│   └── lib/
│       ├── crdb.ts              # CockroachDB client (pg Pool)
│       ├── openrouter.ts        # OpenRouter client (LLM + embeddings)
│       └── s3.ts                # S3 client (presigned URLs)
│
├── schema/
│   └── crdb-schema.sql          # CockroachDB DDL (7 tables + vector index)
├── infra/                       # INFRASTRUCTURE (Terraform)
│   ├── main.tf / root.tf / backend.tf / outputs.tf / variables.tf
│   ├── modules/                 # apigw, budget, iam, lambda, ssm
│   ├── environments/hackathon.tfvars
│   ├── template.yaml            # SAM (alternatif, legacy)
│   └── serverless.yml           # Serverless Framework (legacy)
├── scripts/                     # ccloud-bootstrap, setup-ssm-params, setup-cloudwatch
├── mcp/
│   └── mcp-config.json          # CockroachDB MCP Server config
├── docs/                        # 13 docs (frontend + backend)
├── reverse-prompt-aws-cockroachdb.md
└── .github/
    └── workflows/
        └── deploy.yml           # CI/CD pipeline
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
| POST | `/chat/turn` | Simpan chat turn + LLM response | ⏳ Stub |
| GET | `/memory` | List memory nodes + edges | ⏳ Stub |
| POST | `/memory` | Upsert node/edge | ⏳ Stub |
| DELETE | `/memory/:id` | Delete node | ⏳ Stub |
| GET | `/memory/semantic` | Semantic search (vector index) | ⏳ Stub |
| POST | `/session` | Save session | ⏳ Stub |
| GET | `/sessions` | List sessions | ⏳ Stub |
| POST | `/export` | Mint export → S3 | ⏳ Stub |
| POST | `/purge` | Hard purge user data | ⏳ Stub |
| GET | `/metrics` | Metrics dari audit_events | ⏳ Stub |
| GET | `/health` | Health check | ✅ |

> Kontrak lengkap: `docs/BACKEND-CONTRACT.md`

---

## Hackathon Submission Checklist

- [x] CockroachDB sebagai persistent memory layer
- [x] CockroachDB Cloud MCP Server (tool #1)
- [x] Distributed Vector Indexing (tool #2)
- [x] OpenRouter LLM + embeddings (AWS-agnostic inference)
- [x] AWS Lambda (AWS service #1)
- [x] Amazon S3 (AWS service #2)
- [ ] Functional Demo App URL (deploy frontend + backend)
- [ ] Video Demo ≤3 menit (YouTube/Vimeo)
- [x] Dokumentasi tools (README + docs/)
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
