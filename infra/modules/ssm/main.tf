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

# Generate random pepper if not provided
resource "random_password" "pepper" {
  length  = 32
  special = false
}
