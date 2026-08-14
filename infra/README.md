# Infrastructure as Code — Terraform

> AWS Serverless infrastructure untuk CBT Memory Agent
> CockroachDB × AWS Hackathon 2026

**Stack:**
- AWS Lambda (Node.js 22.x)
- Lambda Function URL (bukan API Gateway — 71% lebih murah)
- AWS SSM Parameter Store (secure credentials)
- CloudWatch (10 metrics + 9 alarms + dashboard)
- AWS Budgets ($1 max budget alert)
- **NO VPC, NO NAT Gateway** (Free Tier compatible)

---

## 📁 Structure

```
infra/
├── main.tf                  # Provider + Terraform config
├── variables.tf             # Input variables
├── outputs.tf               # Output values
├── backend.tf               # S3 remote state + DynamoDB lock
├── root.tf                  # Module orchestration
├── environments/
│   └── hackathon.tfvars     # Environment-specific variables
└── modules/
    ├── iam/                 # Least-privilege IAM roles
    ├── lambda/              # Lambda function + Function URL
    ├── ssm/                 # SSM Parameter Store
    ├── budget/              # Budget alerts + cost anomaly
    └── apigw/               # API Gateway (optional)
```

---

## 🚀 Quick Start

### 1. Install Terraform

```bash
# macOS
brew install terraform

# Linux
curl -fsSL https://releases.hashicorp.com/terraform/1.5.0/terraform_1.5.0_linux_amd64.zip -o terraform.zip
unzip terraform.zip
sudo mv terraform /usr/local/bin/
```

### 2. Setup AWS Credentials

```bash
aws configure
# Input: AWS Access Key ID, Secret Access Key, region (us-east-1)
```

### 3. Prepare Variables

```bash
cd /home/norman2/14-8-26-aws-x-coachroachdb-merge/infra

# Copy template
cp environments/hackathon.tfvars terraform.tfvars

# Edit dengan values dari .env
nano terraform.tfvars
```

**Isi terraform.tfvars:**

```hcl
aws_region           = "us-east-1"
environment          = "hackathon"
function_name        = "cbt-memory-agent"
memory_size          = 256
timeout              = 29

crdb_connection_url  = "postgresql://<username>:<password>@<host>:26257/defaultdb?sslmode=verify-full"  # dari .env
crdb_cluster_id      = "<cluster-id>"    # dari .env
ccloud_api_key       = "<ccloud-api-key>" # dari .env (CCDB1_...)

app_pepper           = "random-string-32-chars"
openrouter_daily_cap = 50

alert_emails         = ["your-email@example.com"]
```

### 4. Initialize Terraform

```bash
cd infra
terraform init
```

### 5. Plan & Deploy

```bash
# Preview changes
terraform plan -var-file=terraform.tfvars

# Deploy
terraform apply -var-file=terraform.tfvars
```

---

## 📊 Outputs

Setelah deploy, Terraform akan print:

```
Outputs:

function_url = "https://xxxxxx.lambda-url.us-east-1.on.aws"
function_name = "cbt-memory-agent"
function_arn = "arn:aws:lambda:us-east-1:123456789:function:cbt-memory-agent"
log_group_name = "/aws/lambda/cbt-memory-agent"
```

**Simpan Function URL** — ini endpoint API untuk frontend!

---

## 🔄 Update Infrastructure

```bash
# Edit terraform.tfvars atau module files
nano terraform.tfvars

# Plan changes
terraform plan -var-file=terraform.tfvars

# Apply
terraform apply -var-file=terraform.tfvars
```

---

## 🧹 Cleanup (Destroy)

```bash
# Destroy all resources
terraform destroy -var-file=terraform.tfvars

# Warning: This will delete Lambda, SSM params, CloudWatch, etc.
```

---

## 💰 Free Tier Compatibility

| Resource | Free Tier Limit | Usage | Cost |
|---|---|---|---|
| Lambda | 1M requests/month | ~10K | ✅ $0 |
| SSM | 10K parameters | ~5 | ✅ $0 |
| CloudWatch | 10 metrics + 10 alarms | 10 + 9 | ✅ $0 |
| Budgets | 2 budgets free | 1 budget | ✅ $0 |
| **TOTAL** | | | **✅ $0** |

**NO VPC, NO NAT Gateway** — saves $32/month

---

## 🎯 Modules

### IAM (`modules/iam/`)
- Least-privilege execution role
- SSM read access
- CloudWatch logs + metrics access

### Lambda (`modules/lambda/`)
- Node.js 22.x runtime
- 256MB memory, 29s timeout
- Function URL (no API Gateway)
- 7-day log retention

### SSM (`modules/ssm/`)
- SecureString for secrets
- Auto-generate pepper if not provided
- Organized by environment

### Budget (`modules/budget/`)
- $1 max budget alert
- 50%, 80%, 100% notifications
- Cost anomaly detection

### API Gateway (`modules/apigw/`) — OPTIONAL
- HTTP API (71% cheaper than REST)
- CORS configured
- 7-day log retention

---

## ⚠️ Important Notes

1. **DO NOT commit terraform.tfvars** — contains secrets
2. **DO NOT commit .terraform/** — local state
3. **Use S3 backend** for production (already configured)
4. **Lambda timeout = 29s** (not 30s — API Gateway limit)
5. **Log retention = 7 days** (Free Tier: 5GB/month)

---

## 📝 Documentation

- `docs/AWS-FREE-TIER-NOTES.md` — Free Tier compatibility details
- `docs/INFRASTRUCTURE-NOTES.md` — Architecture decisions
- `docs/SCHEMA-DEPLOYMENT.md` — CockroachDB schema status

---

**Last Updated:** 2026-08-13  
**Stack:** Terraform + AWS Serverless + CockroachDB  
**Status:** ✅ Ready to deploy
