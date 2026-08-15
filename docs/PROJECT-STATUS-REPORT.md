# Project Status Report — CBT Memory Agent × CockroachDB × AWS

> Status: 2026-08-16. Semua klaim diverifikasi dari kode (file/function spesifik) dan live deployment.

## 1. What the application does and its core purpose

**CBT Memory Agent** is an on-device cognitive-behavioral-therapy (CBT) workspace. The core premise: the app is a *memory-first AI therapy companion* where **persistent memory is the product**. Users talk to an AI assistant; every conversation turn, session, and insight is stored as structured memory in CockroachDB and retrieved — via a hybrid retrieval loop — to make future responses *personalized to that user's history*.

Built as an entry for the **CockroachDB × AWS Agent Challenge 2026** (hackathon requirement: agentic app using CockroachDB as persistent memory on AWS, using ≥2 of 4 CRDB tools + ≥1 AWS service). All 4 CRDB tools are now active: Managed MCP Server, Distributed Vector Indexing, ccloud CLI, and the Agent Skills repo.

Key domain guardrails (per `README.md` + `CONSTRAINTS.md`): no raw media to backend, BYOK keys never leave device, zero PII in LLM prompts, on-device crisis detection, hard purge irreversible, auth validation, rate limiting, audit logging.

## 2. Current tech stack

| Layer | Tech |
|---|---|
| **Frontend** | React 19 + Vite 6 + TypeScript 5.9, Zustand 5, Tailwind CSS 4, framer-motion, @dnd-kit, react-router 7, react-markdown + KaTeX, TanStack virtual |
| **On-device AI/ML** | WebLLM (@mlc-ai/web-llm), @huggingface/transformers, onnxruntime-web, MediaPipe tasks-vision (face), Web Audio + VAD (voice), Web Speech |
| **Backend** | Node 22 TypeScript on AWS Lambda, zod, `pg` (node-postgres) |
| **Database** | CockroachDB Cloud Serverless (`woozy-grivet`, v26.2.5, ap-southeast-3) with pgvector `vector(1024)` + C-SPANN vector index + GIN full-text inverted index |
| **LLM/embeddings** | OpenRouter (`openrouter/free` = Llama 3.3 70B free, `baai/bge-m3` embeddings 1024-dim) |
| **Infra** | Terraform, AWS Lambda Function URL, S3, EventBridge, CloudWatch, SSM Parameter Store, AWS Budgets |
| **Observability** | OpenTelemetry (traces/metrics/logs → Grafana Cloud OTLP), CloudWatch dashboards |
| **Auth** | Session tokens; magic-link via Resend email (dev preview fallback), legacy device-id |
| **CI/CD** | GitHub Actions (deploy.yml + vector-health.yml) |
| **Tests** | Vitest (99 tests, lambda backend), tsc typecheck |

## 3. Project structure and architecture overview

Monorepo (merged from separate database + frontend repos):
- `src/` — React frontend: `features/{auth,chat,crisis,memory,metrics,privacy,sessions}`, `shared/lib` (apiClient, llmClient, byokKeyManager, onDeviceLLM), `workers/` (audio/face/transcribe/vad)
- `lambda/` — backend: `handler.ts` (router), `handlers/` (15 handlers), `lib/` (crdb, openrouter, vectors, retrieval, reflection, vectorWriter, analytics, monetization, telemetry, s3, logger, eventCatalog), `middleware/auth.ts`, `tests/`
- `schema/` — DDL + 6 idempotent migrations
- `infra/` — Terraform root + modules (apigw, budget, eventbridge, iam, lambda, ssm) + Grafana dashboards
- `scripts/` — provisioning (ccloud-bootstrap/auth/audit), setup (ssm-params, cloudwatch, grafana-provision), data tools (backfill-embeddings, load-test-vectors, seed-monetization), health checks
- `skills/cockroachdb-skills/` — vendored Agent Skills repo (34 skills)
- `docs/` — ADRs, specs, audits, MCP-STATUS, COCKROACHDB-AGENT-READY, ARCHITECTURE, DEMO-SCRIPT
- `mcp/` + `.mcp.json` — Managed MCP config

Full architecture diagrams (mermaid) are in `docs/ARCHITECTURE.md`.

## 4. What's implemented and working

**Backend (all 18 routes live, verified via `/api/v1/health`):** chat turn (SSE), memory CRUD + edge delete, semantic search, sessions + turns, export→S3, hard purge, metrics, events, monetization (CAC/summary), analytics (funnel/activity/retention), auth (magic-link), telemetry relay. 99/99 tests green.

