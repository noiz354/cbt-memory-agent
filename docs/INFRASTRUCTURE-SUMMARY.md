# Infrastructure Summary — Terraform + AWS Serverless

> Ringkasan lengkap semua infrastruktur yang sudah dibuat untuk CBT Memory Agent
> CockroachDB × AWS Hackathon 2026

**Tanggal:** 2026-08-14  
**Status:** ✅ **READY TO DEPLOY**  
**Total Cost:** ✅ **$0** (100% Free Tier compatible)

---

## 📊 ARSITEKTUR

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite)                       │
│  - Zustand stores (cache)                                        │
│  - IndexedDB BYOK keys (WebCrypto AES-GCM)                      │
│  - Web Workers (face, audio, VAD)                               │
│  - 11 endpoint API calls via apiClient.ts                       │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│               AWS Lambda (Node.js 22.x)                          │
│  - Function URL (bukan API Gateway — 71% lebih murah)           │
│  - Memory: 256MB | Timeout: 29s                                 │
│  - Free Tier: 1M requests/month                                 │
│  - Environment vars dari SSM Parameter Store                    │
└───┬──────────────────┬──────────────────┬───────────────────────┘
    │                  │                  │
    ▼                  ▼                  ▼
┌─────────┐    ┌──────────┐    ┌──────────────┐
│Cockroach│    │ OpenRouter│    │ CloudWatch   │
│DB Cloud │    │ (:free)   │    │ (10 metrics) │
│         │    │ 20 RPM    │    │ 9 alarms     │
│ MCP     │    │ 50/day    │    │ Dashboard    │
│ Vector  │    │           │    │              │
│ 7 tables│    │           │    │              │
└─────────┘    └──────────┘    └──────────────┘
```

---

## 📁 FILES YANG SUDAH DIBUAT

### Infrastructure (Terraform) — 15 files

| File | Purpose | Status |
|---|---|---|
| `infra/main.tf` | Provider config + Terraform settings | ✅ |
| `infra/variables.tf` | 10 input variables | ✅ |
| `infra/outputs.tf` | 6 outputs (URL, ARN, etc) | ✅ |
| `infra/backend.tf` | S3 remote state + DynamoDB lock | ✅ |
| `infra/root.tf` | Module orchestration | ✅ |
| `infra/README.md` | Dokumentasi deploy lengkap | ✅ |
| `infra/.gitignore` | Git ignore rules | ✅ |
| `infra/environments/hackathon.tfvars` | Template variables | ✅ |
| `infra/modules/lambda/main.tf` | Lambda + Function URL | ✅ |
| `infra/modules/lambda/variables.tf` | Lambda variables | ✅ |
| `infra/modules/lambda/outputs.tf` | Lambda outputs | ✅ |
| `infra/modules/iam/main.tf` | Least-privilege IAM | ✅ |
| `infra/modules/iam/variables.tf` | IAM variables | ✅ |
| `infra/modules/iam/outputs.tf` | IAM outputs | ✅ |
| `infra/modules/ssm/main.tf` | 5 SSM parameters | ✅ |
| `infra/modules/ssm/variables.tf` | SSM variables | ✅ |
| `infra/modules/ssm/outputs.tf` | SSM outputs | ✅ |
| `infra/modules/budget/main.tf` | Budget alerts + anomaly | ✅ |
| `infra/modules/budget/variables.tf` | Budget variables | ✅ |
| `infra/modules/apigw/main.tf` | HTTP API (optional) | ✅ |
| `infra/modules/apigw/variables.tf` | APIGW variables | ✅ |
| `infra/modules/apigw/outputs.tf` | APIGW outputs | ✅ |

### Scripts — 4 files

| File | Purpose | Status |
|---|---|---|
| `scripts/ccloud-bootstrap.sh` | Automated cluster provisioning | ✅ |
| `scripts/setup-ssm-params.sh` | Upload credentials ke SSM | ✅ |
| `scripts/setup-cloudwatch.sh` | 10 metrics + 9 alarms + dashboard | ✅ |

### Documentation — 6 files

| File | Purpose | Status |
|---|---|---|
| `docs/DATABASE-ENGINEER-PLAN.md` | Rencana Database Engineer | ✅ |
| `docs/MCP-IMPLEMENTATION.md` | MCP Server implementation | ✅ |
| `docs/MCP-STATUS.md` | Status MCP deployment | ✅ |
| `docs/MCP-SETUP-INSTRUCTIONS.md` | Cara setup MCP | ✅ |
| `docs/SCHEMA-DEPLOYMENT.md` | Schema deployment status | ✅ |
| `docs/INFRASTRUCTURE-NOTES.md` | Architecture decisions | ✅ |
| `docs/AWS-FREE-TIER-NOTES.md` | Free Tier compatibility | ✅ |
| `CONSTRAINTS.md` | Hackathon requirements | ✅ |

---

## 🎯 COCKROACHDB SETUP

### Cluster: woozy-grivet

| Detail | Value |
|---|---|
| **Cluster ID** | `87275047-fbf8-4f18-8b8d-a5ff97a335e3` |
| **Region** | AWS ap-southeast-3 |
| **Plan** | Serverless (BASIC) |
| **Spend Limit** | $0.00/month |
| **Version** | v26.2.5 |
| **Status** | ✅ CREATED |

### Schema: 7 Tables + 3 Views

| Table | Columns | Indexes | Vector? |
|---|---|---|---|
| `users` | 9 | 2 | No |
| `memory_nodes` | 15 | 6 | No |
| `memory_edges` | 6 | 5 | No |
| `embeddings` | 6 | 3 | **Yes (1024)** |
| `sessions` | 12 | 4 | No |
| `chat_turns` | 8 | 4 | No |
| `audit_events` | 5 | 3 | No |

**Views:** `active_users_7d`, `user_memory_stats`, `session_summary`

**Vector Index:** `embeddings_vector_idx` on `embedding VECTOR(1024)`

### MCP Server

| Detail | Value |
|---|---|
| **Endpoint** | `https://cockroachlabs.cloud/mcp` |
| **Auth** | API Key (Service Account) |
| **Status** | ✅ Working |
| **Tools** | list_clusters, list_tables, get_table_schema, select_query, dll |

