#!/usr/bin/env bash
set -euo pipefail

DOMAIN="storylens-api.iscoded.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_CONF="${SCRIPT_DIR}/nginx/${DOMAIN}.conf"
SITES_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}.conf"
SITES_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup-nginx.sh"
  exit 1
fi

if [[ ! -f "${NGINX_CONF}" ]]; then
  echo "Missing nginx config: ${NGINX_CONF}"
  exit 1
fi

echo "Installing nginx site config for ${DOMAIN}..."
cp "${NGINX_CONF}" "${SITES_AVAILABLE}"
ln -sf "${SITES_AVAILABLE}" "${SITES_ENABLED}"

if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot not found. Install it before requesting TLS certificates."
else
  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    echo "Requesting TLS certificate for ${DOMAIN}..."
    certbot --nginx -d "${DOMAIN}"
  else
    echo "TLS certificate already present for ${DOMAIN}."
  fi
fi

echo "Testing nginx configuration..."
nginx -t

echo "Reloading nginx..."
systemctl reload nginx

echo "Done. Ensure the API is running on 127.0.0.1:3030 (see ecosystem.config.cjs and deploy/setup-pm2.sh)."
