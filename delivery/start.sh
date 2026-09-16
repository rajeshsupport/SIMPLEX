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
docker compose pull simplex_api
docker compose up -d

echo "Initializing SIMPLEX Database..."
sleep 5
docker exec -i simplex_mssql_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Rajesh@123" -C -Q "IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'SIMPLEX_CENTRAL_DB') CREATE DATABASE SIMPLEX_CENTRAL_DB;" >/dev/null 2>&1 || true
docker compose restart simplex_api >/dev/null 2>&1 || true

echo ""
echo "======================================================================"
echo "  [SUCCESS] SIMPLEX Central Operations Console is now running!"
echo "======================================================================"
echo "  Web Portal URL:  http://localhost:5173"
echo "  API Endpoint:    http://localhost:3000/api/v1"
echo "  Default Login:   admin / Rajesh@123"
echo "======================================================================"