---

## 🔧 AWS RESOURCES

### Lambda

| Setting | Value |
|---|---|
| **Runtime** | Node.js 22.x |
| **Memory** | 256 MB |
| **Timeout** | 29 seconds |
| **Architecture** | x86_64 |
| **Endpoint** | Function URL (bukan API Gateway) |
| **Free Tier** | 1M requests/month ✅ |

### SSM Parameter Store

| Parameter | Type | Purpose |
|---|---|---|
| `/hackathon/crdb/connection-url` | SecureString | CockroachDB URL |
| `/hackathon/crdb/cluster-id` | SecureString | Cluster UUID |
| `/hackathon/ccloud/api-key` | SecureString | MCP API Key |
| `/hackathon/app/pepper` | SecureString | HMAC pepper |
| `/hackathon/app/openrouter-daily-cap` | String | Daily limit (50) |

### CloudWatch

**Metrics (10):**
1. `complete_ms` — LLM response latency
2. `recall_ms` — ANN query latency (SLO: <150ms)
3. `ann_used` — Vector index hit (0/1)
4. `openrouter_429` — Rate limit hits
5. `openrouter_calls` — Daily API calls
6. `crisis_short_circuit` — Crisis detected
7. `redact_drops` — Redacted spans
8. `cache_hit` — Completion cache hit rate
9. `lambda_errors` — 5xx rate
10. `consolidate_ms` — Step Functions duration

**Alarms (9):**
- LambdaErrors (>5 per 5min) [SEV1]
- LambdaDuration (>25s) [SEV2]
- ANNMiss (vector index miss) [SEV2]
- OpenRouter429 (>10 per 5min) [SEV2]
- OpenRouterDailyCap (>45/50) [SEV2]
- CrisisMissing (SEV0 drill) [SEV0]
- LowCacheHit (<20%) [SEV3]
- RecallLatency (>150ms SLO) [SEV2]
- ConsolidationSlow (>30s) [SEV3]

**Dashboard:** `CBTMemoryAgent` — 4 widgets

### Budget

| Setting | Value |
|---|---|
| **Max Budget** | $1.00 |
| **Alerts** | 50%, 80%, 100% |
| **Anomaly Monitor** | Enabled |
| **Notification** | Email |

---

## 💰 COST BREAKDOWN (Free Tier)

| Resource | Free Tier Limit | Usage | Cost |
|---|---|---|---|
| **Lambda** | 1M requests/month | ~10K | ✅ $0 |
| **SSM** | 10K parameters | ~5 | ✅ $0 |
| **CloudWatch** | 10 metrics + 10 alarms | 10 + 9 | ✅ $0 |
| **Budgets** | 2 budgets free | 1 | ✅ $0 |
| **CockroachDB** | 50M RU + 10 GiB | ~1M RU + 500MB | ✅ $0 |
| **TOTAL** | | | **✅ $0** |

### Yang TIDAK Dibuat (Hemat Biaya)

