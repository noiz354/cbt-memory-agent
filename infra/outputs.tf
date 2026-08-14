# Outputs

output "function_url" {
  description = "Lambda Function URL endpoint"
  value       = aws_lambda_function_url.this.function_url
}

output "function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.this.arn
}

output "ssm_parameters" {
  description = "SSM parameter paths"
  value = {
    crdb_url       = aws_ssm_parameter.crdb_url.name
    cluster_id     = aws_ssm_parameter.crdb_cluster_id.name
    ccloud_api_key = aws_ssm_parameter.ccloud_api_key.name
    pepper         = aws_ssm_parameter.app_pepper.name
    daily_cap      = aws_ssm_parameter.openrouter_daily_cap.name
  }
}

output "cloudwatch_dashboard" {
  description = "CloudWatch dashboard URL"
  value       = "https://console.aws.amazon.com/cloudwatch/home#dashboards/dashboard:CBTMemoryAgent"
}

output "log_group_name" {
  description = "CloudWatch Log Group name"
  value       = aws_cloudwatch_log_group.lambda.name
}
