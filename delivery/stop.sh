#!/bin/bash
echo "======================================================================"
echo "       SIMPLEX CENTRAL OPERATIONS CONSOLE (STOPPER)"
echo "======================================================================"
echo ""
echo "Stopping all SIMPLEX services..."
docker compose down
echo ""
echo "All services stopped safely."
