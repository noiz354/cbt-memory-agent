# Lambda Module Outputs

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

output "log_group_name" {
  description = "CloudWatch Log Group name"
  value       = aws_cloudwatch_log_group.lambda.name
}

output "exports_bucket" {
  description = "S3 bucket name for export bundles"
  value       = aws_s3_bucket.exports.bucket
}
