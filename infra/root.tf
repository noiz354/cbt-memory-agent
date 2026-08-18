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
  phoenix_otlp_endpoint = var.phoenix_otlp_endpoint
  phoenix_otlp_headers  = var.phoenix_otlp_headers
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

  function_name           = var.function_name
  role_arn                = module.iam.lambda_role_arn
  environment             = var.environment
  aws_region              = var.aws_region
  s3_bucket               = var.s3_bucket
  allowed_origin          = var.allowed_origin
  s3_cors_allowed_origins = var.s3_cors_allowed_origins
  email_from              = var.email_from
  app_url                 = var.app_url
  memory_size             = var.memory_size
  timeout                 = var.timeout
  phoenix_otlp_endpoint   = var.phoenix_otlp_endpoint
  phoenix_otlp_headers    = var.phoenix_otlp_headers

  # module.oidc: role-policy CI diperbarui di-sequencing SEBELUM panggilan
  # S3 CORS di apply yang sama (hindari IAM-propagation race di CI).

  depends_on = [module.iam, module.ssm, module.oidc]
}

# EventBridge — agentic memory reflection cron (tiap 6 jam)
module "eventbridge" {
  source = "./modules/eventbridge"

  function_name        = var.function_name
  lambda_function_arn  = module.lambda.function_arn
  lambda_function_name = module.lambda.function_name

  depends_on = [module.lambda]
}

# Frontend — S3 + CloudFront (SPA + proxy /api/v1 → Lambda Function URL)
module "frontend" {
  source = "./modules/frontend"

  bucket_name       = var.frontend_bucket
  api_origin_domain = trim(replace(module.lambda.function_url, "https://", ""), "/")

  depends_on = [module.lambda]
}

# GitHub OIDC — GitHub Actions deploy tanpa static AWS keys
module "oidc" {
  source = "./modules/oidc"

  github_owner    = var.github_owner
  github_repo     = var.github_repo
  aws_account_id  = var.aws_account_id
  aws_region      = var.aws_region
  environment     = var.environment
  function_name   = var.function_name
  s3_bucket       = var.s3_bucket
  frontend_bucket = var.frontend_bucket
}
