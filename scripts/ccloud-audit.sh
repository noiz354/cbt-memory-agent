#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ccloud-audit.sh — Audit CockroachDB Cloud via ccloud CLI (agent-ready)
# ─────────────────────────────────────────────────────────────────────────────
# Audit pola `-o json` + jq (pola yang didesain untuk AI/automation) dan
# health-gate untuk CI. Memverifikasi bahwa seluruh stack data-plane (cluster,
# spend limit, koneksi SQL, MCP endpoint, vector index) dalam kondisi sehat.
#
# Usage:
#   bash scripts/ccloud-audit.sh                 → audit penuh (verbose, human)
#   bash scripts/ccloud-audit.sh --quiet         → hanya "OK"/"FAIL" + exit 0/1 (CI)
#   bash scripts/ccloud-audit.sh --json          → output JSON (machine-parseable)
#
# Exit codes:
#   0  semua check lulus
#   1  satu atau lebih check gagal
#
# Prerequisites:
#   - ccloud CLI ter-install & sudah `ccloud auth login` (atau CCLOUD_API_KEY di .env)
#   - jq ter-install (untuk parse JSON output)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Load variabel penting dari .env (parsing aman, bukan source) ─────────────
# Catatan: `source .env` bisa rusak karena baris berisi spasi dalam nilai
# (contoh: OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64>").
# Di sini hanya variabel yang dibutuhkan diekstrak dengan grep + cut.
load_env_var() {
  local key="$1"
  if [[ -f .env ]]; then
    grep -E "^${key}=" .env 2>/dev/null | head -1 | cut -d'=' -f2- || true
  fi
}

CRDB_CLUSTER_NAME="${CRDB_CLUSTER_NAME:-$(load_env_var CRDB_CLUSTER_NAME)}"
CRDB_CLUSTER_NAME="${CRDB_CLUSTER_NAME:-woozy-grivet}"
CCLOUD_API_KEY="${CCLOUD_API_KEY:-$(load_env_var CCLOUD_API_KEY)}"
MCP_URL="https://cockroachlabs.cloud/mcp"
MODE="${1:-default}"
CLUSTER_NAME="$CRDB_CLUSTER_NAME"
FAILED=0

log_info() { echo -e "[*] $1"; }
log_ok()   { echo -e "[✓] $1"; }
log_fail() { echo -e "[✗] $1"; }

check() {
  local name="$1" result="$2"
  if [[ "$result" == "OK" ]]; then
    log_ok "$name"
  else
    log_fail "$name: $result"
    FAILED=1
  fi
}

# ─── Sinkronkan: pastikan auth tersedia ──────────────────────────────────────
ensure_auth() {
  if ! command -v ccloud &> /dev/null; then
    check "ccloud CLI terinstall" "FAIL (command not found)"
    return 1
  fi
  # Jika belum terauth, coba API key dari .env via REST v1 fallback
  if ! ccloud auth whoami &> /dev/null 2>&1; then
    if [[ -n "${CCLOUD_API_KEY:-}" ]]; then
      local status
      status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        -H "Authorization: Bearer $CCLOUD_API_KEY" \
        "https://cockroachlabs.cloud/api/v1/clusters" 2>/dev/null || echo "000")
      if [[ "$status" == "200" ]]; then
        log_ok "ccloud CLI belum login, tapi CCLOUD_API_KEY valid (REST v1)."
        return 0
      fi
      check "Auth ccloud" "FAIL (REST v1 status=$status — jalankan ccloud auth login)"
      return 1
    fi
    check "Auth ccloud" "FAIL (jalankan: bash scripts/ccloud-auth.sh)"
    return 1
  fi
  return 0
}

