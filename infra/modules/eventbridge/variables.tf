# EventBridge Module — Variables

variable "function_name" {
  description = "Lambda function name (prefix untuk rule/target naming)"
  type        = string
}

variable "lambda_function_arn" {
  description = "ARN dari Lambda yang akan dipicu"
  type        = string
}

variable "lambda_function_name" {
  description = "Nama Lambda function (untuk resource-based policy)"
  type        = string
}

variable "schedule_expression" {
  description = "Cron/schedule EventBridge (default: tiap 6 jam)"
  type        = string
  default     = "rate(6 hours)"
}
