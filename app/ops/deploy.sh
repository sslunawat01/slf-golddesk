#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/slf
echo "→ pulling"; git pull --ff-only
cd app
echo "→ installing";  npm ci --omit=dev 2>/dev/null || npm install --omit=dev
echo "→ migrating";   node scripts/migrate.mjs
echo "→ testing";     node scripts/test-auth.mjs >/dev/null && node scripts/test-customer.mjs >/dev/null && node scripts/test-valuation.mjs >/dev/null && node scripts/test-rate.mjs >/dev/null && node scripts/test-format.mjs >/dev/null && echo "   all domain tests ✓"
node scripts/test-engine.mjs | tail -1   # E37: the app engine (src/lib/engine.js 1.3.0) is the money brain; ../engine is the Jul-2026 prototype
echo "→ building";    npm run build
echo "→ restarting";  sudo systemctl restart slf-golddesk
sleep 3
systemctl is-active --quiet slf-golddesk && echo "✓ live at https://slf.slunawat.in" || {
  echo "✗ service failed — last log lines:"; tail -20 /home/ubuntu/slf/app.log; exit 1; }
