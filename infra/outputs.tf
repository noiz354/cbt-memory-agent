# Outputs

output "function_url" {
  description = "Lambda Function URL endpoint"
  value       = module.lambda.function_url
}

output "function_name" {
  description = "Lambda function name"
  value       = module.lambda.function_name
}

output "function_arn" {
  description = "Lambda function ARN"
  value       = module.lambda.function_arn
}

output "ssm_parameters" {
  description = "SSM parameter paths"
  value       = module.ssm.parameter_paths
}

output "cloudwatch_dashboard" {
  description = "CloudWatch dashboard URL"
  value       = "https://console.aws.amazon.com/cloudwatch/home#dashboards/dashboard:CBTMemoryAgent"
}

output "log_group_name" {
  description = "CloudWatch Log Group name"
  value       = module.lambda.log_group_name
}

output "exports_bucket" {
  description = "S3 bucket for export bundles"
  value       = module.lambda.exports_bucket
}

output "cloudfront_domain" {
  description = "Frontend CloudFront domain (https://...cloudfront.net)"
  value       = module.frontend.cloudfront_domain
}

output "cloudfront_distribution_id" {
  description = "Frontend CloudFront distribution ID"
  value       = module.frontend.distribution_id
}

output "github_actions_role_arn" {
  description = "OIDC role ARN untuk GitHub Actions deploy"
  value       = module.oidc.role_arn
}
