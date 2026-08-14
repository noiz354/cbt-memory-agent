# AWS Free Tier Compatibility Notes

> Catatan kompatibilitas AWS Free Tier untuk semua resources yang di-deploy.
> **PENTING:** Hackathon harus tetap $0 atau semurah mungkin.

**Tanggal:** 2026-08-13  
**Status:** ⚠️ Review required sebelum deploy

---

## ✅ FREE TIER COMPATIBLE

### 1. **Lambda Function URL** ✅

| Resource | Free Tier Limit | Usage Estimate | Cost |
|---|---|---|---|
| Requests | 1M per month | ~10K (hackathon demo) | ✅ $0 |
| Compute time | 400,000 GB-seconds | ~100 GB-seconds | ✅ $0 |
| Function URL | Included | 1 endpoint | ✅ $0 |

**Status:** ✅ **AMAN** — Lambda Function URL termasuk Free Tier

---

### 2. **SSM Parameter Store** ✅

| Resource | Free Tier Limit | Usage Estimate | Cost |
|---|---|---|---|
| Standard parameters | 10,000 parameters | ~8 parameters | ✅ $0 |
| SecureString parameters | Included | ~5 parameters | ✅ $0 |
| API calls | Included | ~100 calls | ✅ $0 |

**Status:** ✅ **AMAN** — SSM Parameter Store gratis untuk usage normal

---

### 3. **CloudWatch** ⚠️

| Resource | Free Tier Limit | Usage Estimate | Cost |
|---|---|---|---|
| Custom metrics | 10 metrics | 10 metrics | ✅ $0 |
| Alarms | 10 alarms | 9 alarms | ✅ $0 |
| Dashboards | 3 dashboards | 1 dashboard | ✅ $0 |
| Log storage | 5 GB/month | ~1 GB (7 hari retention) | ✅ $0 |
| Log ingestion | 5 GB/month | ~1 GB | ✅ $0 |

**Status:** ✅ **AMAN** — Selama metric/alarm count dalam limit

**⚠️ WARNING:**
- Log retention harus ≤ 7 hari (sudah set di template.yaml)
- Jangan buat > 10 custom metrics
- Jangan buat > 10 alarms

---

### 4. **CockroachDB Serverless** ✅

| Resource | Free Tier Limit | Usage Estimate | Cost |
|---|---|---|---|
| Request Units | 50M RU/month | ~1M RU (demo) | ✅ $0 |
| Storage | 10 GiB | ~500 MB | ✅ $0 |
| Spend Limit | Set to $0.00 | Enforced | ✅ $0 |

**Status:** ✅ **AMAN** — Spend limit $0.00 sudah diset

---

## ⚠️ POTENTIAL COSTS (Perlu Attention)

### 1. **Step Functions** ⏳

| Resource | Free Tier Limit | Usage Estimate | Cost |
|---|---|---|---|
| State transitions | 4,000 per month | ~100 (consolidation daily) | ✅ $0 |
| Additional transitions | $0.025 per 1,000 | - | ⏳ Jika > 4K |

**Status:** ✅ **AMAN** untuk hackathon (≤ 4K transitions/month)

**Note:** Step Functions baru dipakai jika ada consolidation jobs. Untuk demo, bisa skip dulu.

---

### 2. **S3** ⏳

| Resource | Free Tier Limit | Usage Estimate | Cost |
|---|---|---|---|
| Storage | 5 GB (12 months) | ~100 MB (exports) | ✅ $0 |
| GET requests | 20,000 per month | ~100 | ✅ $0 |
| PUT requests | 2,000 per month | ~50 | ✅ $0 |

**Status:** ✅ **AMAN** — S3 usage minimal untuk export bundles

---

### 3. **API Gateway** (TIDAK DIPAKAI)

**GOOD NEWS:** Kita pakai **Lambda Function URL** instead of API Gateway, yang:
- ✅ 71% lebih murah
- ✅ Termasuk dalam Lambda Free Tier
- ✅ Tidak ada additional cost

**Status:** ✅ **TIDAK DIPAKAI** — diganti Lambda Function URL

---

## ❌ YANG HARUS DIHINDARI (Biaya Tersembunyi)

### 1. **NAT Gateway** ❌

| Resource | Cost | Why |
|---|---|---|
| NAT Gateway | $0.045/hour = **$32/month** | Lambda tidak butuh NAT jika akses public endpoints |

**Status:** ❌ **JANGAN BUAT** — Lambda bisa akses CockroachDB + OpenRouter via public endpoint

**Solusi:**
- Lambda → CockroachDB: Public endpoint (SSL verify-full)
- Lambda → OpenRouter: Public endpoint (HTTPS)
- **Tidak perlu VPC** untuk hackathon

---

### 2. **Route 53 Hosted Zone** ❌

