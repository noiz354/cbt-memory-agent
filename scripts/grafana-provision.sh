#!/usr/bin/env bash
# ============================================================================
# grafana-provision.sh — Provision Grafana untuk FASE 4 monetisasi.
#
#   1. Buat PostgreSQL datasource → CockroachDB (uid=crdb-postgres).
#   2. Import dashboard infra/grafana/monetization-dashboard.json (uid=monetization).
#
# Prasyarat:
#   - GRAFANA_URL        (mis. https://<stack>.grafana.net)
#   - GRAFANA_API_KEY    (service account token; Grafana → Administration → Service accounts)
#   - CRDB_CONNECTION_URL (dari .env)
#
# Run:  bash scripts/grafana-provision.sh
# ============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Load env via grep (bukan `source`): .env bisa berisi token tanpa prefix KEY=
# yang membuat `source` gagal. Baris tanpa '=' di-skip diam-diam.
if [ -f "$ROOT/.env" ]; then
  while IFS='=' read -r key value; do
    [ -n "$key" ] && export "$key=$value"
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env")
fi

GRAFANA_URL="${GRAFANA_URL:-}"
GRAFANA_API_KEY="${GRAFANA_API_KEY:-}"
CRDB_CONNECTION_URL="${CRDB_CONNECTION_URL:-}"

if [ -z "$GRAFANA_URL" ]; then
  echo "❌ GRAFANA_URL belum diset (tambahkan ke .env: GRAFANA_URL=https://<stack>.grafana.net)"
  exit 1
fi
if [ -z "$GRAFANA_API_KEY" ]; then
  echo "❌ GRAFANA_API_KEY belum diset — buat service account token di Grafana → Administration > Service accounts"
  exit 1
fi
if [ -z "$CRDB_CONNECTION_URL" ]; then
  echo "❌ CRDB_CONNECTION_URL belum diset (di .env)"
  exit 1
fi

# Parse postgres://user:pass@host:port/db
# Asumsi password alfanumerik (tanpa ':' atau '@').
if [[ "$CRDB_CONNECTION_URL" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):([0-9]+)/([^?\ ]+) ]]; then
  DB_USER="${BASH_REMATCH[2]}"
  DB_PASS="${BASH_REMATCH[3]}"
  DB_HOST="${BASH_REMATCH[4]}"
  DB_PORT="${BASH_REMATCH[5]}"
  DB_NAME="${BASH_REMATCH[6]}"
else
  echo "❌ Tidak bisa parse CRDB_CONNECTION_URL (harap format postgres://user:pass@host:port/db)"
  exit 1
fi

echo "── Grafana provisioning ──────────────────────────────"
echo "  grafana : ${GRAFANA_URL}"
echo "  crdb    : ${DB_HOST}:${DB_PORT}/${DB_NAME} (uid=crdb-postgres)"

# 1) Datasource
DATASOURCE_PAYLOAD=$(node -e '
  // CATATAN: dengan `node -e`, argv = [node, arg1, ...] (tanpa kode eval),
  // jadi daftar arg sebenarnya mulai dari slice(1), bukan slice(2).
  const [user, pass, host, port, db] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({
    name: "CockroachDB - Monetization",
    type: "postgres",
    access: "proxy",
    uid: "crdb-postgres",
    url: `${host}:${port}`,
    database: db,
    user,
    secureJsonData: { password: pass },
    jsonData: { sslmode: "require", postgresVersion: 1500 }
  }));
' "$DB_USER" "$DB_PASS" "$DB_HOST" "$DB_PORT" "$DB_NAME")

DS_RESP=$(curl -sS -X POST "${GRAFANA_URL}/api/datasources" \
  -H "Authorization: Bearer ${GRAFANA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$DATASOURCE_PAYLOAD")

if echo "$DS_RESP" | grep -q '"message":"Datasource added"'; then
  echo "  ✓ datasource crdb-postgres dibuat"
elif echo "$DS_RESP" | grep -qiE 'already exists|uid.*exists|name.*exists'; then
  echo "  ✓ datasource crdb-postgres sudah ada"
else
  echo "  ✗ datasource gagal:"; echo "$DS_RESP"; exit 1
fi

# 2) Import semua dashboard (monetization + analytics + ...)
for DASHBOARD_PATH in "$ROOT"/infra/grafana/*.json; do
  [ -f "$DASHBOARD_PATH" ] || continue
  DASH_PAYLOAD=$(node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(JSON.stringify({ dashboard: d, overwrite: true }));
  ' "$DASHBOARD_PATH")

  DASH_RESP=$(curl -sS -X POST "${GRAFANA_URL}/api/dashboards/db" \
    -H "Authorization: Bearer ${GRAFANA_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$DASH_PAYLOAD")

  if echo "$DASH_RESP" | grep -q '"status":"success"'; then
    URL=$(echo "$DASH_RESP" | node -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).url||"")}catch{}} )')
    echo "  ✓ dashboard diimport → ${GRAFANA_URL}${URL}"
  else
    echo "  ✗ dashboard gagal (${DASHBOARD_PATH}):"; echo "$DASH_RESP"; exit 1
  fi
done

echo "──────────────────────────────────────────────────────"
echo "Selesai. Buka dashboard di Grafana → dashboards → Monetization & Analytics."
