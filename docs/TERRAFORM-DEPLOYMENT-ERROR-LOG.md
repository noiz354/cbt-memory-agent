# Terraform Deployment — Error Log & Diagnosis

> Tanggal: 2026-08-14
> Stack: Terraform 1.15.8 + hashicorp/aws 5.100.0 — CBT Memory Agent (CockroachDB × AWS Hackathon)
>
> **Update:** Provider kemudian di-upgrade ke **6.60.0** (`~> 6.0`) untuk memperbaiki
> Function URL 403 (missing `lambda:InvokeFunction`). Detail di `DEPLOYMENT-REPORT.md` § Insiden #3.

---

## 1. Error Utama: `ExpiredToken`

### Log

```text
Error: failed to upload state: operation error S3: PutObject,
  https response error StatusCode: 400, api error ExpiredToken: The provided token has expired.

Error: creating Lambda Function (cbt-memory-agent):
  operation error Lambda: CreateFunction, StatusCode: 403, api error ExpiredTokenException

Error: creating S3 Bucket (cbt-memory-exports):
  api error ExpiredToken: The provided token has expired.

Error: Error releasing the state lock
  failed to retrieve lock info ... ExpiredTokenException
```

### Root Cause

- Profile AWS memakai format **`login_session`** (hasil `aws login`, fitur AWS CLI 2.36 console sign-in).
- Session disimpan di **`~/.aws/cli/cache/session.db`** (SQLite) — **bukan** di `~/.aws/sso/cache/` (format JSON lama).
- **AWS CLI bisa** membaca session.db → `aws sts get-caller-identity` sukses.
- **Terraform AWS provider (aws-sdk-go-v2) TIDAK memahami key `login_session`** →
  `No valid credential sources found` → fallback ke EC2 IMDS → gagal.
- Token SSO role juga expired di tengah apply (default durasi 1 jam), memperparah keadaan.

### Gejala yang Menyesatkan

| Perintah | Hasil |
|---|---|
| `aws sts get-caller-identity --profile aws-x-cdb` | ✅ Sukses |
| `terraform state list` (backend S3) | ✅ Sukses (backend pakai SDK sendiri) |
| `terraform import/plan/apply` (AWS provider) | ❌ `No valid credential sources found` |

Backend dan provider memakai SDK berbeda → tidak konsisten.

### Solusi: Bridge `credential_process`

Tambahkan profile bridge di `~/.aws/config`:

```ini
[profile aws-x-cdb-terraform]
credential_process = aws configure export-credentials --profile aws-x-cdb --format process
region = ap-southeast-3
```

Lalu jalankan terraform dengan:

```bash
export AWS_PROFILE=aws-x-cdb-terraform
```

Kenapa ini cara resmi: AWS CLI `export-credentials --format process` menghasilkan JSON
`{Version, AccessKeyId, SecretAccessKey, SessionToken, Expiration}` — persis format
`credential_process` yang didukung semua SDK. Auto-refresh setiap kali token mendekati expired.

---

## 2. Recovery Drift (resource sudah ada di AWS tapi tidak di state)

Karena apply gagal di tengah jalan, sebagian resource sudah dibuat AWS tapi tidak tercatat:

| Resource | Di AWS? | Di state? |
|---|---|---|
| Lambda `cbt-memory-agent` | ✅ | ❌ → **import** |
| CloudWatch log group `/aws/lambda/cbt-memory-agent` | ✅ | ❌ → **import** |
| Lambda Function URL | ✅ | ❌ → **import** |
| S3 bucket `cbt-memory-exports` | ❌ | ❌ → **dibuat oleh apply** |

### Command Recovery

```bash
export AWS_PROFILE=aws-x-cdb-terraform

# 1. Buka stale lock (jika error "Error acquiring the state lock")
terraform force-unlock 892dd958-5e76-96d0-0e7b-b208b21a9dfd

# 2. Import resource yang sudah ada (jangan dibuat ulang)
terraform import 'module.lambda.aws_lambda_function.this' cbt-memory-agent
terraform import 'module.lambda.aws_cloudwatch_log_group.lambda' /aws/lambda/cbt-memory-agent
terraform import 'module.lambda.aws_lambda_function_url.this' cbt-memory-agent

# 3. Plan & apply
terraform plan -out=newplan
terraform apply newplan
```

> **Kesalahan lanjutan yang terjadi:** apply kedua gagal dengan `ResourceConflictException:
> FunctionUrlConfig exists` — karena function URL sudah ada di AWS tapi belum di-import.
> Solusi: `terraform import 'module.lambda.aws_lambda_function_url.this' cbt-memory-agent`,
> lalu plan/apply ulang.

### Hasil Akhir

```text
Apply complete! Resources: 0 added, 1 changed, 0 destroyed.

Outputs:
  function_url   = "https://4nmncatsvaol2rvmptexmxeoea0myqrr.lambda-url.ap-southeast-3.on.aws/"
  function_arn   = "arn:aws:lambda:ap-southeast-3:926375049642:function:cbt-memory-agent"
  exports_bucket = "cbt-memory-exports"
  log_group_name = "/aws/lambda/cbt-memory-agent"
```

---

## 3. Cara Token Tidak Cepat Expired

### Faktor yang Mengatur Durasi

1. **Role session di IAM Identity Center** — default **1 jam**, maksimum **12 jam**.
   - Diatur oleh *Permission Set* (console AWS → IAM Identity Center → Permission sets → Edit).
   - Butuh akses admin org. **Tidak bisa diubah dari sisi client.**

### Praktik yang Bisa Kamu Lakukan

| Cara | Keterangan |
|---|---|
| **`aws login --profile aws-x-cdb`** | Renewal session `login_session`. Pakai `--remote` kalau lewat SSH/WSL. |
| **`credential_process` bridge** | Terraform auto-refresh tiap run — masalah "expired di tengah apply" hilang. |
| **`eval "$(aws configure export-credentials --profile aws-x-cdb --format env)"`** | Ekspor creds ke env var (berlaku ±1 jam, perlu di-refresh manual). |
| **`aws-vault` / IAM user long-lived key** | Alternatif untuk CI, sesuaikan policy. |

### Checklist Sebelum Apply

```bash
aws sts get-caller-identity                        # pastikan creds valid
export AWS_PROFILE=aws-x-cdb-terraform             # profile bridge untuk terraform
terraform plan -out=newplan && terraform apply newplan
```

---

## 4. Referensi

- `~/.aws/config` — profile `aws-x-cdb` (`login_session`) + `aws-x-cdb-terraform` (bridge).
- Backend state: S3 `cbt-memory-agent-terraform-state-apse3/hackathon/terraform.tfstate`.
- Backend `use_lockfile` menggantikan `dynamodb_table` (menghilangkan warning deprecated).