| Resource | Cost |
|---|---|
| Hosted zone | $0.50/month |

**Status:** ❌ **JANGAN BUAT** — Pakai Lambda Function URL langsung (tidak perlu custom domain)

**Solusi:**
- Function URL: `https://xxxxxx.lambda-url.ap-southeast-3.on.aws`
- Frontend bisa call langsung (CORS enabled)

---

### 3. **CloudWatch Log Retention = Forever** ❌

| Resource | Cost |
|---|---|
| Log storage > 5 GB | $0.50/GB/month |

**Status:** ⚠️ **SUDAH DISET** — Retention 7 hari di `infra/template.yaml`

```yaml
CbtApiLogGroup:
  Type: AWS::Logs::LogGroup
  Properties:
    LogGroupName: !Sub '/aws/lambda/${CbtApiFunction}'
    RetentionInDays: 7  # ✅ Hemat cost
```

---

### 4. **Elastic IP (Unattached)** ❌

| Resource | Cost |
|---|---|
| Unattached EIP | $0.005/hour = $3.60/month |

**Status:** ❌ **TIDAK PERLU** — Lambda tidak butuh Elastic IP

---

### 5. **Multi-Region Deployment** ❌

| Resource | Cost |
|---|---|
| Double RU consumption | 2x CockroachDB usage |
| Cross-region data transfer | $0.02/GB |

**Status:** ❌ **JANGAN** — Single region (ap-southeast-3) cukup untuk hackathon

---

## 🎯 RECOMMENDATIONS untuk Free Tier

### ✅ YANG AMAN DI-DEPLOY

1. **Lambda Function URL** — 1M requests/month free
2. **SSM Parameter Store** — 10K parameters free
3. **CloudWatch** — 10 metrics + 10 alarms + 3 dashboards free
4. **S3** — 5 GB storage free (12 months)
5. **Step Functions** — 4K transitions/month free
6. **CockroachDB Serverless** — 50M RU + 10 GiB free

### ⏳ YANG BISA DI-SKIP DULU (untuk hackathon)

1. **Step Functions** — Consolidation jobs bisa manual dulu
2. **CloudWatch Alarms** — Optional untuk demo, tapi bagus untuk have
3. **S3 Exports** — Optional, bisa skip jika tidak dipakai

### ❌ YANG HARUS DIHINDARI

1. **NAT Gateway** — $32/month
2. **Route 53** — $0.50/month
3. **VPC** — Tidak perlu untuk hackathon
4. **Elastic IP** — Tidak perlu
5. **Multi-region** — Double cost

---

## 💰 ESTIMASI TOTAL COST (Hackathon — 5 hari)

| Service | Usage | Cost |
|---|---|---|
| Lambda | ~10K requests, ~100 GB-sec | ✅ $0 |
| SSM | ~8 parameters, ~100 API calls | ✅ $0 |
| CloudWatch | 10 metrics, 9 alarms, 1 dashboard | ✅ $0 |
| S3 | ~100 MB exports | ✅ $0 |
| Step Functions | ~100 transitions | ✅ $0 |
| CockroachDB | ~1M RU, ~500 MB | ✅ $0 (spend limit $0.00) |
| **TOTAL** | | **✅ $0** |

---

## 🔧 ADJUSTMENTS YANG PERLU DILAKUKAN

### 1. Template.yaml — Remove VPC Config (Jika Ada)

**Pastikan TIDAK ada:**
```yaml
VpcConfig:  # ❌ JANGAN INI
  SubnetIds: ...
  SecurityGroupIds: ...
```

### 2. Template.yaml — Function URL Sudah Benar

**Sudah OK:**
```yaml
Events:
  FunctionUrl:
    Type: FunctionUrl
    Properties:
      AuthType: NONE  # ✅ Demo only
```

### 3. CloudWatch — Retention 7 Hari

**Sudah OK:**
```yaml
CbtApiLogGroup:
  Properties:
    RetentionInDays: 7  # ✅ Hemat cost
```

---

## 📋 CHECKLIST SEBELUM DEPLOY

- [ ] Spend limit CockroachDB = $0.00 ✅ (sudah diset)
- [ ] Lambda TIDAK pakai VPC ✅ (template.yaml sudah benar)
- [ ] CloudWatch log retention = 7 hari ✅ (sudah diset)
- [ ] TIDAK ada NAT Gateway ✅ (tidak ada di template)
- [ ] TIDAK ada Route 53 ✅ (tidak ada di template)
- [ ] TIDAK ada Elastic IP ✅ (tidak ada di template)
- [ ] Single region (ap-southeast-3) ✅ (sudah diset)

---

**Last Updated:** 2026-08-13  
**Verdict:** ✅ **SEMUA FREE TIER COMPATIBLE** — Total estimated cost: $0
