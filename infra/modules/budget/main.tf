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
