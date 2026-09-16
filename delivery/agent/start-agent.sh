#!/bin/bash
echo "======================================================================"
echo "          SIMPLEX DESKTOP BROWSER AUTOMATION AGENT"
echo "======================================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please download and install Node.js (LTS version 20 or higher) from:"
    echo "https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules/playwright" ]; then
    echo "Installing Agent Dependencies (first time setup)..."
    npm install --no-audit --no-fund
    echo "Installing Browser Drivers..."
    npx playwright install chromium
fi

if [ -f "../.env" ]; then
    export $(grep -v '^#' ../.env | xargs)
fi

export API_BASE_URL=${API_BASE_URL:-http://localhost:3000}
export AGENT_SHARED_SECRET=${AGENT_SHARED_SECRET:-simplex_agent_shared_key_2026}

echo "Connecting to SIMPLEX API at: $API_BASE_URL"
echo "Starting Desktop Automation Runner..."
echo "(Keep this terminal window OPEN while using interactive client logins)"
echo ""

node dist/cli-runner.js
