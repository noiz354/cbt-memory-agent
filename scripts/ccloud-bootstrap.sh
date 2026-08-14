#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ccloud-bootstrap.sh — CockroachDB Cloud Cluster Bootstrap
# ─────────────────────────────────────────────────────────────────────────────
# Purpose: Provision cluster, apply schema, setup MCP, configure backups
# Usage:   bash scripts/ccloud-bootstrap.sh
#
# Prerequisites:
#   - ccloud CLI installed
#   - CCLOUD_API_KEY env var set (from .env file)
#   - AWS CLI installed (for SSM parameter upload)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Load .env if exists
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
  echo "✅ Loaded .env file"
fi

# ─── Configuration ───────────────────────────────────────────────────────────
CLUSTER_NAME="${CRDB_CLUSTER_NAME:-cbt-memory-agent}"
REGION="${CRDB_REGION:-ap-southeast-3}"  # Jakarta
SPEND_LIMIT="${CRDB_SPEND_LIMIT:-0.00}"
SCHEMA_FILE="${SCHEMA_FILE:-schema/crdb-schema.sql}"
GRANTS_FILE="${GRANTS_FILE:-schema/grants.sql}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_ok()    { echo -e "${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# ─── Pre-flight Checks ───────────────────────────────────────────────────────
echo ""
echo "🪳 CockroachDB Cloud Bootstrap"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check ccloud CLI
if ! command -v ccloud &> /dev/null; then
  log_error "ccloud CLI not found. Install: brew install cockroachdb/tap/ccloud"
  exit 1
fi
log_ok "ccloud CLI found: $(ccloud --version 2>/dev/null || echo 'unknown')"

# Check API key
if [[ -z "${CCLOUD_API_KEY:-}" ]]; then
  log_error "CCLOUD_API_KEY not set. Add to .env or export manually."
  exit 1
fi
log_ok "CCLOUD_API_KEY found"

# Check schema file
if [[ ! -f "$SCHEMA_FILE" ]]; then
  log_error "Schema file not found: $SCHEMA_FILE"
  exit 1
fi
log_ok "Schema file found: $SCHEMA_FILE"

echo ""

# ─── Step 1: Authenticate ────────────────────────────────────────────────────
log_info "Authenticating with CockroachDB Cloud..."
# ccloud 0.6.12 tidak mendukung `--api-key` → pakai device-code flow (headless).
# Verifikasi otomatis via REST API v1 di scripts/ccloud-auth.sh.
ccloud auth login --no-redirect
log_ok "Authenticated successfully"
echo ""

# ─── Step 2: Check or Create Cluster ─────────────────────────────────────────
log_info "Checking for existing cluster: $CLUSTER_NAME..."

EXISTING_CLUSTER=$(ccloud cluster list --output json 2>/dev/null | \
  python3 -c "
import sys, json
try:
    clusters = json.load(sys.stdin)
    for c in clusters.get('rows', []):
        if c.get('name') == '$CLUSTER_NAME':
            print(c['id'])
            break
except: pass
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_CLUSTER" ]]; then
  log_ok "Cluster already exists: $CLUSTER_NAME ($EXISTING_CLUSTER)"
  CLUSTER_ID="$EXISTING_CLUSTER"
else
  log_info "Creating new cluster: $CLUSTER_NAME in $REGION..."
  ccloud cluster create \
    --name "$CLUSTER_NAME" \
    --serverless \
    --cloud aws \
    --region "$REGION" \
    --spend-limit "$SPEND_LIMIT" \
    --wait

  CLUSTER_ID=$(ccloud cluster list --output json | \
    python3 -c "
import sys, json
clusters = json.load(sys.stdin)
for c in clusters.get('rows', []):
    if c.get('name') == '$CLUSTER_NAME':
        print(c['id'])
        break
")
  log_ok "Cluster created: $CLUSTER_ID"
fi

echo ""

# ─── Step 3: Get Connection Info ─────────────────────────────────────────────
log_info "Getting connection details..."

CONN_URL=$(ccloud cluster sql "$CLUSTER_NAME" --connection-url 2>/dev/null | tail -1)
log_ok "Connection URL: ${CONN_URL:0:50}..."

# Extract components for later use
CRDB_HOST=$(echo "$CONN_URL" | sed -n 's|.*//\([^:]*\):.*|\1|p')
CRDB_PORT=$(echo "$CONN_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
CRDB_DATABASE=$(echo "$CONN_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

echo ""

# ─── Step 4: Apply Schema ────────────────────────────────────────────────────
log_info "Applying schema from: $SCHEMA_FILE..."

# Use cockroach CLI if available, fallback to ccloud
if command -v cockroach &> /dev/null; then
  log_info "Using cockroach CLI..."
  cockroach sql --url "$CONN_URL" -f "$SCHEMA_FILE"
else
  log_warn "cockroach CLI not found, using ccloud sql (interactive mode may be required)"
  cat "$SCHEMA_FILE" | ccloud cluster sql "$CLUSTER_NAME"
fi

log_ok "Schema applied successfully"
echo ""

# ─── Step 5: Verify Deployment ───────────────────────────────────────────────
log_info "Verifying deployment..."

if command -v cockroach &> /dev/null; then
  TABLE_COUNT=$(cockroach sql --url "$CONN_URL" \
    -e "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" \
    2>/dev/null | tail -1)
  
  VIEW_COUNT=$(cockroach sql --url "$CONN_URL" \
    -e "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'VIEW';" \
    2>/dev/null | tail -1)
  
  log_ok "Tables: $TABLE_COUNT | Views: $VIEW_COUNT"
else
  log_warn "Skipping verification (cockroach CLI not available)"
fi

echo ""

# ─── Step 6: Setup MCP Server ────────────────────────────────────────────────
log_info "MCP Server setup..."
log_info "Endpoint: https://cockroachlabs.cloud/mcp"
log_info "Cluster ID: $CLUSTER_ID"
log_info "Configure AI tools with:"
echo ""
echo '  "mcpServers": {'
echo '    "cockroachdb-cloud": {'
echo '      "httpUrl": "https://cockroachlabs.cloud/mcp",'
echo '      "headers": {'
echo "        \"mcp-cluster-id\": \"$CLUSTER_ID\""
echo '      }'
echo '    }'
echo '  }'
echo ""
log_ok "MCP Server ready (authenticate via OAuth or API key)"
echo ""

# ─── Step 7: Setup Backup Schedule ───────────────────────────────────────────
log_info "Setting up automated backups..."

# Note: ccloud backup commands may vary — check docs for exact syntax
log_warn "Backup schedule setup requires Cloud Console or specific ccloud commands"
log_info "Recommended: Setup daily backups via Cloud Console → Backups → Schedule"
echo ""

# ─── Step 8: Export Connection Info ─────────────────────────────────────────
log_info "Exporting connection info to .env..."

cat >> .env <<EOF

# ─── Auto-generated by ccloud-bootstrap.sh ────────────────────────────────────
CRDB_CLUSTER_ID=$CLUSTER_ID
CRDB_HOST=$CRDB_HOST
CRDB_PORT=$CRDB_PORT
CRDB_DATABASE=$CRDB_DATABASE
CRDB_CONNECTION_URL=$CONN_URL
BOOTSTRAP_COMPLETED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

log_ok "Connection info appended to .env"
echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_ok "Bootstrap Complete!"
echo ""
echo "📊 Cluster:    $CLUSTER_NAME ($CLUSTER_ID)"
echo "🌐 Region:     $REGION"
echo "💰 Spend Limit: \$$SPEND_LIMIT/month"
echo "🔌 MCP:        https://cockroachlabs.cloud/mcp"
echo "📁 Schema:     $SCHEMA_FILE"
echo ""
echo "🎯 Next Steps:"
echo "   1. Setup SSM parameters: bash scripts/setup-ssm-params.sh"
echo "   2. Deploy Lambda:        cd lambda && npm run deploy"
echo "   3. Test health:          curl https://\$LAMBDA_URL/health"
echo "   4. Record demo video:    ≤ 3 minutes → YouTube"
echo ""
echo "📝 Documentation:"
echo "   - docs/SCHEMA-DEPLOYMENT.md"
echo "   - docs/MCP-SETUP-INSTRUCTIONS.md"
echo "   - docs/INFRASTRUCTURE-NOTES.md"
echo ""