**Vector + retrieval stack (the flagship):** hybrid 3-set RRF retrieval in `chatTurn.ts:getMemoryContext` (heuristic weight + full-text `to_tsvector @@ plainto_tsquery` + vector cosine via derived-table C-SPANN search), writer embeddings on upsert (`vectorWriter.ts`), 2000-char chunking with overlap, prefix `(user_id, embedding vector_cosine_ops)` index, idempotent backfill, EXPLAIN-verified `vector search` operator at 10k rows.

**Agentic memory loop (WS-D):** EventBridge `rate(6 hours)` → `reflect.ts`/`reflection.ts` → LLM distills durable facts from last 7 days of turns → upserts `kind=core verified=true` nodes (deterministic md5 id, ref_count++ on conflict) + embeddings + `REFLECTION_RAN` audit. Facts auto-surface in later turns via the verified+confidence filter. Explicit recall: SSE meta event `injectedMemoryIds` + `memory.recalled_titles` span. **Verified live:** 3 facts created, idempotent re-run.

**CockroachDB tooling (all 4):** Managed MCP read-only live (9 tools, proofs in `docs/15-8-26/mcp-proof/`), Distributed Vector Indexing, ccloud CLI (audit script 6/6 PASS, CI health gate), Agent Skills vendored.

**Observability:** OTel spans (`db.query`, `llm.*`, `agent.memory.*`), RED metrics, traceparent propagation, X-Trace-Id header, 3 Grafana dashboards (analytics, monetization, vector), automated `vector-health-check.ts`.

**Frontend:** auth/onboarding, chat with streaming + memory rail, crisis suite (real end-to-end: crisis fusion multimodal scoring, 4-7-8 breathing, grounding game, binaural audio, swipe-to-call), memory graph canvas (dnd-kit, kanban-sessions), privacy (BYOK WebCrypto AES-GCM, export bundle→S3, hard purge), sessions timeline/compare, metrics, dark/light theme.

## 5. Incomplete / missing / TODO

From `docs/15-8-26/AUDIT.md`, `WORK-LIST.md`, and inspection:

1. **Video demo** — the last open submission checklist item (script ready in `docs/DEMO-SCRIPT.md`).
2. **`ALLOWED_ORIGIN` still `*`** in tfvars (`handler.ts:317` fail-loud warning; no strict CORS, no rate limiting).
3. **Passkey is PARTIAL** — `navigator.credentials.get()` never called (`passkey.ts`), so no real login ceremony; fallback mints random hex.
4. **PersonalizedVault is STUB** — goals stored plaintext in localStorage, no encryption/vault artifact.
5. **Privacy copy MISLEADING** — UI claims "never leaves device" while data is uploaded (`AuthShell.tsx:6`).
6. **SessionTable/privacyStore uses FAKE seed data** — "Clinic iPad", etc.; no backend device registry.
7. **`/purge` doesn't write `HARD_PURGE` to `audit_events`** (noted in AUDIT §7).
8. **Dead code**: `metrics.ts` 7 unused wrappers, `coreMemories()` (memoryStore.ts:347), `nodeScale()` (types.ts:43); several sync failures swallowed with `console.warn`.
9. **Server-backed magic-link (Resend)** is written but *live deployment not verified* (`RESEND_API_KEY` + `auth_tokens`/`session_token` schema — Phase C pending on live).
10. **Auth fallback still accepts legacy non-DB tokens** (`middleware/auth.ts:53-54`).
11. **CRDB_CLUSTER_NAME secret not in GitHub** (audit falls back to default).
12. **Production roadmap** (README): multi-region, OIDC, load testing, WebLLM replacement of fallback, backups, multi-tenant — all post-hackathon.
13. Frontend test coverage: none (Vitest only on lambda backend).

## 6. End-to-end data flow

```
User → Frontend (React, on-device: VAD/face/crisis detection)
     → apiClient (Bearer token + X-Device-Id) → POST /api/v1/chat/turn
     → Lambda handler.ts → auth middleware (validateAuth: session_token lookup)
     → handleChatTurn:
         upsertUser (md5(token)::uuid deterministic)
         getMemoryContext → 3-set RRF (heuristic + to_tsvector + vector) from CockroachDB
         build CBT prompt (system guardrails + memory context, NO PII)
         llm.streamChat → OpenRouter SSE → relayed as SSE {t:...} + meta {injectedMemoryIds}
         save chat_turns (user+assistant) + upsert session
     → Every 6h: EventBridge {source:agent.memory,detail-type:reflect} → handler detects
         scheduled event → handleReflect → active users → last 20 turns → LLM chat()
         → upsert memory_nodes (core/verified) + embeddings + audit REFLECTION_RAN
     → Next turn: reflection facts automatically surface via RRF filter
```

