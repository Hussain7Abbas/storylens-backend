#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ECOSYSTEM="${BACKEND_ROOT}/ecosystem.config.cjs"

cd "${BACKEND_ROOT}"

if [[ ! -f "${ECOSYSTEM}" ]]; then
  echo "Missing PM2 ecosystem file: ${ECOSYSTEM}"
  exit 1
fi

if [[ ! -f "${BACKEND_ROOT}/.env" ]]; then
  echo "Missing .env file. Copy .env.example to .env and configure it first."
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install from https://bun.sh"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing pm2..."
  bun add -g pm2
fi

echo "Installing dependencies..."
bun install --frozen-lockfile

echo "Generating Prisma client..."
bun run db:generate

echo "Running database migrations..."
bun run db:migrate:deploy

if systemctl list-unit-files storylens-api.service --no-pager 2>/dev/null | grep -q storylens-api.service; then
  if systemctl is-active --quiet storylens-api 2>/dev/null; then
    echo "Stopping systemd storylens-api service (PM2 owns this process)..."
    systemctl stop storylens-api
  fi
  systemctl disable storylens-api 2>/dev/null || true
fi

echo "Starting API with PM2 (port 3030)..."
pm2 startOrReload "${ECOSYSTEM}" --update-env
pm2 save

echo ""
echo "Done. API should be listening on 127.0.0.1:3030."
echo "Check status: pm2 status storylens-api"
echo "View logs:    pm2 logs storylens-api"
echo ""
echo "To start PM2 on boot, run the command printed by:"
echo "  pm2 startup"
