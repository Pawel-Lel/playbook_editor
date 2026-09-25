#!/bin/sh
# Runs before nginx starts (nginx image executes /docker-entrypoint.d/*.sh).
# Exposes selected environment variables to the browser via /config.js.
set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js

# Escape backslashes and double quotes so the value is a safe JS string.
js_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > "$CONFIG_FILE" <<JS
window.__APP_CONFIG__ = {
  GOOGLE_OAUTH_CLIENT_ID: "$(js_escape "${GOOGLE_OAUTH_CLIENT_ID:-}")",
  GCS_BUCKET: "$(js_escape "${GCS_BUCKET:-}")",
  GCS_OBJECT_PREFIX: "$(js_escape "${GCS_OBJECT_PREFIX:-}")"
};
JS

for var in GOOGLE_OAUTH_CLIENT_ID GCS_BUCKET GCS_OBJECT_PREFIX; do
  eval "val=\${$var:-}"
  if [ -n "$val" ]; then echo "config.js: $var is set"; else echo "config.js: $var not set"; fi
done
