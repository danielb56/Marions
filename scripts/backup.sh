#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${R2_BUCKET:-}" || -z "${R2_ENDPOINT:-}" ]]; then
  echo "DATABASE_URL, R2_BUCKET and R2_ENDPOINT are required" >&2
  exit 1
fi

backup_file="marion-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" --file="/tmp/$backup_file"
aws s3 cp "/tmp/$backup_file" "s3://$R2_BUCKET/backups/$backup_file" --endpoint-url "$R2_ENDPOINT"
rm "/tmp/$backup_file"
echo "Uploaded backups/$backup_file"
