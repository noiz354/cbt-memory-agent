# SSM Parameters Module

resource "aws_ssm_parameter" "crdb_url" {
  name        = "/${var.environment}/crdb/connection-url"
  description = "CockroachDB connection URL"
  type        = "SecureString"
  value       = var.crdb_connection_url

  tags = {
    Name = "CRDB Connection URL"
  }
}

resource "aws_ssm_parameter" "crdb_cluster_id" {
  name        = "/${var.environment}/crdb/cluster-id"
  description = "CockroachDB Cloud cluster UUID"
  type        = "SecureString"
  value       = var.crdb_cluster_id

  tags = {
    Name = "CRDB Cluster ID"
  }
}

resource "aws_ssm_parameter" "ccloud_api_key" {
  name        = "/${var.environment}/ccloud/api-key"
  description = "CockroachDB Cloud API key"
  type        = "SecureString"
  value       = var.ccloud_api_key

  tags = {
    Name = "CockroachDB Cloud API Key"
  }
}

resource "aws_ssm_parameter" "app_pepper" {
  name        = "/${var.environment}/app/pepper"
  description = "HMAC pepper for user ID generation"
  type        = "SecureString"
  value       = var.app_pepper != "" ? var.app_pepper : random_password.pepper.result

  tags = {
    Name = "App Pepper"
  }
}

resource "aws_ssm_parameter" "openrouter_daily_cap" {
  name        = "/${var.environment}/app/openrouter-daily-cap"
  description = "Daily OpenRouter request limit"
  type        = "String"
  value       = tostring(var.openrouter_daily_cap)

  tags = {
    Name = "OpenRouter Daily Cap"
  }
}

resource "aws_ssm_parameter" "openrouter_api_key" {
  name        = "/${var.environment}/openrouter/api-key"
  description = "OpenRouter API key"
  type        = "SecureString"
  value       = var.openrouter_api_key

  tags = {
    Name = "OpenRouter API Key"
  }
}

resource "aws_ssm_parameter" "resend_api_key" {
  name        = "/${var.environment}/resend/api-key"
  description = "Resend API key for magic-link emails"
  type        = "SecureString"
  value       = var.resend_api_key

  tags = {
    Name = "Resend API Key"
  }
}

resource "aws_ssm_parameter" "grafana_otlp_endpoint" {
  name        = "/${var.environment}/grafana/otlp-endpoint"
  description = "Grafana Cloud OTLP gateway endpoint"
  type        = "String"
  value       = var.grafana_otlp_endpoint

  tags = {
    Name = "Grafana OTLP Endpoint"
  }
}

resource "aws_ssm_parameter" "grafana_otlp_headers" {
  name        = "/${var.environment}/grafana/otlp-headers"
  description = "Grafana Cloud OTLP auth headers (Authorization=Basic ...)"
  type        = "SecureString"
  value       = var.grafana_otlp_headers

  tags = {
    Name = "Grafana OTLP Headers"
  }
}

resource "aws_ssm_parameter" "phoenix_otlp_endpoint" {
  count       = var.phoenix_otlp_endpoint != "" ? 1 : 0
  name        = "/${var.environment}/phoenix/otlp-endpoint"
  description = "Arize Phoenix OTLP endpoint (self-hosted EC2, HTTP di port UI)"
  type        = "String"
  value       = var.phoenix_otlp_endpoint

  tags = {
    Name = "Phoenix OTLP Endpoint"
  }
}

resource "aws_ssm_parameter" "phoenix_otlp_headers" {
  count       = var.phoenix_otlp_headers != "" ? 1 : 0
  name        = "/${var.environment}/phoenix/otlp-headers"
  description = "Arize Phoenix OTLP auth headers (Authorization=Bearer <system-api-key>)"
  type        = "SecureString"
  value       = var.phoenix_otlp_headers

  tags = {
    Name = "Phoenix OTLP Headers"
  }
}

# Generate random pepper if not provided
resource "random_password" "pepper" {
  length  = 32
  special = false
}
