# 🪳 CockroachDB × AWS Hackathon — CONSTRAINTS

> **Challenge:** Build an agentic application that uses CockroachDB as its persistent memory layer, deployed on AWS  
> **Deadline:** 18-19 Agustus 2026  
> **Prizes:** $8,750 USD ($5,000 / $2,500 / $1,250)  
> **License:** MIT (detectable di repository)  
> **Frontend:** https://github.com/noiz354/fe-aws-x-coachroach-26  
> **Backend:** repo ini  

---

## WHY AGENTIC MEMORY? WHY NOW?

AI agents are rapidly moving from experiments into real production workflows. But here's the problem: **agents need memory that never goes down**.

An agent whose memory goes offline doesn't degrade gracefully — it stops. Traditional databases were optimized for human-scale reads and writes. Agentic systems are different: they spawn autonomously, write constantly, and require memory that persists across regions, failures, and scale (with zero data loss and no maintenance windows).

**CockroachDB was built for exactly this.** It is the system of record for agentic memory: globally distributed, always-on, PostgreSQL-compatible, and now natively integrated into the agent toolchain through MCP, ccloud, and an open-source skills ecosystem.

> **This hackathon is your invitation to build on that foundation.**

---

## JUDGING CRITERIA

Agent harus mampu:
1. **Store** — Persist memory (conversation history, user context, task state, embeddings, structured transactional data)
2. **Retrieve** — Fetch relevant memory on demand
3. **Act** — Use memory to make decisions, not just echo back

**Best submissions demonstrate that memory is not an afterthought — it is the thing that makes an agent useful in production.**

---

## SUBMISSION REQUIREMENTS

### WAJIB: CockroachDB Tools (minimal 2 dari 4)

| # | Tool | Status | Bukti |
|---|---|---|---|
| 1 | **CockroachDB Cloud Managed MCP Server** | ✅ WAJIB | `mcp/mcp-config.json` — endpoint: `https://cockroachlabs.cloud/mcp` |
| 2 | **Distributed Vector Indexing** | ✅ WAJIB | `schema/crdb-schema.sql` — pgvector + ivfflat index |
| 3 | ccloud CLI (Agent-Ready) | ⏳ Opsional | Provisioning, backups, networking, audit logs |
| 4 | Agent Skills Repo (Open Source) | ⏳ Opsional | 133 skills ter-install di `.agents/skills/` |

### WAJIB: AWS Services (minimal 1)

| Service | Status | Bukti |
|---|---|---|
| **OpenRouter** | ✅ WAJIB | `lambda/lib/openrouter.ts` — LLM (openrouter/free) + embeddings (bge-m3) |
| **AWS Lambda** | ✅ WAJIB | `lambda/handler.ts` + `infra/` (Terraform) |
| **Amazon S3** | ✅ WAJIB | `lambda/lib/s3.ts` — export storage |

### WAJIB: Artifacts

| Item | Status | Lokasi |
|---|---|---|
| **Public Open-Source Repo** | ✅ | Repo ini + MIT License |
| **README + Setup Instructions** | ⏳ | Harus lengkap |
| **Functional Demo App URL** | ⏳ | Deploy frontend + backend |
| **Video Demo (< 3 menit)** | ⏳ | YouTube/Vimeo, public |
| **Identifikasi Tools Used** | ⏳ | Di README + video |
| **Architectural Diagram** | ⏳ | Optional |

---

## PRIZES

| Position | Cash | Extras |
|----------|------|--------|
| 🥇 1st Place | $5,000 USD | Blog feature + Cockroach Labs Swag |
| 🥈 2nd Place | $2,500 USD | Cockroach Labs Swag |
| 🥉 3rd Place | $1,250 USD | Cockroach Labs Swag |

---

## PROJECT SCOPE

**Folder ini KHUSUS untuk CockroachDB database layer saja.**
- Schema design, vector indexing, memory lifecycle
- SQL patterns: decay, promotion, recall ranking
- MCP Server integration
- Cost control ($0 free tier protection)

AWS deployment, Lambda, S3, dll ada di folder `infra/` dan `lambda/`.

---

## Hackathon Rules (WAJIB — tidak bisa dinegosiasikan)

### 1. CockroachDB sebagai Persistent Memory Layer

- Semua data user HARUS disimpan di CockroachDB
- Tidak boleh hanya localStorage, file-based, atau in-memory
- Data harus survive restart/crash

### 2. CockroachDB Tools — Minimal 2 dari 4

| Tool | Status | Bukti |
|---|---|---|
| **CockroachDB Cloud Managed MCP Server** | ✅ WAJIB | `mcp/mcp-config.json` |
| **Distributed Vector Indexing** | ✅ WAJIB | `schema/crdb-schema.sql` (pgvector + ivfflat index) |
| ccloud CLI | ⏳ Opsional | Digunakan di CI/CD untuk provisioning |
| Agent Skills Repo | ⏳ Opsional | Belum dipakai |

### 3. AWS Services — Minimal 1 dari List

| Service | Status | Bukti |
|---|---|---|
| **OpenRouter** | ✅ WAJIB | `lambda/lib/openrouter.ts` (LLM + embeddings) |
| **AWS Lambda** | ✅ WAJIB | `lambda/handler.ts` + `infra/` (Terraform) |
| **Amazon S3** | ✅ WAJIB | `lambda/lib/s3.ts` (export storage) |