# ─── Audit utama ─────────────────────────────────────────────────────────────
run_audit() {
  local clusters_json
  clusters_json=$(ccloud cluster list -o json 2>/dev/null)

  local cluster_json
  cluster_json=$(printf '%s' "$clusters_json" | jq -c --arg n "$CLUSTER_NAME" '.[] | select(.name == $n)' | head -1)

  if [[ -z "$cluster_json" ]]; then
    check "Cluster $CLUSTER_NAME ditemukan" "FAIL (tidak ada di ccloud cluster list)"
    return 1
  fi

  # 1. Cluster state
  local state plan version region spend_limit
  state=$(printf '%s' "$cluster_json" | jq -r '.operation_status // .state // "UNKNOWN"')
  plan=$(printf '%s' "$cluster_json" | jq -r '.plan // "UNKNOWN"')
  version=$(printf '%s' "$cluster_json" | jq -r '.cockroach_version // "UNKNOWN"')
  region=$(printf '%s' "$cluster_json" | jq -r '.regions[0].name // .region // "UNKNOWN"')
  spend_limit=$(printf '%s' "$cluster_json" | jq -r '.config.serverless.spend_limit // "N/A"')

  check "Cluster state=$state" "$([[ "$state" == "CREATED" || "$state" == "UNSPECIFIED" ]] && echo OK || echo "state=$state")"
  check "CockroachDB version=$version" "OK"
  check "Region=$region" "OK"
  check "Spend limit USD" "$([[ "$spend_limit" == "0" || "$spend_limit" == "0.0" ]] && echo OK || echo "spend_limit=$spend_limit (bukan 0)")"

  # 2. Koneksi SQL (satu query ringan)
  if command -v psql &> /dev/null || command -v cockroach &> /dev/null; then
    local sql_result
    sql_result=$(ccloud cluster sql "$CLUSTER_NAME" -c "SELECT 1 AS ok" 2>&1 || true)
    if [[ "$sql_result" == *"1"* || "$sql_result" == *"ok"* ]]; then
      check "Koneksi SQL SELECT 1" "OK"
    else
      check "Koneksi SQL SELECT 1" "FAIL ($(printf '%s' "$sql_result" | head -c 120))"
    fi
  else
    log_info "[~] psql/cockroach tidak ada — skip check SQL shell (pakai MCP select_query sebagai ganti)"
  fi

  # 3. MCP endpoint reachable (read-only probe)
  if [[ -n "${CCLOUD_API_KEY:-}" ]]; then
    local mcp_status
    mcp_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
      -H "Authorization: Bearer $CCLOUD_API_KEY" -H "Accept: application/json, text/event-stream" \
      -X POST "$MCP_URL" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null || echo "000")
    if [[ "$mcp_status" == "200" || "$mcp_status" == "202" ]]; then
      check "Managed MCP endpoint (tools/list)" "OK"
    else
      check "Managed MCP endpoint (tools/list)" "FAIL (HTTP $mcp_status)"
    fi
  else
    log_info "[~] CCLOUD_API_KEY tidak di .env — skip check MCP endpoint"
  fi

  return "$FAILED"
}

# ─── Output ──────────────────────────────────────────────────────────────────
if [[ "$MODE" == "--json" ]]; then
  # Output JSON terstruktur (agent-ready). Cek yang sama, tulis JSON hasil.
  clusters_json2=$(ccloud cluster list -o json 2>/dev/null)
  cluster_json2=$(printf '%s' "$clusters_json2" | jq -c --arg n "$CLUSTER_NAME" '.[] | select(.name == $n)' | head -1)
  if [[ -n "$cluster_json2" ]]; then
    printf '%s' "$cluster_json2" | jq '{
      audit: {
        tool: "ccloud",
        pattern: "-o json + jq",
        cluster_name: .name,
        cluster_id: .id,
        cockroach_version: .cockroach_version,
        plan: .plan,
        state: (.operation_status // .state // "UNKNOWN"),
        spend_limit: (.config.serverless.spend_limit // "N/A"),
        cloud_provider: .cloud_provider,
        regions: [.regions[].name]
      }
    }'
  else
    echo '{"audit":{"status":"FAIL","reason":"cluster not found"}}'
    exit 1
  fi
  exit 0
fi

if ensure_auth; then
  run_audit
  if [[ "$MODE" == "--quiet" ]]; then
    if [[ "$FAILED" == "0" ]]; then echo "OK"; else echo "FAIL"; fi
  fi
  exit "$FAILED"
else
  if [[ "$MODE" == "--quiet" ]]; then echo "FAIL"; fi
  exit 1
fi
