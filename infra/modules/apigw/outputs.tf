# API Gateway Module Outputs

output "api_endpoint" {
  description = "API Gateway HTTP endpoint"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.http.id
}

output "log_group_name" {
  description = "API Gateway Log Group name"
  value       = aws_cloudwatch_log_group.api_gateway.name
}
