@echo off
title SIMPLEX Desktop Browser Agent

echo ======================================================================
echo           SIMPLEX DESKTOP BROWSER AUTOMATION AGENT
echo ======================================================================
echo.

cd /d "%~dp0"
if exist "agent\dist\cli-runner.js" cd agent

if not defined API_BASE_URL set API_BASE_URL=http://localhost:3000
if not defined AGENT_SHARED_SECRET set AGENT_SHARED_SECRET=simplex_agent_shared_key_2026
if not defined AUTOMATION_BROWSER set AUTOMATION_BROWSER=chrome
if not defined ALLOW_CHROMIUM_FALLBACK set ALLOW_CHROMIUM_FALLBACK=false

if not exist "node_modules\playwright" (
    echo Installing Agent Dependencies...
    call npm install --no-audit --no-fund
)

echo Connecting to SIMPLEX API at: %API_BASE_URL%
echo Browser engine: Google Chrome
echo Starting Desktop Automation Runner...
echo Keep this window OPEN while using interactive client logins.
echo.

node dist\cli-runner.js

pause
