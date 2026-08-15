# EventBridge Module — Outputs

output "rule_arn" {
  description = "ARN dari EventBridge rule reflection"
  value       = aws_cloudwatch_event_rule.reflect.arn
}

output "rule_name" {
  description = "Nama EventBridge rule reflection"
  value       = aws_cloudwatch_event_rule.reflect.name
}
