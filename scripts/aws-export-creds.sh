#!/usr/bin/env bash
# aws-export-creds.sh — Export temporary AWS credentials from the `aws login` cache
# into env vars so that tools using the standard AWS SDK (e.g. Terraform) can work.
#
# `aws login` (CLI v2.36+, same-device OAuth) stores tokens in ~/.aws/login/cache/*.json
# under a config format (`login_session`) that the AWS SDK's default chain does not
# understand. This script locates the cache file for a given profile, extracts the
# short-lived access key, and exports AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
# AWS_SESSION_TOKEN.
#
# Usage:
#   source scripts/aws-export-creds.sh [profile]
#   (default profile: aws-x-cdb)
#
# Exit codes: 0 = credentials exported, 1 = not found / expired.

set -euo pipefail

PROFILE="${1:-aws-x-cdb}"

CONFIG="$HOME/.aws/config"
CACHE_DIR="$HOME/.aws/login/cache"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: AWS config not found: $CONFIG" >&2
  exit 1
fi

# Extract login_session for the requested profile
login_session="$(awk -v p="profile $PROFILE" '$0 == "[" p "]" {f=1; next} /^\[/ {f=0} f && /login_session/ {gsub(/^[[:space:]]*login_session[[:space:]]*=[[:space:]]*/, ""); print; exit}' "$CONFIG")"

if [[ -z "$login_session" ]]; then
  echo "ERROR: no login_session found for profile '$PROFILE'" >&2
  exit 1
fi

# Cache filename is the sha256 hex of the login_session ARN
cache_file="$CACHE_DIR/$(printf '%s' "$login_session" | sha256sum | awk '{print $1}').json"

if [[ ! -f "$cache_file" ]]; then
  echo "ERROR: login cache not found for profile '$PROFILE' (run: aws login --profile $PROFILE)" >&2
  exit 1
fi

creds="$(python3 - "$cache_file" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
t = d.get('accessToken') or {}
for k in ('accessKeyId', 'secretAccessKey', 'sessionToken'):
    if k not in t:
        print('ERROR: cache token missing ' + k, file=sys.stderr)
        sys.exit(1)
print(t['accessKeyId'])
print(t['secretAccessKey'])
print(t['sessionToken'])
PYEOF
)" || exit 1

ACCESS_KEY="$(echo "$creds" | sed -n 1p)"
SECRET_KEY="$(echo "$creds" | sed -n 2p)"
SESSION_TOKEN="$(echo "$creds" | sed -n 3p)"

export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
export AWS_SESSION_TOKEN="$SESSION_TOKEN"
export AWS_PROFILE="$PROFILE"

echo "OK: exported temporary credentials for profile '$PROFILE' (${#ACCESS_KEY} chars)"
