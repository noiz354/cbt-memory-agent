# Lambda Function Module

# Read SSM parameters created by the ssm module (secure values)
data "aws_ssm_parameter" "crdb_url" {
  name = "/${var.environment}/crdb/connection-url"
}

data "aws_ssm_parameter" "ccloud_api_key" {
  name = "/${var.environment}/ccloud/api-key"
}

resource "aws_lambda_function" "this" {
  function_name = var.function_name
  description   = "CBT Memory Agent API — CockroachDB x AWS Hackathon 2026"
  role          = aws_iam_role.lambda_execution.arn
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
      NODE_ENV       = "production"
      CRDB_CONNECTION = data.aws_ssm_parameter.crdb_url.value
      CCLOUD_API_KEY  = data.aws_ssm_parameter.ccloud_api_key.value
      BEDROCK_REGION  = var.aws_region
      S3_BUCKET       = var.s3_bucket
      ALLOWED_ORIGIN  = var.allowed_origin
    }
  }

  # No VPC — Lambda accesses public endpoints (CockroachDB, Bedrock)
  # This saves $32/month NAT Gateway cost

  tags = {
    Name = var.function_name
  }
}

# Lambda Function URL (cheaper than API Gateway — 71% savings)
resource "aws_lambda_function_url" "this" {
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE"  # Demo only — add auth for production

  cors {
    allow_origins = ["*"]  # Restrict to frontend domain in production
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization", "X-Device-Id", "Idempotency-Key"]
    max_age       = 600
  }
}

# CloudWatch Log Group with 7-day retention (hackathon cost optimization)
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 7  # Short retention to stay within 5GB free tier

  tags = {
    Name = "Lambda Logs"
  }
}
