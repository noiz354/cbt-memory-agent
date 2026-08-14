# IAM Module Variables

variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-3"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "hackathon"
}

variable "s3_bucket" {
  description = "S3 bucket for export bundles"
  type        = string
  default     = "cbt-memory-exports"
}
