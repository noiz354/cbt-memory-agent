# GitHub OIDC Module Variables

variable "github_owner" {
  description = "GitHub owner (user/org) of the repository"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID (12 digits)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "environment" {
  description = "Environment name (used in SSM param paths)"
  type        = string
}

variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "s3_bucket" {
  description = "S3 bucket for export bundles (managed by lambda module)"
  type        = string
}

variable "frontend_bucket" {
  description = "Frontend S3 bucket"
  type        = string
}
