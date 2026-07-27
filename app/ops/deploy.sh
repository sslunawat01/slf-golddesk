#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/slf
echo "→ pulling"; git pull --ff-only
cd app
echo "→ installing";  npm ci --omit=dev 2>/dev/null || npm install --omit=dev
echo "→ migrating";   node scripts/migrate.mjs
echo "→ testing";     node scripts/test-auth.mjs >/dev/null && node scripts/test-customer.mjs >/dev/null && node scripts/test-valuation.mjs >/dev/null && node scripts/test-rate.mjs >/dev/null && node scripts/test-format.mjs >/dev/null && echo "   all domain tests ✓"
node ../engine/golden.test.js | tail -1
echo "→ building";    npm run build
echo "→ restarting";  sudo systemctl restart slf-golddesk
sleep 3
systemctl is-active --quiet slf-golddesk && echo "✓ live at https://slf.slunawat.in" || {
  echo "✗ service failed — last log lines:"; tail -20 /home/ubuntu/slf/app.log; exit 1; }
