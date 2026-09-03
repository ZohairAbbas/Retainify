#!/bin/bash
set -e

cd /root/Retainify

echo "Pulling latest..."
git pull origin main

echo "Applying migrations..."
# The build doesn't do this, so a deploy carrying a migration used to leave the
# new code running against the old columns — the failure lands at the first
# query, not at deploy time.
npx prisma migrate deploy
npx prisma generate

echo "Building..."
npm run build

echo "Restarting PM2..."
# startOrReload, not restart: `pm2 restart <name>` replays the config PM2
# cached when the process was first started, so edits to ecosystem.config.cjs
# (node_args, env) would never take effect.
pm2 startOrReload ecosystem.config.cjs --update-env

echo "Done. Deploy complete."

