#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# aws-login.sh — Login + verifikasi AWS (SSO/Identity Center, headless)
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   bash scripts/aws-login.sh              → cek session; login bila expired (--remote, headless)
#   bash scripts/aws-login.sh --remote     → paksa login device-code (print URL, user authorize)
#   bash scripts/aws-login.sh --quiet      → hanya "OK"/"FAIL" + exit 0/1 (cron/CI)
#
# Prerequisites:
#   - AWS CLI v2.36+ (fitur `aws login`, menggantikan `aws sso login`)
#   - Profile sudah dikonfigurasi di ~/.aws/config (login_session + region)
#
# Catatan:
#   - `aws login` menyimpan token OAuth di ~/.aws/login/cache/ (bukan credentials file).
#   - `--remote` TIDAK membuka browser → print URL + minta code manual (headless-friendly).
#   - Tanpa `--remote`, CLI mencoba membuka browser default.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Load .env jika ada (AWS_PROFILE / AWS_REGION) ──────────────────────────
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

AWS_PROFILE="${AWS_PROFILE:-aws-x-cdb}"
AWS_REGION="${AWS_REGION:-ap-southeast-3}"
export AWS_PROFILE AWS_REGION

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

# ─── Cek session saat ini ────────────────────────────────────────────────────
check_session() {
  if ! aws sts get-caller-identity > /dev/null 2>&1; then
    return 1
  fi
  return 0
}

# ─── Login ───────────────────────────────────────────────────────────────────
do_login() {
  local remote="${1:-}"

  log_info "Login AWS (profile: $AWS_PROFILE, region: $AWS_REGION)..."
  if [[ -n "$remote" ]]; then
    log_info "Mode --remote (headless): buka URL di browser mana pun, lalu masukkan authorization code di sini."
    aws login --profile "$AWS_PROFILE" --remote
  else
    log_info "Mencoba buka browser default untuk OAuth..."
    aws login --profile "$AWS_PROFILE"
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────
mode="${1:-}"
remote=""

case "$mode" in
  --remote) remote="1" ;;
  --quiet)  mode="quiet" ;;
esac

if [[ "$mode" == "quiet" ]]; then
  if check_session; then
    echo "OK"
    exit 0
  fi
  echo "FAIL"
  exit 1
fi

if check_session; then
  log_ok "Session AWS masih valid:"
  aws sts get-caller-identity
  exit 0
fi

log_warn "Session AWS expired atau belum login."
do_login "$remote"

echo ""
if check_session; then
  log_ok "Login berhasil:"
  aws sts get-caller-identity
else
  log_error "Login gagal. Coba lagi dengan 'bash scripts/aws-login.sh --remote'."
  exit 1
fi
