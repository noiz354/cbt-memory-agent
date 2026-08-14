# Daftar Lengkap Layanan Always Free di AWS

> Sumber: riset Free Tier (2026-08-14). Akun project ini **Paid Plan** — melebihi limit Always Free
> = langsung dikenakan biaya. Panduan project-specific ada di `docs/AWS-FREE-TIER-NOTES.md`.

---

## 💻 Compute

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| AWS Lambda | 1 juta requests + 400.000 GB-seconds compute | ~32.258 requests/hari |
| AWS Fargate | 2 vCPU/bulan + 4 GB memory/bulan (via ECS) | ~0.06 vCPU/hari |

## 🗄️ Database & Storage

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| Amazon DynamoDB | 25 GB storage + 25 WCU + 25 RCU | ~0.8 GB/hari |
| Amazon S3 Glacier | 10 GB retrieval/bulan | ~333 MB/hari |
| AWS Glue | 1 juta catalog requests | ~32.258 requests/hari |

## 📨 Messaging & Integration

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| Amazon SQS | 1 juta requests | ~32.258 requests/hari |
| Amazon SNS | 1 juta requests | ~32.258 requests/hari |
| Amazon SES | 62.000 email outbound (jika dari EC2) | ~2.000 email/hari |

## 🔐 Security & Identity

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| AWS KMS | 20.000 API requests | ~645 requests/hari |
| AWS IAM | Unlimited (selalu gratis) | Tidak terbatas |
| AWS Secrets Manager | 10.000 API calls (trial 30 hari) | ~333 calls/hari |
| Amazon Cognito | 50.000 MAU (Monthly Active Users) | ~1.667 user aktif/hari |

## 📊 Monitoring & Management

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| Amazon CloudWatch | 10 custom metrics + 5 GB log ingestion + 3 dashboards + 10 alarms | ~167 MB log/hari |
| AWS CloudTrail | 1 trail gratis (management events) | Tidak terbatas |
| AWS Config | Tidak termasuk Always Free | - |

## 🤖 AI & Machine Learning

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| Amazon Q Developer | Chat gratis (Builder ID) | Tidak terbatas |
| Amazon Rekognition | 5.000 gambar/bulan (12 bulan) | ~167 gambar/hari |
| Amazon Comprehend | 50 unit NLP/bulan (12 bulan) | ~1.6 unit/hari |

## 🌐 Networking

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| Amazon VPC | Selalu gratis (basic) | Tidak terbatas |
| AWS Direct Connect | Tidak termasuk Always Free | - |

## 🛠️ Developer Tools

| Layanan | Limit Bulanan | Estimasi Harian |
|---|---|---|
| AWS CodeCommit | 5 active users + 50 GB storage + 10.000 Git requests | ~323 Git requests/hari |
| AWS CodeBuild | 100 build minutes/bulan | ~3.2 menit/hari |
| AWS X-Ray | 100.000 traces recorded + 1 juta traces retrieved | ~3.226 traces/hari |

## 💡 Tips Penting

- Pantau penggunaan di **Free Tier Dashboard** secara berkala
- Set up **budget alert** di **AWS Budgets** agar dapat notifikasi sebelum kena charge
- Akun kamu **Paid Plan** — artinya jika melebihi limit Always Free, akan langsung dikenakan biaya
- Cek daftar lengkap di **AWS Free Tier Page**

---

## Langkah P0 / P1 / P2 untuk project ini

### 🔴 P0 — Wajib segera (cegah biaya tak terduga)

1. **Setup AWS Budgets alert** — buat budget 0? ($1 / $5 / $10) + email alert. Prioritas tertinggi:
   - AWS CLI: `aws budgets create-budget` (atau tambahkan resource `aws_budgets_budget` di `infra/`).
   - Trigger: `ACTUAL` (≥ 85% budget) + `FORECASTED`.
2. **Cek Free Tier Dashboard** sekarang → pastikan tidak ada resource berbayar berjalan:
   - ❌ NAT Gateway ($32/bulan), Route 53 ($0.50/bulan), Elastic IP unattached ($3.60/bulan), VPC dengan NAT.
   - ❌ Step Functions / API Gateway (proyek ini pakai Lambda Function URL).
3. **CloudWatch** — pastikan log retention **7 hari** (sudah di `aws_cloudwatch_log_group`), jangan > 10 custom metrics / 10 alarms / 3 dashboards.
4. **KMS** — pakai key default AWS-managed (SSE-S3 `aws/s3`, SSE-S3 default di S3). **JANGAN buat custom CMK** ($1/key/bulan + $0.03/10k request) — tidak Always Free.
5. **Pantau Lambda** harian: ≤ ~32.258 requests/hari & ~13.333 GB-sec/hari (4.000.000 GB-sec tidak; batas 400.000 GB-sec/bulan ≈ 13.333/hari) agar tidak charge.

### 🟡 P1 — Penting (sebelum demo / lanjut develop)

6. **CloudTrail** — pastikan hanya **1 trail management events** (gratis); jangan enable data events untuk S3 (berbayar).
7. **CodeBuild (opsional CI)** — 100 build menit/bulan gratis; jika `.github/workflows/deploy.yml` jalan, pantau menit build agar tidak tembus.
8. **S3 lifecycle** — jika export bundle menumpuk: pindahkan object lama ke `S3 Glacier` (retrieval 10 GB/bulan gratis) supaya storage Standard 5 GB (12 bulan) aman.
9. **Cek region** — biaya Lambda/CloudWatch sama per region; pastikan semua resource di satu region (`us-east-1` untuk Lambda, per `.env`).

### 🟢 P2 — Nice-to-have (kalau sempat)

10. **Amazon X-Ray** — 100.000 traces/bulan gratis; bisa dipakai untuk tracing Lambda (observability demo) via `aws-xray-sdk` + `Active Tracing` di terraform.
11. **Amazon Q Developer** (Builder ID) — gratis; untuk bantuan coding + eksplorasi AWS.
12. **DynamoDB 25 GB** — sebagai **alternatif/bandingan** di demo; TIDAK menggantikan CockroachDB (inti hackathon = CockroachDB x AWS).
13. **SES 62.000 email** — hanya jika ingin kirim email sungguhan (magic link masih stub di frontend); SES tetap butuh sandbox approval.
14. **SQS/SNS** — gratis 1M request; berguna jika nanti ada async job (mis. sinkronisasi memory → embeddings) sebagai pengganti Step Functions (berbayar > 4K transisi).

---

**Referensi:** `docs/AWS-FREE-TIER-NOTES.md` (kalkulasi cost project, template.yaml, checklist deploy).
**Last Updated:** 2026-08-14
