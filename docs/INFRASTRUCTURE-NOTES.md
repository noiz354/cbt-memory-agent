# Infrastructure Notes — Frontend Workspace Recommendations

> Catatan dari `IMPLEMENTATION_ML_BACKEND.md` di frontend workspace.
> Referensi: `/home/norman2/13-8-26-fe-aws-x-coachroachdb/workspace/docs/IMPLEMENTATION_ML_BACKEND.md`

**Tanggal:** 2026-08-13  
**Status:** ⏳ For future reference — belum diimplementasi di backend repo ini

---

## 📌 VECTOR DIMENSION — 384 vs 1024

### Frontend Workspace Recommendation: **VECTOR(384)**

| Item | Value |
|---|---|
| Model | `sentence-transformers/all-MiniLM-L6-v2` |
| Dim | **384** |
| Metric | cosine (`1 - cosine_distance`) |
| Runtime | ONNX int8, Lambda layer ≈ 90 MB |
| Normalize | L2 on output |
| Input | Redacted summary, max 256 tokens |
| Cost | **FREE** (runs in Lambda, tidak panggil API) |

**Kenapa 384:**
- ✅ Lebih murah (tidak perlu call Bedrock/Cohere untuk embeddings)
- ✅ Lebih cepat (ONNX local di Lambda, < 50ms per text)
- ✅ Cukup untuk CBT context (tidak perlu 1024 dim untuk therapy summaries)
- ✅ Tidak perlu AWS Secrets Manager (tidak ada API key untuk embedding model)

### Backend Repo Ini: **VECTOR(1024)**

| Item | Value |
|---|---|
| Model | Amazon Titan Embed Text v2 / Cohere embed-english-v3 |
| Dim | **1024** |
| Metric | cosine via `embeddings_vector_idx` |
| Cost | $0.02 per 1M tokens (Titan) atau $0.10 per 1M (Cohere) |

**Kenapa 1024:**
- ✅ Bedrock integration (hackathon requirement)
- ✅ Higher accuracy untuk semantic search
- ❌ Lebih mahal (perlu API call untuk setiap embedding)
- ❌ Lebih lambat (network latency ke Bedrock)

---

## 🎯 KEPUTUSAN: Tetap VECTOR(1024) untuk Sekarang

**Alasan:**
1. **Hackathon requirement** — minimal 1 AWS service, Bedrock sudah di-plan
2. **Sudah deployed** — schema dengan VECTOR(1024) sudah di cluster
3. **Bisa migrate nanti** — downgrade ke 384 mudah, upgrade sulit

**Kapan migrate ke 384:**
- Setelah hackathon, jika cost Bedrock embeddings terlalu tinggi
- Jika latency recall > 150ms (SLO dari frontend workspace)
- Jika mau fully offline embeddings (ONNX di Lambda)

---

## 📋 INFRASTRUCTURE YANG PERLU DI-ADAPTASI

### 1. Lambda Function URL (vs API Gateway)

**Sekarang:** API Gateway HTTP API  
**Rekomendasi:** Lambda Function URL (71% lebih murah)

**Action:** Update `infra/` directory dengan template.yaml untuk SAM

### 2. SSM Parameter Store

**Sekarang:** `.env` file (local only)  
**Rekomendasi:** AWS SSM Parameter Store

**Parameters yang perlu:**
```
/cbt/plane-c/pepper
/cbt/openrouter/key         # atau /cbt/bedrock/access_key
/cbt/crdb/url              # postgres://cbt_app@…?sslmode=verify-full
/cbt/openrouter/daily_cap  # 50 or 1000
```

**Action:** Buat script untuk migrate dari `.env` ke SSM

### 3. Step Functions

**Sekarang:** Tidak ada  
**Rekomendasi:** Step Functions untuk consolidation/forgetting jobs

**State machine `cbt-consolidate`:**
1. LoadDupes — ANN self-join, cosine > 0.92
2. Merge — keep higher salience, sum references
3. Decay — salience *= 0.98 if updated_at < now()-14d
4. ForgetSweep — status='forgotten' older than 30d
5. Stats — emit CloudWatch metrics

**Action:** Buat `infra/step-functions.json`

### 4. CloudWatch Metrics (10 max)

**Sekarang:** Tidak ada  
**Rekomendasi:** CloudWatch EMF dengan metrics:

