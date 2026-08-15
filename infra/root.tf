# Root Module — Connect All Modules

# SSM Parameters
module "ssm" {
  source = "./modules/ssm"

  environment           = var.environment
  crdb_connection_url   = var.crdb_connection_url
  crdb_cluster_id       = var.crdb_cluster_id
  ccloud_api_key        = var.ccloud_api_key
  app_pepper            = var.app_pepper
  openrouter_daily_cap  = var.openrouter_daily_cap
  openrouter_api_key    = var.openrouter_api_key
  resend_api_key        = var.resend_api_key
  grafana_otlp_endpoint = var.grafana_otlp_endpoint
  grafana_otlp_headers  = var.grafana_otlp_headers
}

# IAM
module "iam" {
  source = "./modules/iam"

  function_name = var.function_name
  aws_region    = var.aws_region
  environment   = var.environment
  s3_bucket     = var.s3_bucket
}

# Lambda
module "lambda" {
  source = "./modules/lambda"

  function_name  = var.function_name
  role_arn       = module.iam.lambda_role_arn
  environment    = var.environment
  aws_region     = var.aws_region
  s3_bucket      = var.s3_bucket
  allowed_origin = var.allowed_origin
  email_from     = var.email_from
  app_url        = var.app_url
  memory_size    = var.memory_size
  timeout        = var.timeout

  depends_on = [module.iam, module.ssm]
}

# Budget & Cost Monitoring
module "budget" {
  source = "./modules/budget"

  alert_emails = var.alert_emails

  depends_on = [module.lambda]
}
