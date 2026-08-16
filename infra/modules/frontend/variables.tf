# Frontend Module Variables

variable "bucket_name" {
  description = "S3 bucket for the deployed frontend"
  type        = string
  default     = "cbt-memory-agent-frontend"
}

variable "api_origin_domain" {
  description = "Lambda Function URL host (no scheme, e.g. xyz.lambda-url.ap-southeast-3.on.aws)"
  type        = string
}
