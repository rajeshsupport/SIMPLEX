#!/bin/bash
echo "======================================================================"
echo "       SIMPLEX CENTRAL OPERATIONS CONSOLE (1-CLICK RUNNER)"
echo "======================================================================"
echo ""

if ! docker info >/dev/null 2>&1; then
    echo "[ERROR] Docker is not running!"
    echo "Please start Docker and try again."
    exit 1
fi

echo "Starting SIMPLEX Services (Database, API, Web Console)..."
docker compose up -d

echo ""
echo "======================================================================"
echo "  [SUCCESS] SIMPLEX Central Operations Console is now running!"
echo "======================================================================"
echo "  Web Portal URL:  http://localhost:5173"
echo "  API Endpoint:    http://localhost:3000/api/v1"
echo "  Default Login:   admin / Rajesh@123"
echo "======================================================================"
