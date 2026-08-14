#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-cloudwatch.sh — CloudWatch Metrics + Alarms Setup
# ─────────────────────────────────────────────────────────────────────────────
# Purpose: Setup 10 custom metrics + alarms untuk CBT Memory Agent
# Usage:   bash scripts/setup-cloudwatch.sh
#
# Metrics:
#   1. complete_ms — LLM response latency
#   2. recall_ms — ANN query latency
#   3. ann_used — Vector index hit (0/1)
#   4. openrouter_429 — Rate limit hits
#   5. openrouter_calls — Daily API calls
#   6. crisis_short_circuit — Crisis detected
#   7. redact_drops — Redacted spans
#   8. cache_hit — Completion cache hit rate
#   9. lambda_errors — 5xx rate
#   10. consolidate_ms — Step Functions duration
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_ok()    { echo -e "${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# ─── Pre-flight Checks ───────────────────────────────────────────────────────
echo ""
echo "📊 CloudWatch Metrics + Alarms Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
  log_error "AWS CLI not found. Install: pip install awscli"
  exit 1
fi
log_ok "AWS CLI found"

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
  log_error "AWS credentials not configured. Run: aws configure"
  exit 1
fi
log_ok "AWS credentials configured"

# Check Lambda function exists
FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-cbt-memory-agent}"
AWS_REGION="${AWS_REGION:-ap-southeast-3}"

if ! aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" &>/dev/null; then
  log_warn "Lambda function '$FUNCTION_NAME' not found. Alarms will be created but may not trigger until function exists."
else
  log_ok "Lambda function found: $FUNCTION_NAME"
fi

echo ""

# ─── Configuration ───────────────────────────────────────────────────────────
NAMESPACE="CBTMemoryAgent"

# ─── Create Alarms ───────────────────────────────────────────────────────────
create_alarm() {
  local name="$1"
  local metric="$2"
  local threshold="$3"
  local comparison="$4"
  local description="$5"
  local severity="${6:-SEV2}"
  
  log_info "Creating alarm: $name ($description)"
  
  aws cloudwatch put-metric-alarm \
    --alarm-name "CBT-$name" \
    --alarm-description "$description [$severity]" \
    --metric-name "$metric" \
    --namespace "$NAMESPACE" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 2 \
    --threshold "$threshold" \
    --comparison-operator "$comparison" \
    --dimensions Name=FunctionName,Value="$FUNCTION_NAME" \
    --treat-missing-data notBreaching \
    --region "$AWS_REGION" \
    --output json > /dev/null
  
  log_ok "  ✓ $name"
}

echo "🚨 Creating CloudWatch Alarms..."
echo ""

# 1. Lambda Errors > 5 per 5min
create_alarm \
  "LambdaErrors" \
  "Errors" \
  5 \
  "GreaterThanThreshold" \
  "Lambda 5xx error rate > 5 per 5min" \
  "SEV1"

# 2. Lambda Duration > 25s (approaching 30s timeout)
create_alarm \
  "LambdaDuration" \
  "Duration" \
  25000 \
  "GreaterThanThreshold" \
  "Lambda avg duration > 25s (approaching 30s timeout)" \
  "SEV2"

# 3. ANN not used (vector index miss)
create_alarm \
  "ANNMiss" \
  "ann_used" \
  0 \
  "LessThanOrEqualToThreshold" \
  "Vector ANN not being used (full scan fallback)" \
  "SEV2"

# 4. OpenRouter 429 rate limit
create_alarm \
  "OpenRouter429" \
  "openrouter_429" \
  10 \
  "GreaterThanThreshold" \
  "OpenRouter rate limit hit > 10 per 5min" \
  "SEV2"

# 5. OpenRouter daily cap approaching
create_alarm \
  "OpenRouterDailyCap" \
  "openrouter_calls" \
  45 \
  "GreaterThanThreshold" \
  "OpenRouter daily cap approaching (45/50)" \
  "SEV2"

# 6. Crisis short-circuit missing (SEV0 — should always fire on crisis)
create_alarm \
  "CrisisMissing" \
  "crisis_short_circuit" \
  0 \
  "LessThanOrEqualToThreshold" \
  "Crisis detection not firing (potential SEV0)" \
  "SEV0"

# 7. Cache hit rate < 20%
create_alarm \
  "LowCacheHit" \
  "cache_hit" \
  20 \
  "LessThanThreshold" \
  "Completion cache hit rate < 20%" \
  "SEV3"

# 8. Recall latency > 150ms (SLO)
create_alarm \
  "RecallLatency" \
  "recall_ms" \
  150 \
  "GreaterThanThreshold" \
  "ANN recall latency > 150ms (SLO breach)" \
  "SEV2"

# 9. Consolidation duration > 30s
create_alarm \
  "ConsolidationSlow" \
  "consolidate_ms" \
  30000 \
  "GreaterThanThreshold" \
  "Step Functions consolidation > 30s" \
  "SEV3"

echo ""

# ─── Setup Metric Filters ────────────────────────────────────────────────────
log_info "Setting up metric filters for Lambda logs..."

LOG_GROUP="/aws/lambda/$FUNCTION_NAME"

