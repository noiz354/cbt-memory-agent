#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-ssm-params.sh — Upload Credentials ke AWS SSM Parameter Store
# ─────────────────────────────────────────────────────────────────────────────
# Purpose: Securely store credentials in AWS SSM instead of .env files
# Usage:   bash scripts/setup-ssm-params.sh
#
# Prerequisites:
#   - AWS CLI installed and configured
#   - .env file dengan credentials
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Load .env if exists
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
  echo "✅ Loaded .env file"
fi

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
echo "🔐 AWS SSM Parameter Store Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
  log_error "AWS CLI not found. Install: pip install awscli"
  exit 1
fi
log_ok "AWS CLI found: $(aws --version 2>&1 | head -1)"

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
  log_error "AWS credentials not configured. Run: aws configure"
  exit 1
fi
log_ok "AWS credentials configured"

# Check required env vars
REQUIRED_VARS=(
  "CRDB_CONNECTION_URL"
  "CRDB_CLUSTER_ID"
  "CCLOUD_API_KEY"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    log_error "$var not set in .env"
    exit 1
  fi
done
log_ok "All required credentials found"

echo ""

# ─── Configuration ───────────────────────────────────────────────────────────
SSM_PREFIX="/cbt/hackathon"
AWS_REGION="${AWS_REGION:-ap-southeast-3}"

log_info "SSM Prefix: $SSM_PREFIX"
log_info "AWS Region: $AWS_REGION"
echo ""

# ─── Upload Parameters ───────────────────────────────────────────────────────
upload_param() {
  local name="$1"
  local value="$2"
  local description="$3"
  local type="${4:-SecureString}"  # Default to SecureString for secrets
  
  local full_name="$SSM_PREFIX/$name"
  
  log_info "Uploading: $full_name"
  
  aws ssm put-parameter \
    --name "$full_name" \
    --value "$value" \
    --type "$type" \
    --description "$description" \
    --overwrite \
    --region "$AWS_REGION" \
    --output json > /dev/null
  
  log_ok "  ✓ $full_name"
}

echo "📤 Uploading parameters to SSM..."
echo ""

# CockroachDB Connection
upload_param "crdb/connection-url" \
  "$CRDB_CONNECTION_URL" \
  "CockroachDB connection string with SSL"

upload_param "crdb/cluster-id" \
  "$CRDB_CLUSTER_ID" \
  "CockroachDB Cloud cluster UUID"

upload_param "crdb/host" \
  "${CRDB_HOST:-}" \
  "CockroachDB host"

upload_param "crdb/port" \
  "${CRDB_PORT:-26257}" \
  "CockroachDB port" \
  "String"  # Not sensitive

upload_param "crdb/database" \
  "${CRDB_DATABASE:-defaultdb}" \
  "CockroachDB database name" \
  "String"  # Not sensitive

# API Keys
upload_param "ccloud/api-key" \
  "$CCLOUD_API_KEY" \
  "CockroachDB Cloud API key (service account)"

# OpenRouter API key (LLM inference + embeddings)
upload_param "openrouter/api-key" \
  "$OPENROUTER_API_KEY" \
  "OpenRouter API key (LLM + embeddings)"

# App Config
upload_param "app/openrouter-daily-cap" \
  "${OPENROUTER_DAILY_CAP:-50}" \
  "Daily OpenRouter request limit" \
  "String"  # Not sensitive

upload_param "app/pepper" \
  "${APP_PEPPER:-$(openssl rand -hex 32)}" \
  "HMAC pepper for user ID generation"

# Grafana Cloud OTLP (OpenTelemetry — traces/logs/metrics)
upload_param "grafana/otlp-endpoint" \
  "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" \
  "Grafana Cloud OTLP gateway endpoint" \
  "String"  # Not sensitive

upload_param "grafana/otlp-headers" \
  "${OTEL_EXPORTER_OTLP_HEADERS:-}" \
  "Grafana Cloud OTLP auth headers (Authorization=Basic ...)"

echo ""

# ─── Verify Upload ───────────────────────────────────────────────────────────
log_info "Verifying uploaded parameters..."
echo ""

verify_param() {
  local name="$1"
  local full_name="$SSM_PREFIX/$name"
  
  local value=$(aws ssm get-parameter \
    --name "$full_name" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text \
    --region "$AWS_REGION" 2>/dev/null)
  
  if [[ -n "$value" ]]; then
    log_ok "  ✓ $full_name (length: ${#value})"
  else
    log_error "  ✗ $full_name NOT FOUND"
  fi
}

verify_param "crdb/connection-url"
verify_param "crdb/cluster-id"
verify_param "ccloud/api-key"
verify_param "app/openrouter-daily-cap"
verify_param "app/pepper"

echo ""

# ─── Generate IAM Policy ─────────────────────────────────────────────────────
log_info "Generating IAM policy for Lambda..."

cat > /tmp/cbt-ssm-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:aws:ssm:${AWS_REGION}:*:parameter${SSM_PREFIX}/*"
      ]
    }
  ]
}
EOF

log_ok "IAM policy saved to /tmp/cbt-ssm-policy.json"
echo ""

# ─── Update .env with SSM References ─────────────────────────────────────────
log_info "Updating .env with SSM references..."

cat >> .env <<EOF

# ─── SSM Parameter Store References ───────────────────────────────────────────
SSM_PREFIX=$SSM_PREFIX
AWS_REGION=$AWS_REGION
# Values now stored in SSM. Use aws ssm get-parameter to retrieve.
# Example: aws ssm get-parameter --name /cbt/hackathon/crdb/connection-url --with-decryption
SSM_SETUP_COMPLETED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

log_ok ".env updated with SSM references"
echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_ok "SSM Parameter Store Setup Complete!"
echo ""
echo "📊 Uploaded Parameters:"
echo "   $SSM_PREFIX/crdb/connection-url"
echo "   $SSM_PREFIX/crdb/cluster-id"
echo "   $SSM_PREFIX/crdb/host"
echo "   $SSM_PREFIX/crdb/port"
echo "   $SSM_PREFIX/crdb/database"
echo "   $SSM_PREFIX/ccloud/api-key"
echo "   $SSM_PREFIX/app/openrouter-daily-cap"
echo "   $SSM_PREFIX/app/pepper"
echo ""
echo "🎯 Next Steps:"
echo "   1. Attach IAM policy to Lambda role:"
echo "      aws iam put-role-policy \\"
echo "        --role-name your-lambda-role \\"
echo "        --policy-name CBT-SSM-Access \\"
echo "        --policy-document file:///tmp/cbt-ssm-policy.json"
echo ""
echo "   2. Update Lambda env vars to reference SSM:"
echo "      CRDB_URL = ssm:/cbt/hackathon/crdb/connection-url"
echo ""
echo "   3. Test retrieval:"
echo "      aws ssm get-parameter \\"
echo "        --name $SSM_PREFIX/crdb/connection-url \\"
echo "        --with-decryption"
echo ""
echo "📝 Documentation:"
echo "   - docs/INFRASTRUCTURE-NOTES.md"
echo ""
