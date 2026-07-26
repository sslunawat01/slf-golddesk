#!/usr/bin/env bash
set -euo pipefail
set -a; source /home/ubuntu/slf/.env; set +a
BUCKET="slf-golddesk-media-4471"
STAMP=$(date +%F-%H%M)
mkdir -p /home/ubuntu/slf/backups
FILE=/home/ubuntu/slf/backups/golddesk-${STAMP}.sql.gz
pg_dump -U golddesk -h localhost golddesk | gzip > "$FILE"
aws s3 cp "$FILE" "s3://${BUCKET}/backups/db/" --region ap-south-1
find /home/ubuntu/slf/backups -name '*.sql.gz' -mtime +7 -delete
echo "backed up $(basename $FILE) ($(du -h $FILE | cut -f1))"
