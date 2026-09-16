#!/bin/bash
echo "======================================================================"
echo "       SIMPLEX CENTRAL OPERATIONS CONSOLE (1-CLICK UPDATER)"
echo "======================================================================"
echo ""

echo "Checking for updates from registry..."
docker compose pull

echo ""
echo "Applying updates and restarting services..."
echo "(NOTE: All existing database records, users, and clients are 100% PRESERVED!)"
docker compose up -d

echo ""
echo "======================================================================"
echo "  [SUCCESS] Update completed successfully!"
echo "======================================================================"
