#!/usr/bin/env bash
# Deploy frontend (Vite build) ke S3 + invalidasi CloudFront.
#
# Requires:
#   - AWS kredensial aktif (--profile aws-x-cdb atau default chain / OIDC di CI)
#   - Infra frontend sudah di-apply terraform (bucket + CloudFront)
#
# Env opsional:
#   S3_BUCKET                  nama bucket frontend (default cbt-memory-agent-frontend)
#   CLOUDFRONT_DISTRIBUTION_ID ID distribusi (default: auto-detect dari bucket)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="${S3_BUCKET:-cbt-memory-agent-frontend}"
DIST_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"

cd "$ROOT"

echo ">> Building frontend (npm run build)..."
npm run build

if [ ! -f dist/index.html ]; then
  echo "!! Build tidak menghasilkan dist/index.html" >&2
  exit 1
fi

echo ">> Syncing aset ke s3://$BUCKET (index.html dikecualikan)..."
aws s3 sync dist/ "s3://$BUCKET" \
  --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable" \
  --only-show-errors

echo ">> Upload index.html dengan Cache-Control no-cache..."
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --only-show-errors

if [ -z "$DIST_ID" ]; then
  echo ">> Auto-detect CloudFront distribution (bucket: $BUCKET)..."
  DIST_ID="$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?contains(join(',', Origins.Items[*].DomainName), '$BUCKET')].Id | [0]" \
    --output text)"
fi

if [ -z "$DIST_ID" ] || [ "$DIST_ID" = "None" ]; then
  echo "!! CloudFront distribution tidak ditemukan untuk bucket $BUCKET" >&2
  echo "   Set env CLOUDFRONT_DISTRIBUTION_ID atau apply terraform dulu." >&2
  exit 1
fi

echo ">> Invalidasi cache CloudFront ($DIST_ID, paths: /*)..."
aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/*" \
  --output text \
  --query 'Invalidation.Id'

echo ">> Done. Bucket=$BUCKET Distribution=$DIST_ID"