### 4. Submission Artifacts

| Item | Status | Lokasi |
|---|---|---|
| **Public Open-Source Repo** | ✅ | Repo ini + MIT License |
| **Functional Demo App URL** | ⏳ | Deploy frontend + backend |
| **Video Demo (≤3 Menit)** | ⏳ | YouTube/Vimeo |
| **Dokumentasi Tools** | ✅ | README.md + docs/ |

---

## Production Readness Constraints (TIDAK Boleh Dikorbankan)

### Privacy & Security

| Constraint | Alasan | Implementasi |
|---|---|---|
| **No raw media to backend** | Zero-cloud privacy | Frontend: camera/audio stay on-device |
| **BYOK keys encrypted** | XSS = key theft jika plain | IndexedDB + WebCrypto AES-GCM-256 |
| **No PII in LLM prompts** | GDPR/privacy compliance | Hanya text content, tanpa nama/email |
| **Crisis detection on-device** | Latency-critical | Regex lokal, <1ms response |
| **Hard purge irreversible** | User consent compliance | DELETE CASCADE di semua tabel |
| **Auth token validation** | Unauthorized access | Middleware di setiap endpoint |
| **Rate limiting** | Abuse prevention | API Gateway throttling |
| **Audit logging** | Compliance requirement | Semua mutation → audit_events |

### Reliability

| Constraint | Target | Implementasi |
|---|---|---|
| **Health check** | /api/v1/health returns 200 | CRDB + LLM (OpenRouter) + S3 check |
| **Error handling** | 5xx < 1% | Try/catch + graceful fallback |
| **Timeout** | <30s per request | Lambda timeout 30s |
| **Connection pooling** | Max 10 connections/pg | pg.Pool dengan idle timeout |
| **Idempotency** | No duplicate records | UNIQUE constraints + idempotent writes |

### Data Integrity

| Constraint | Target | Implementasi |
|---|---|---|
| **Foreign keys** | CASCADE delete | ON DELETE CASCADE di semua tabel |
| **Check constraints** | Valid data only | CHECK (weight >= 0 AND <= 1), dll |
| **Unique constraints** | No duplicates | UNIQUE (source, target) di edges |
| **Vector index** | Cosine similarity | pgvector(1024) + ivfflat |
| **Indexes** | Query performance | 20+ indexes untuk common queries |

---

## Yang Dikorbankan untuk Lomba (Production Fix Nanti)

| Item | Sekarang | Production Fix | Timeline |
|---|---|---|---|
| Auth | Session token sederhana | OAuth2/OIDC + JWT | P0 |
| Region | ap-southeast-3 only | Multi-region (ap-southeast-3 + us-east-1) | P0 |
| Load testing | Asumsi <100 users | k6 test 1000+ users | P0 |
| Monitoring | CloudWatch logs | Datadog/Grafana | P1 |
| Backup | CRDB automated | Point-in-time recovery | P1 |
| On-device LLM | OpenRouter only | WebLLM fallback | P1 |

---

## API Contract Summary

11 endpoints, semua documented di `docs/BACKEND-CONTRACT.md`:

| Method | Path | Handler | Status |
|---|---|---|---|
| POST | `/chat/turn` | chatTurn.ts | ⏳ Stub |
| GET | `/memory` | memory.ts | ⏳ Stub |
| POST | `/memory` | memory.ts | ⏳ Stub |
| DELETE | `/memory/:id` | memory.ts | ⏳ Stub |
| GET | `/memory/semantic` | semanticSearch.ts | ⏳ Stub |
| POST | `/session` | session.ts | ⏳ Stub |
| GET | `/sessions` | session.ts | ⏳ Stub |
| POST | `/export` | export.ts | ⏳ Stub |
| POST | `/purge` | purge.ts | ⏳ Stub |
| GET | `/metrics` | health.ts | ⏳ Stub |
| GET | `/health` | health.ts | ✅ Implemented |

---

## Database Schema Summary

7 tables + 3 views + pgvector extension:

| Table | Rows (est) | Size (est) | Indexes |
|---|---|---|---|
| users | 1,000 | ~100KB | 2 |
| memory_nodes | 50,000 | ~10MB | 5 |
| memory_edges | 100,000 | ~8MB | 5 |
| embeddings | 50,000 | ~200MB (vector) | 4 |
| sessions | 10,000 | ~2MB | 4 |
| chat_turns | 500,000 | ~100MB | 4 |
| audit_events | 100,000 | ~10MB | 3 |

**Total estimated:** ~320MB for 1,000 users × 50 sessions each

---

## Next Steps

1. **Setup CRDB cluster** → `ccloud cluster create`
2. **Run schema** → `ccloud sql -f schema/crdb-schema.sql`
3. **Enable MCP** → `ccloud mcp create`
4. **Deploy Lambda** → `cd lambda && npm install && npx serverless deploy`
5. **Test health** → `curl https://API_URL/api/v1/health`
6. **Implement handlers** → Replace stubs dengan logic lengkap
7. **Video demo** → Rekrut 3 menit, upload ke YouTube