| Metric | Purpose | Alarm |
|---|---|---|
| `complete_ms` | LLM response latency | > 2s |
| `recall_ms` | ANN query latency | > 150ms |
| `ann_used` | Vector index hit (0/1) | < 1 |
| `openrouter_429` | Rate limit hits | > 10/min |
| `openrouter_calls` | Daily API calls | > 50 |
| `crisis_short_circuit` | Crisis detected | Missing = SEV0 |
| `redact_drops` | Redacted spans | Monitor only |
| `cache_hit` | Completion cache hit rate | < 20% |
| `lambda_errors` | 5xx rate | > 1% |
| `consolidate_ms` | Step Functions duration | > 30s |

**Action:** Setup CloudWatch di `infra/` atau via Terraform

### 5. OpenRouter vs Bedrock

**Sekarang:** Amazon Bedrock (Nova Micro, Claude)  
**Rekomendasi:** OpenRouter :free (20 RPM, 50 req/day free)

**Perbandingan:**

| Aspect | Bedrock | OpenRouter :free |
|---|---|---|
| Cost | $0.035/1M input tokens | **FREE** |
| Setup | Perlu AWS credentials | API key only |
| Models | Nova Micro, Claude, Titan | Llama 3.3 70B, Qwen3, dll |
| Rate limit | Tinggi (pay-per-token) | 20 RPM, 50 req/day |
| Fallback | Nova Lite | Next :free model |

**Action:** Tambahkan OpenRouter sebagai fallback option di `lambda/lib/bedrock.ts`

### 6. ccloud-bootstrap.sh

**Sekarang:** Manual commands  
**Rekomendasi:** Script terstruktur

**Isi script:**
```bash
#!/usr/bin/env bash
# Bootstrap CockroachDB cluster + MCP + backups

set -euo pipefail

# 1. Auth (headless — device-code flow)
ccloud auth login --no-redirect
# Atau non-interactive (cron/CI): bash scripts/ccloud-auth.sh api

# 2. Create cluster (if not exists)
ccloud cluster create woozy-grivet \
  --serverless \
  --region ap-southeast-3 \
  --spend-limit 0.00 || true

# 3. Apply schema
ccloud cluster sql woozy-grivet -f schema/crdb-schema.sql

# 4. Create app user
ccloud user create cbt_app --password-from-stdin

# 5. Grants
ccloud cluster sql woozy-grivet -f schema/grants.sql

# 6. Backup schedule
ccloud backup schedule create --recurring '@daily'

# 7. Print MCP endpoint + cluster ID
echo "MCP Endpoint: https://cockroachlabs.cloud/mcp"
echo "Cluster ID: $(ccloud cluster info woozy-grivet -o json | jq -r '.id')"
```

**Action:** Buat `scripts/ccloud-bootstrap.sh`

---

## 📊 DELIVERY ORDER (5 Days)

| Day | Owner | Output | Status |
|---|---|---|---|
| 1 | Backend | ccloud-bootstrap.sh + schema + grants | ⏳ |
| 1 | ML | ONNX layer + embed.py (384 dim) | ⏳ LATER |
| 2 | ML | redact.py + fixtures green in CI | ⏳ |
| 2 | Backend | Function URL + idempotency + SSM | ⏳ |
| 3 | Both | recall.hybrid + EXPLAIN evidence | ⏳ |
| 3 | ML | complexity scorer | ⏳ |
| 4 | Backend | router.decide + complete.run | ⏳ |
| 4 | Both | Crisis short-circuit test | ⏳ |
| 5 | Backend | Forget + Step Functions | ⏳ |
| 5 | Both | CloudWatch audit + demo video | ⏳ |

---

## 🎯 ACCEPTANCE CHECKLIST (Hackathon Demo)

- [ ] Public Function URL completes a **non-crisis** turn
- [ ] Same turn writes a `memories` row with `embed_dim = 384` (atau 1024 untuk sekarang)
- [ ] RelevancyStrip shows UUID and cosine from SQL
- [ ] `EXPLAIN` of ANN query visible di video
- [ ] `ccloud` backup schedule visible
- [ ] Crisis string: overlay on device, **0** API calls, **0** new rows with phrase
- [ ] Second demo user cannot ANN-see first user's rows
- [ ] CloudWatch sample: no S0/S1 fields
- [ ] Daily counter < 50 after video
- [ ] LICENSE MIT di public repo

---

**Last Updated:** 2026-08-13  
**Next Action:** Adaptasi infrastruktur sesuai rekomendasi di atas (kecuali VECTOR 384)
