#!/bin/bash
set -e

cd /root/Retainify

echo "Pulling latest..."
git pull origin main

echo "Building..."
npm run build

echo "Restarting PM2..."
pm2 restart retainify

echo "Done. Deploy complete."

