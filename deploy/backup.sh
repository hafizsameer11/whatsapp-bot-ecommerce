#!/usr/bin/env bash
# Daily backup of the database AND product/customer photos (they live only on this server).
# Install:  chmod +x deploy/backup.sh
#           crontab -e   ->   15 3 * * * /home/USER/whatsapp-bot/deploy/backup.sh >> /home/USER/backups/backup.log 2>&1
# Keeps the last 14 days. Copy the backups folder off the server too (another PC / Google Drive) —
# a backup on the same disk does not survive a disk failure.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-$HOME/backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

# 1) Database: sqlite3 ".backup" makes a consistent copy even while the bot is running
DB="$APP_DIR/server/prisma/dev.db"
if [ -f "$DB" ]; then
  sqlite3 "$DB" ".backup '$DEST/db_$STAMP.sqlite'"
  gzip -f "$DEST/db_$STAMP.sqlite"
fi

# 2) Photos (uploaded products, demo images, customer photos) + settings file (.env contains secrets: keep backups private)
mkdir -p "$APP_DIR/server/uploads"
tar -czf "$DEST/files_$STAMP.tar.gz" -C "$APP_DIR/server" uploads .env 2>/dev/null || \
  tar -czf "$DEST/files_$STAMP.tar.gz" -C "$APP_DIR/server" uploads

# 3) Remove backups older than 14 days
find "$DEST" -name 'db_*.sqlite.gz' -mtime +14 -delete
find "$DEST" -name 'files_*.tar.gz' -mtime +14 -delete

echo "$(date) backup ok -> $DEST"
