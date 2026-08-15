# Variables

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "ap-southeast-3"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "hackathon"
}

variable "function_name" {
  description = "Lambda function name"
  type        = string
  default     = "cbt-memory-agent"
}

variable "memory_size" {
  description = "Lambda memory in MB"
  type        = number
  default     = 256
}

variable "timeout" {
  description = "Lambda timeout in seconds (reflection cron needs >29s for LLM + embeddings)"
  type        = number
  default     = 300
}

variable "crdb_cluster_id" {
  description = "CockroachDB Cloud cluster ID"
  type        = string
  sensitive   = true
}

variable "crdb_connection_url" {
  description = "CockroachDB connection URL"
  type        = string
  sensitive   = true
}

variable "ccloud_api_key" {
  description = "CockroachDB Cloud API key"
  type        = string
  sensitive   = true
}

variable "app_pepper" {
  description = "HMAC pepper for user ID generation"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openrouter_daily_cap" {
  description = "Daily OpenRouter request limit"
  type        = number
  default     = 50
}

variable "openrouter_api_key" {
  description = "OpenRouter API key (sk-or-...)"
  type        = string
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend API key (re_...) for magic-link emails"
  type        = string
  sensitive   = true
}

variable "grafana_otlp_endpoint" {
  description = "Grafana Cloud OTLP gateway endpoint (https://otlp-gateway-...grafana.net/otlp)"
  type        = string
  default     = ""
}

variable "grafana_otlp_headers" {
  description = "Grafana Cloud OTLP auth headers (Authorization=Basic <base64(instance_id:token)>)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "email_from" {
  description = "From address for magic-link emails"
  type        = string
  default     = "onboarding@resend.dev"
}

variable "app_url" {
  description = "Public app origin used in magic-link emails (e.g. http://localhost:5173)"
  type        = string
  default     = "http://localhost:5173"
}

variable "s3_bucket" {
  description = "S3 bucket for export bundles"
  type        = string
  default     = "cbt-memory-exports"
}

variable "allowed_origin" {
  description = "CORS allowed origin for Lambda Function URL"
  type        = string
  default     = "*"
}

variable "alert_emails" {
  description = "Email addresses for budget/cloudwatch alerts"
  type        = list(string)
  default     = []
}
