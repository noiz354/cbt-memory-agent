#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ccloud-auth.sh — Auth + verifikasi CockroachDB Cloud (headless)
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   bash scripts/ccloud-auth.sh              → device-code flow (ccloud CLI, --no-redirect)
#   bash scripts/ccloud-auth.sh api          → non-interactive (REST v1, zero keyboard)
#   bash scripts/ccloud-auth.sh api --quiet  → hanya "OK"/"FAIL" + exit 0/1 (cron/CI)
#
# Prerequisites:
#   - Mode default: ccloud CLI ter-install (ccloud --version)
#   - Mode api:     CCLOUD_API_KEY di .env atau environment (CCDB1_...)
#
# Catatan:
#   - Flag `--api-key` TIDAK ada di ccloud 0.6.12 → pakai --no-redirect (device-code)
#     atau REST API v1 di mode api. (docs lama menyebut `--api-key -` — tidak valid.)
#   - REST API memakai endpoint v1. `/api/v2/*` mengembalikan 404.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Load .env jika ada ──────────────────────────────────────────────────────
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_ok()    { echo -e "${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

API_BASE="https://cockroachlabs.cloud/api/v1"
MCP_URL="https://cockroachlabs.cloud/mcp"

# ─── Mode: device-code flow (ccloud CLI) ─────────────────────────────────────
device_code_mode() {
  if ! command -v ccloud &> /dev/null; then
    log_error "ccloud CLI not found. Install (Linux): curl -fsSL https://binaries.cockroachdb.com/ccloud/ccloud_linux-amd64_0.6.12.tar.gz | tar -xz && sudo cp ccloud /usr/local/bin/"
    exit 1
  fi

  log_info "Login ccloud (device-code flow, headless)..."
  log_info "Buka URL yang tampil, masukkan code, lalu klik authorize."
  ccloud auth login --no-redirect

  echo ""
  log_ok "Verifikasi login:"
  ccloud auth whoami

  echo ""
  log_info "Cluster list:"
  ccloud cluster list
}

# ─── Mode: REST API v1 (non-interactive) ────────────────────────────────────
api_mode() {
  local quiet="${1:-}"

  if [[ -z "${CCLOUD_API_KEY:-}" ]]; then
    if [[ -n "$quiet" ]]; then
      echo "FAIL"
      exit 1
    fi
    log_error "CCLOUD_API_KEY not set. Tambahkan ke .env atau export."
    exit 1
  fi

  local clusters_json
  clusters_json=$(curl -s --max-time 15 -H "Authorization: Bearer $CCLOUD_API_KEY" "$API_BASE/clusters")

  local cluster_count
  cluster_count=$(printf '%s' "$clusters_json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(len(data.get('clusters', [])))
except Exception:
    print('0')
" 2>/dev/null || echo "0")

  if [[ "$cluster_count" == "0" ]]; then
    if [[ -n "$quiet" ]]; then
      echo "FAIL"
      exit 1
    fi
    log_error "API auth gagal atau tidak ada cluster. Response: $(printf '%s' "$clusters_json" | head -c 200)"
    exit 1
  fi

  if [[ -n "$quiet" ]]; then
    echo "OK"
    exit 0
  fi

  log_ok "API v1 auth sukses — $cluster_count cluster ditemukan."
  echo ""
  printf '%s' "$clusters_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('clusters', []):
    print(f\"  - {c.get('name', '?')}  [state={c.get('state', '?')}  plan={c.get('plan', '?')}  region={c.get('region', '?')}  id={c.get('id', '?')}]\")
"

  # ── Per-cluster: cek databases (health check) ──────────────────────────────
  echo ""
  printf '%s' "$clusters_json" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('clusters', []):
    print(c.get('id', ''))
" 2>/dev/null | while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    log_info "Database untuk cluster $cid:"
    curl -s --max-time 15 -H "Authorization: Bearer $CCLOUD_API_KEY" "$API_BASE/clusters/$cid/databases" \
      | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for db in data.get('databases', []):
        print(f\"   - {db.get('name', '?')}  ({db.get('table_count', '?')} tabel)\")
except Exception:
    print('   (gagal parse)')
"
  done

  # ── Cek MCP endpoint reachable ─────────────────────────────────────────────
  echo ""
  log_info "Cek MCP endpoint reachable: $MCP_URL"
  local mcp_status
  mcp_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -H "Authorization: Bearer $CCLOUD_API_KEY" "$MCP_URL" 2>/dev/null || echo "000")
  if [[ "$mcp_status" == "000" ]]; then
    log_warn "MCP endpoint tidak reachable (network/blocked). Status: $mcp_status"
  else
    log_ok "MCP endpoint merespon. HTTP status: $mcp_status"
  fi

  echo ""
  log_ok "Selesai."
}

# ─── Main ────────────────────────────────────────────────────────────────────
mode="${1:-default}"

case "$mode" in
  api)
    api_mode "${2:-}"
    ;;
  default)
    device_code_mode
    ;;
  *)
    echo "Usage: bash scripts/ccloud-auth.sh [default|api [--quiet]]"
    exit 1
    ;;
esac
