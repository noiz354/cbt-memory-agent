# Lambda Module Variables

variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "environment" {
  description = "Environment name (used for SSM parameter paths)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for Bedrock"
  type        = string
  default     = "us-east-1"
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

variable "memory_size" {
  description = "Lambda memory in MB"
  type        = number
  default     = 256
}

variable "timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 29
}
