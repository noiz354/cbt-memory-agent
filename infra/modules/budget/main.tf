# Budget & Cost Monitoring Module

resource "aws_budgets_budget" "hackathon" {
  name              = "cbt-memory-agent-hackathon-budget"
  budget_type       = "COST"
  limit_amount      = "1.00"  # $1 max budget
  limit_unit        = "USD"
  time_period_start = "2026-08-13"
  time_period_end   = "2026-08-31"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_emails
  }

  tags = {
    Name = "Hackathon Budget"
  }
}

# Cost Anomaly Detection
resource "aws_ce_anomaly_monitor" "hackathon" {
  name              = "cbt-memory-agent-anomaly-monitor"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
  monitor_specification {
    tags {
      key    = "Project"
      values = ["cbt-memory-agent"]
    }
  }
}