Memories created via `POST /memory` go through `vectorWriter.writeNodeEmbedding` (DELETE old + INSERT chunked embeddings). Exports: `POST /export` → S3 AES256 → presigned URL (24h). Purge: confirmation-gated per-user cascade DELETE.

## 7. AWS services integrated

- **Lambda** (Function URL `https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws/`) — all API + scheduled reflection (Node 22, 300s timeout, env from SSM)
- **S3** — export bucket `cbt-memory-exports` (presigned URLs via `@aws-sdk/s3-request-presigner`)
- **EventBridge** — `cbt-memory-agent-reflect` rule (rate 6h) → Lambda, with `aws_lambda_permission`
- **SSM Parameter Store** — `/hackathon/*` SecureStrings (CRDB URL, ccloud key, OpenRouter key, Resend key, Grafana OTLP)
- **CloudWatch** — logs (`/aws/lambda/cbt-memory-agent`), dashboard `CBTMemoryAgent`, health gate in CI
- **IAM** — Lambda role with scoped policies (SSM GetParameter, S3, logs)
- **AWS Budgets** — spend guardrail
- **CI**: GitHub Actions `deploy.yml` (typecheck/test → ccloud audit → build zip → terraform apply) + `vector-health.yml` (cron)

## 8. Database integration

CockroachDB Cloud Serverless via `pg.Pool` in `lambda/lib/crdb.ts` (single instrumentation point: `db.query` OTel span + RED metrics + `extractTable`). 12 tables: users, auth_tokens, memory_nodes, memory_edges, embeddings, sessions, chat_turns, audit_events, user_events, subscriptions, marketing_ad_spend (+ views). Vector: `CREATE VECTOR INDEX embeddings_vector_idx ON embeddings (user_id, embedding vector_cosine_ops)` (C-SPANN, per-user tree). Full-text: expression `CREATE INVERTED INDEX memory_nodes_search_idx` (GIN, `to_tsvector('english', title || ' ' || COALESCE(excerpt,''))`). Discovered CRDB constraints: no dynamic `EXECUTE`, no `make_interval` (use `now() - INTERVAL '1 day' * n`), STORED computed columns reject context-dependent expressions, `plainto_tsquery` not constant-folded in standalone EXPLAIN but works via custom plans. Admin tooling: Managed MCP (read-only), ccloud CLI, psql.

## 9. AI/LLM integrations

- **OpenRouter chat** (`lambda/lib/openrouter.ts`): `openrouter/free` streaming + non-streaming `chat()` (used by reflection), `healthCheck` via `/credits`, 1024 max tokens.
- **OpenRouter embeddings**: `baai/bge-m3` 1024-dim, 8000-char slice, strict dimension check; used in chat retrieval + memory upsert + reflection.
- **Frontend LLM**: `llmClient.ts` unified fallback chain on-device WebLLM → backend proxy (SSE) → BYOK (24 providers via IndexedDB+WebCrypto, OpenAI/Anthropic/Gemini formats); crisis fusion scoring (text×0.5 + prosody×0.3 + face×0.2); on-device Whisper transcription.
- **Agentic memory**: reflection prompt (max 8 facts, no PII, no fabrication) with JSON best-effort parsing (`parseReflectionJson` with regex fallbacks + confidence clamping).

## 10. Overall completeness assessment

**~90% complete for the hackathon submission; ~75% as a production-ready product.**

- **Submission requirements: ~95%** — 4/4 CRDB tools live & verified, AWS services done, MIT license, public repo, backend URL live, README/docs complete, demo script ready. Only the **video recording** remains (a human task).
- **Backend: ~95%** — all endpoints real, 99/99 tests, live-deployed, observability wired. Gaps: strict CORS/rate-limiting, hard-purge audit write, legacy token fallback, magic-link live verification.
- **Frontend: ~75%** — rich feature set, but parts remain stubs/fake (passkey ceremony, PersonalizedVault, device registry seed data), dead code, no frontend tests, some privacy copy inaccurate.
- **Agentic memory loop (newest): fully functional and live-verified**, including idempotency.

The strongest, most complete parts are the **backend + vector retrieval + observability** (the hackathon's focus). The weakest are **polish items around auth, privacy accuracy, and frontend test coverage** — plus the final video deliverable.
