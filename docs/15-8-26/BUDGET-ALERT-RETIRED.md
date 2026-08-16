# Budget & Cost Alert — Dihapus (Retired) 2026-08-16

> Fitur ini dihapus sementara dari infra agar pipeline CI (GitHub Actions + OIDC
> least-privilege) tidak lagi gagal. Resource AWS `cbt-memory-agent-hackathon-budget`
> sudah di-`destroy` dari akun `926375049642` pada 2026-08-16.
> Berikut konfigurasi lengkapnya — simpan untuk restorasi di masa depan.

## Alasan penghapusan

Provider AWS Terraform v6.60.0 me-refresh semua resource di state pada setiap
`apply`. Untuk `aws_budgets_budget`, provider memanggil action Budgets terbaru
yang tidak tercakup kebijakan OIDC:

- `budgets:ViewBudget` / `budgets:ViewBudgets` (menggantikan `DescribeBudget*`)
- `budgets:ListTagsForResource` (baca tag budget saat refresh)

Setiap deny memaksa iterasi nambah action pada `cbt-github-actions-deploy-scoped`.
Keputusan: **hapus fitur budget alert untuk sekarang**, pertahankan least-privilege,
dan dokumentasikan agar bisa dipulihkan.

## Referensi yang dihapus

### 1. `infra/root.tf` — wiring module (dihapus)

```hcl
# Budget & Cost Monitoring
module "budget" {
  source = "./modules/budget"

  alert_emails = var.alert_emails

  depends_on = [module.lambda]
}
```

### 2. `infra/modules/budget/main.tf` — module (dihapus dari repo)

```hcl
# Budget & Cost Monitoring Module

resource "aws_budgets_budget" "hackathon" {
  name              = "cbt-memory-agent-hackathon-budget"
  budget_type       = "COST"
  limit_amount      = "1.00" # $1 max budget
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-08-13_00:00"
  time_period_end   = "2026-08-31_23:59"

  dynamic "notification" {
    for_each = length(var.alert_emails) > 0 ? [50, 80, 100] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.alert_emails
    }
  }

  tags = {
    Name = "Hackathon Budget"
  }
}
# Note: aws_ce_anomaly_monitor dihapus — akun sudah punya "Default-Services-Monitor"
# dan kuota dimensional spend monitor terbatas (error: Limit exceeded).
```

### 3. `infra/modules/budget/variables.tf` (dihapus)

```hcl
variable "alert_emails" {
  description = "Email addresses for budget alerts"
  type        = list(string)
  default     = []
}
```

### 4. `infra/variables.tf` — variabel root (dihapus)

```hcl
variable "alert_emails" {
  description = "Email addresses for budget/cloudwatch alerts"
  type        = list(string)
  default     = []
}
```

### 5. `infra/modules/oidc/main.tf` — statement `BudgetAndCloudWatch` (diganti `CloudWatch`)

Aksi budgets yang dihapus dari policy `cbt-github-actions-deploy-scoped`:

```hcl
"budgets:CreateBudget",
"budgets:DescribeBudget",
"budgets:DescribeBudgets",
"budgets:ViewBudget",      # ditambahkan 1ef07aa, lalu dihapus bersama fitur
"budgets:ViewBudgets",     # ditambahkan 1ef07aa, lalu dihapus bersama fitur
"budgets:UpdateBudget",
"budgets:DeleteBudget",
```

Sisa statement menjaga action CloudWatch (`PutMetricData`, `GetMetricData`,
`DescribeAlarms`, `ListMetrics`, `ListTagsForResource`) di Resource `["*"]`.

## Cara restore

1. Salin kembali `module "budget"` ke `infra/root.tf` dan `variable "alert_emails"`
   ke `infra/variables.tf` (lihat di atas), kembalikan `infra/modules/budget/`.
2. Tambahkan aksi berikut ke statement `CloudWatch` pada
   `infra/modules/oidc/main.tf` (Resource `["*"]`):
   - `budgets:CreateBudget`, `budgets:DescribeBudget`, `budgets:DescribeBudgets`
   - `budgets:ViewBudget`, `budgets:ViewBudgets` (dibaca provider v6.60+)
   - `budgets:UpdateBudget`, `budgets:DeleteBudget`
   - `budgets:ListTagsForResource` (dibaca provider saat refresh)
3. `~/bin/terraform apply -auto-approve` dan set `alert_emails` sesuai kebutuhan.