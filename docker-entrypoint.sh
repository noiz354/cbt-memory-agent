#!/bin/sh
# Render nginx config from template, then start nginx as non-root.
set -e

export BACKEND_URL="${BACKEND_URL:-}"

envsubst '$BACKEND_URL' < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"
