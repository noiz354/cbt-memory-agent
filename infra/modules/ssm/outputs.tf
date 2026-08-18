# SSM Module Outputs

output "parameter_paths" {
  description = "SSM parameter paths"
  value = {
    crdb_url              = aws_ssm_parameter.crdb_url.name
    cluster_id            = aws_ssm_parameter.crdb_cluster_id.name
    ccloud_api_key        = aws_ssm_parameter.ccloud_api_key.name
    pepper                = aws_ssm_parameter.app_pepper.name
    daily_cap             = aws_ssm_parameter.openrouter_daily_cap.name
    grafana_otlp_endpoint = aws_ssm_parameter.grafana_otlp_endpoint.name
    grafana_otlp_headers  = aws_ssm_parameter.grafana_otlp_headers.name
    phoenix_otlp_endpoint = try(aws_ssm_parameter.phoenix_otlp_endpoint[0].name, "")
    phoenix_otlp_headers  = try(aws_ssm_parameter.phoenix_otlp_headers[0].name, "")
  }
}
