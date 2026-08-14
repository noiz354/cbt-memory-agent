# Variables

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
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
  description = "Lambda timeout in seconds"
  type        = number
  default     = 29  # Not 30!
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
