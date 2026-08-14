# SSM Module Variables

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "hackathon"
}

variable "crdb_connection_url" {
  description = "CockroachDB connection URL"
  type        = string
  sensitive   = true
}

variable "crdb_cluster_id" {
  description = "CockroachDB Cloud cluster ID"
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
