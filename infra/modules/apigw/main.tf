# API Gateway Module — HTTP API (71% cheaper than REST API)

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.function_name}-api"
  protocol_type = "HTTP"
  description   = "CBT Memory Agent HTTP API — Hackathon 2026"

  cors_configuration {
    allow_origins = ["*"]  # Restrict to frontend domain in production
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization", "X-User-Id", "X-Tenant-Id", "Idempotency-Key"]
    max_age       = 600
  }

  tags = {
    Name = "${var.function_name}-api"
  }
}

# Default stage
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId         = "$context.requestId"
      ip                = "$context.identity.sourceIp"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      routeKey          = "$context.routeKey"
      status            = "$context.status"
      responseLength    = "$context.responseLength"
      integrationStatus = "$context.integrationStatus"
    })
  }

  tags = {
    Name = "${var.function_name}-stage"
  }
}

# Integration with Lambda
resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.lambda_arn
  integration_method     = "POST"
  payload_format_version = "2.0"

  timeout_in_milliseconds = 29000  # Must be < Lambda timeout (29s)
}

# Routes
resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"  # Catch-all route
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# CloudWatch Log Group for API Gateway
resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.function_name}"
  retention_in_days = 7  # Hackathon cost optimization

  tags = {
    Name = "API Gateway Logs"
  }
}
