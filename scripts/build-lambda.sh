#!/usr/bin/env bash
# Build Lambda handler into a deployable zip for Terraform.
# Produces: lambda/cbt-memory-agent.zip (referenced by infra/modules/lambda/main.tf)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAMBDA_DIR="$ROOT/lambda"
OUT_ZIP="$ROOT/lambda/cbt-memory-agent.zip"

cd "$LAMBDA_DIR"

if [ ! -d node_modules ]; then
  echo ">> Installing lambda dependencies..."
  npm install
fi

echo ">> Bundling handler.ts with esbuild..."
npx esbuild handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --outfile=dist/index.js \
  --minify \
  --external:pg \
  --external:aws-lambda

echo ">> Creating $OUT_ZIP..."
rm -f "$OUT_ZIP"
cd dist
zip -qr "$OUT_ZIP" index.js
echo ">> Done: $(ls -lh "$OUT_ZIP" | awk '{print $5}')"
