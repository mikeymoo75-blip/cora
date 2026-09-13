#!/usr/bin/env bash
# Deploy Apex Desk on the home server:
#   git pull && docker compose up -d --build
#
# Usage (from /opt/cora):
#   ./scripts/deploy.sh
#   sudo ./scripts/deploy.sh

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Apex Desk deploy starting at $(date)"
echo "==> Pulling latest code"
git pull --ff-only
echo "==> Building and starting containers"
docker compose up -d --build
echo "==> Status:"
docker compose ps
echo "==> Recent logs:"
docker compose logs app --tail 30
echo "==> Deploy complete at $(date)"
echo "==> Reverse-proxy /cora to 127.0.0.1:43148 (see deploy/)"
