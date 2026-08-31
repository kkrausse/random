#!/bin/bash
set -e

REMOTE_HOST="lrpi"
REMOTE_DIR="/home/pi/deploys/birdmog"

echo "Deploying to $REMOTE_HOST:$REMOTE_DIR..."

ssh "$REMOTE_HOST" "
  set -e
  cd $REMOTE_DIR
  echo '--- git pull ---'
  git pull
  echo '--- docker compose up ---'
  docker compose up -d --build
  echo '--- status ---'
  docker compose ps
"
