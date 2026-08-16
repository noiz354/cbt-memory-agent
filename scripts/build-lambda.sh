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
  --external:aws-lambda

echo ">> Copying reflection skills (SKILL.md) into bundle..."
SKILLS_SRC="$ROOT/skills/cockroachdb-skills/skills"
SKILLS_DST="dist/skills/cockroachdb-skills/skills"
mkdir -p "$SKILLS_DST/cockroachdb-query-and-schema-design/cockroachdb-sql"
mkdir -p "$SKILLS_DST/cockroachdb-observability-and-diagnostics/profiling-statement-fingerprints"
cp "$SKILLS_SRC/cockroachdb-query-and-schema-design/cockroachdb-sql/SKILL.md" \
   "$SKILLS_DST/cockroachdb-query-and-schema-design/cockroachdb-sql/"
cp "$SKILLS_SRC/cockroachdb-observability-and-diagnostics/profiling-statement-fingerprints/SKILL.md" \
   "$SKILLS_DST/cockroachdb-observability-and-diagnostics/profiling-statement-fingerprints/"

echo ">> Creating $OUT_ZIP..."
rm -f "$OUT_ZIP"
cd dist
zip -qr "$OUT_ZIP" index.js skills
echo ">> Done: $(ls -lh "$OUT_ZIP" | awk '{print $5}')"