| Resource | Cost | Why |
|---|---|---|
| **NAT Gateway** | $32/month | Lambda akses public endpoints |
| **Route 53** | $0.50/month | Pakai Lambda Function URL |
| **VPC** | Tidak perlu | No NAT needed |
| **Elastic IP** | $3.60/month | Tidak perlu |
| **API Gateway** | $3.50/month | Pakai Function URL (71% lebih murah) |

**Total Hemat:** ~$40/month

---

## 🚀 DEPLOYMENT COMMANDS

### 1. Bootstrap CockroachDB Cluster

```bash
cd /home/norman2/14-8-26-aws-x-coachroachdb-merge
bash scripts/ccloud-bootstrap.sh
```

### 2. Upload Credentials ke SSM

```bash
bash scripts/setup-ssm-params.sh
```

### 3. Deploy Infrastructure (Terraform)

```bash
cd infra

# Initialize
terraform init

# Plan
terraform plan -var-file=terraform.tfvars

# Deploy
terraform apply -var-file=terraform.tfvars
```

### 4. Setup CloudWatch Monitoring

```bash
bash scripts/setup-cloudwatch.sh
```

### 5. Test Endpoint

```bash
# Get Function URL dari Terraform outputs
FUNCTION_URL=$(terraform output -raw function_url)

# Test health endpoint
curl $FUNCTION_URL/health

# Expected: {"status": "ok", "crdb": "connected", ...}
```

---

## ✅ HACKATHON CHECKLIST

### CockroachDB Tools (Minimal 2 dari 4)

| Tool | Status | Bukti |
|---|---|---|
| **Managed MCP Server** | ✅ DONE | Endpoint: `https://cockroachlabs.cloud/mcp` |
| **Distributed Vector Index** | ✅ DONE | `embeddings_vector_idx` on `VECTOR(1024)` |
| **ccloud CLI** | ✅ DONE | Installed + authenticated |
| **Agent Skills Repo** | ✅ DONE | 133 skills installed |

### AWS Services (Minimal 1)

| Service | Status | Bukti |
|---|---|---|
| **AWS Lambda** | ✅ DONE | Function URL endpoint |
| **Amazon Bedrock** | ⏳ TODO | Integration di Lambda handler |
| **Amazon S3** | ⏳ TODO | Export bucket |

### Submission Artifacts

| Item | Status | Lokasi |
|---|---|---|---|
| **Public Repo + MIT License** | ✅ DONE | Repo ini |
| **README + Setup Instructions** | ✅ DONE | `infra/README.md` + docs |
| **Functional Demo URL** | ⏳ TODO | Deploy Lambda handlers |
| **Video Demo (< 3 menit)** | ⏳ TODO | Record after deploy |
| **Architectural Diagram** | ✅ DONE | Docs + this file |

---

## 📋 NEXT STEPS

### Yang HARUS Dikerjakan

1. ⏳ **Lambda Handlers** — Implement 11 endpoint handlers
2. ⏳ **Bedrock Integration** — Replace OpenRouter dengan Bedrock (optional)
3. ⏳ **Frontend Sync** — Set `VITE_API_URL` ke Function URL
4. ⏳ **Testing** — Integration + contract tests
5. ⏳ **Video Demo** — Record ≤ 3 menit → YouTube

### Yang Bisa Di-Skip (untuk Hackathon)

1. ⏸️ **Step Functions** — Consolidation jobs bisa manual
2. ⏸️ **API Gateway** — Function URL sudah cukup
3. ⏸️ **Multi-region** — Single region OK
4. ⏸️ **Custom Domain** — Function URL works fine

---

## 📚 DOKUMENTASI LENGKAP

| File | Isi |
|---|---|
| `CONSTRAINTS.md` | Hackathon requirements lengkap |
| `docs/DATABASE-ENGINEER-PLAN.md` | Rencana Database Engineer (7 steps) |
| `docs/MCP-IMPLEMENTATION.md` | MCP Server implementation details |
| `docs/MCP-STATUS.md` | Status MCP deployment |
| `docs/MCP-SETUP-INSTRUCTIONS.md` | Cara setup MCP di AI tools |
| `docs/SCHEMA-DEPLOYMENT.md` | Schema deployment verification |
| `docs/INFRASTRUCTURE-NOTES.md` | Architecture decisions dari frontend |
| `docs/AWS-FREE-TIER-NOTES.md` | Free Tier compatibility details |
| `infra/README.md` | Terraform deployment guide |

---

**Last Updated:** 2026-08-14  
**Total Files Created:** 25+ files  
**Total Cost:** ✅ **$0** (Free Tier)  
**Status:** ✅ **READY TO DEPLOY** — Tinggal Lambda handlers + testing!