create_metric_filter() {
  local filter_name="$1"
  local metric_name="$2"
  local pattern="$3"
  
  log_info "Creating filter: $filter_name"
  
  aws logs put-metric-filter \
    --log-group-name "$LOG_GROUP" \
    --filter-name "CBT-$filter_name" \
    --filter-pattern "$pattern" \
    --metric-transformations \
      metricName="$metric_name" \
      metricNamespace="$NAMESPACE" \
      metricValue=1 \
    --region "$AWS_REGION" \
    --output json > /dev/null
  
  log_ok "  ✓ $filter_name → $metric_name"
}

echo ""
echo "📈 Creating Metric Filters..."
echo ""

# Filter for custom metrics from EMF logs
create_metric_filter "CompleteLatency" "complete_ms" '{$.complete_ms = *}'
create_metric_filter "RecallLatency" "recall_ms" '{$.recall_ms = *}'
create_metric_filter "ANNUsed" "ann_used" '{$.ann_used = *}'
create_metric_filter "OpenRouter429" "openrouter_429" '{$.openrouter_429 = *}'
create_metric_filter "OpenRouterCalls" "openrouter_calls" '{$.openrouter_calls = *}'
create_metric_filter "CrisisShortCircuit" "crisis_short_circuit" '{$.crisis_engaged = true}'
create_metric_filter "RedactDrops" "redact_drops" '{$.redact_drops = *}'
create_metric_filter "CacheHit" "cache_hit" '{$.cache_hit = *}'
create_metric_filter "ConsolidateMs" "consolidate_ms" '{$.consolidate_ms = *}'

echo ""

# ─── Setup Dashboard ─────────────────────────────────────────────────────────
log_info "Creating CloudWatch Dashboard..."

aws cloudwatch put-dashboard \
  --dashboard-name "CBTMemoryAgent" \
  --dashboard-body '{
    "widgets": [
      {
        "type": "metric",
        "x": 0, "y": 0, "width": 12, "height": 6,
        "properties": {
          "metrics": [
            ["CBTMemoryAgent", "complete_ms", "FunctionName", "cbt-memory-agent"],
            ["CBTMemoryAgent", "recall_ms", "FunctionName", "cbt-memory-agent"]
          ],
          "period": 300,
          "stat": "Average",
          "title": "Latency (ms)"
        }
      },
      {
        "type": "metric",
        "x": 12, "y": 0, "width": 12, "height": 6,
        "properties": {
          "metrics": [
            ["CBTMemoryAgent", "openrouter_calls", "FunctionName", "cbt-memory-agent"],
            ["CBTMemoryAgent", "openrouter_429", "FunctionName", "cbt-memory-agent"]
          ],
          "period": 300,
          "stat": "Sum",
          "title": "OpenRouter Usage"
        }
      },
      {
        "type": "metric",
        "x": 0, "y": 6, "width": 12, "height": 6,
        "properties": {
          "metrics": [
            ["CBTMemoryAgent", "ann_used", "FunctionName", "cbt-memory-agent"],
            ["CBTMemoryAgent", "cache_hit", "FunctionName", "cbt-memory-agent"]
          ],
          "period": 300,
          "stat": "Average",
          "title": "Performance Metrics"
        }
      },
      {
        "type": "metric",
        "x": 12, "y": 6, "width": 12, "height": 6,
        "properties": {
          "metrics": [
            ["CBTMemoryAgent", "crisis_short_circuit", "FunctionName", "cbt-memory-agent"],
            ["AWS/Lambda", "Errors", "FunctionName", "cbt-memory-agent"]
          ],
          "period": 300,
          "stat": "Sum",
          "title": "Errors & Crisis"
        }
      }
    ]
  }' \
  --region "$AWS_REGION" \
  --output json > /dev/null

log_ok "Dashboard created: CBTMemoryAgent"

echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_ok "CloudWatch Setup Complete!"
echo ""
echo "📊 Metrics (10):"
echo "   1. complete_ms — LLM response latency"
echo "   2. recall_ms — ANN query latency (SLO: <150ms)"
echo "   3. ann_used — Vector index hit (0/1)"
echo "   4. openrouter_429 — Rate limit hits"
echo "   5. openrouter_calls — Daily API calls (cap: 50)"
echo "   6. crisis_short_circuit — Crisis detected"
echo "   7. redact_drops — Redacted spans"
echo "   8. cache_hit — Completion cache hit rate"
echo "   9. lambda_errors — 5xx rate"
echo "   10. consolidate_ms — Step Functions duration"
echo ""
echo "🚨 Alarms (9):"
echo "   - LambdaErrors (>5 per 5min) [SEV1]"
echo "   - LambdaDuration (>25s) [SEV2]"
echo "   - ANNMiss (vector index miss) [SEV2]"
echo "   - OpenRouter429 (>10 per 5min) [SEV2]"
echo "   - OpenRouterDailyCap (>45/50) [SEV2]"
echo "   - CrisisMissing (SEV0 drill) [SEV0]"
echo "   - LowCacheHit (<20%) [SEV3]"
echo "   - RecallLatency (>150ms SLO) [SEV2]"
echo "   - ConsolidationSlow (>30s) [SEV3]"
echo ""
echo "📈 Dashboard: CBTMemoryAgent"
echo "   View: https://console.aws.amazon.com/cloudwatch/home#dashboards/dashboard:CBTMemoryAgent"
echo ""
echo "🎯 Next Steps:"
echo "   1. Deploy Lambda: cd lambda && npm run deploy"
echo "   2. Test alarms: Invoke Lambda with test payloads"
echo "   3. Monitor dashboard: CloudWatch → Dashboards → CBTMemoryAgent"
echo ""
