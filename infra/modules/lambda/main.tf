# Lambda Function Module

# Read SSM parameters created by the ssm module (secure values)
data "aws_ssm_parameter" "crdb_url" {
  name = "/${var.environment}/crdb/connection-url"
}

data "aws_ssm_parameter" "ccloud_api_key" {
  name = "/${var.environment}/ccloud/api-key"
}

data "aws_ssm_parameter" "openrouter_api_key" {
  name = "/${var.environment}/openrouter/api-key"
}

data "aws_ssm_parameter" "resend_api_key" {
  name = "/${var.environment}/resend/api-key"
}

data "aws_ssm_parameter" "grafana_otlp_endpoint" {
  name = "/${var.environment}/grafana/otlp-endpoint"
}

data "aws_ssm_parameter" "grafana_otlp_headers" {
  name = "/${var.environment}/grafana/otlp-headers"
}

resource "aws_lambda_function" "this" {
  function_name = var.function_name
  description   = "CBT Memory Agent API — CockroachDB x AWS Hackathon 2026"
  role          = var.role_arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  memory_size   = var.memory_size
  timeout       = var.timeout
  publish       = true

  # Zip produced by scripts/build-lambda.sh
  filename         = "${path.module}/../../../lambda/cbt-memory-agent.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../lambda/cbt-memory-agent.zip")

  architectures = ["x86_64"]

  environment {
    variables = {
      NODE_ENV                    = "production"
      CRDB_CONNECTION             = data.aws_ssm_parameter.crdb_url.value
      CCLOUD_API_KEY              = data.aws_ssm_parameter.ccloud_api_key.value
      OPENROUTER_API_KEY          = data.aws_ssm_parameter.openrouter_api_key.value
      RESEND_API_KEY              = data.aws_ssm_parameter.resend_api_key.value
      EMAIL_FROM                  = var.email_from
      APP_URL                     = var.app_url
      S3_BUCKET                   = var.s3_bucket
      ALLOWED_ORIGIN              = var.allowed_origin
      OTEL_SERVICE_NAME           = "cbt-memory-agent-backend"
      OTEL_EXPORTER_OTLP_ENDPOINT = data.aws_ssm_parameter.grafana_otlp_endpoint.value
      OTEL_EXPORTER_OTLP_HEADERS  = data.aws_ssm_parameter.grafana_otlp_headers.value
    }
  }

  # No VPC — Lambda accesses public endpoints (CockroachDB, OpenRouter)
  # This saves $32/month NAT Gateway cost

  tags = {
    Name = var.function_name
  }
}

# S3 bucket for export bundles (referenced by IAM policy + Lambda health check)
resource "aws_s3_bucket" "exports" {
  bucket        = var.s3_bucket
  force_destroy = true

  lifecycle {
    prevent_destroy = false
  }

  tags = {
    Name = "CBT Memory Agent Exports"
  }
}

resource "aws_s3_bucket_ownership_controls" "exports" {
  bucket = aws_s3_bucket.exports.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Lambda Function URL (cheaper than API Gateway — 71% savings)
resource "aws_lambda_function_url" "this" {
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE" # Demo only — add auth for production

  cors {
    allow_origins = ["*"]                             # Restrict to frontend domain in production
    allow_methods = ["GET", "POST", "DELETE", "HEAD"] # Max 6 chars per method (OPTIONS auto-handled)
    # Lowercase: AWS echoes these back lowercased — matching prevents a perpetual plan diff
    allow_headers = ["authorization", "content-type", "x-device-id", "idempotency-key"]
    max_age       = 600
  }
}

# Since Oct 2025 AWS requires BOTH lambda:InvokeFunctionUrl AND lambda:InvokeFunction
# permissions on the function's resource-based policy, even for NONE auth function URLs.
# Without the second statement every invoke fails with 403 Forbidden / AccessDeniedException.
# See: https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html
resource "aws_lambda_permission" "function_url_invoke" {
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.this.function_name
  principal                = "*"
  statement_id             = "FunctionURLInvokeAllowPublicAccess"
  invoked_via_function_url = true
}

# CloudWatch Log Group with 7-day retention (hackathon cost optimization)
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 7 # Short retention to stay within 5GB free tier

  tags = {
    Name = "Lambda Logs"
  }
}
