# API Gateway Module Variables

variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "lambda_arn" {
  description = "Lambda function ARN for integration"
  type        = string
}
