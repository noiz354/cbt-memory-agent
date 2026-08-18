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
}

variable "grafana_otlp_headers" {
  description = "Grafana Cloud OTLP auth headers (Authorization=Basic <base64(instance_id:token)>)"
  type        = string
  sensitive   = true
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
