# Lambda Module Variables

variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "role_arn" {
  description = "IAM role ARN for Lambda execution"
  type        = string
}

variable "environment" {
  description = "Environment name (used for SSM parameter paths)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for Lambda deployment"
  type        = string
  default     = "ap-southeast-3"
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

variable "s3_cors_allowed_origins" {
  description = "Origins yang diizinkan akses langsung ke bucket media dari browser (S3 CORS): PUT/GET/HEAD/DELETE."
  type        = list(string)
  default     = ["http://localhost:5173"]
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

variable "phoenix_otlp_endpoint" {
  description = "Arize Phoenix OTLP endpoint (self-hosted EC2, HTTP di port UI). Kosong = Phoenix dinonaktifkan."
  type        = string
  default     = ""
}

variable "phoenix_otlp_headers" {
  description = "Arize Phoenix OTLP auth headers (Authorization=Bearer <system-api-key>)"
  type        = string
  sensitive   = true
  default     = ""
}
