# EventBridge Module — agentic memory reflection cron
#
# Memicu Lambda `agent.memory.reflect` tiap 6 jam (cron). Event berformat
# `{ source: "agent.memory", "detail-type": "reflect" }` yang dipilih langsung
# di handler (lambda/handler.ts) tanpa API Gateway.

resource "aws_cloudwatch_event_rule" "reflect" {
  name                = "${var.function_name}-reflect"
  description         = "Agentic memory loop — ekstraksi durable memory dari chat_turns tiap 6 jam"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "reflect" {
  rule  = aws_cloudwatch_event_rule.reflect.name
  arn   = var.lambda_function_arn
  input = jsonencode({
    source      = "agent.memory"
    "detail-type" = "reflect"
  })
}

resource "aws_lambda_permission" "eventbridge" {
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reflect.arn
  statement_id  = "AllowExecutionFromEventBridge"
}
