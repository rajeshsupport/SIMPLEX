@echo off
setlocal enabledelayedexpansion

title SIMPLEX Desktop Browser Agent

echo ======================================================================
echo           SIMPLEX DESKTOP BROWSER AUTOMATION AGENT
echo ======================================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js (LTS version 20 or higher) from:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Check dependencies
if not exist "node_modules\playwright" (
    echo Installing Agent Dependencies (first time setup)...
    call npm install --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Please check your internet connection.
        pause
        exit /b 1
    )
    echo.
    echo Installing Browser Drivers...
    call npx playwright install chromium
)

:: Load environment variables from parent .env if exists
if exist "..\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("..\.env") do (
        set "line=%%A"
        if not "!line:~0,1!"=="#" (
            if "%%A"=="API_BASE_URL" set "API_BASE_URL=%%B"
            if "%%A"=="AGENT_SHARED_SECRET" set "AGENT_SHARED_SECRET=%%B"
        )
    )
)

:: Defaults
if not defined API_BASE_URL set API_BASE_URL=http://localhost:3000
if not defined AGENT_SHARED_SECRET set AGENT_SHARED_SECRET=simplex_agent_shared_key_2026

echo Connecting to SIMPLEX API at: %API_BASE_URL%
echo Starting Desktop Automation Runner...
echo (Keep this window OPEN while using interactive client logins)
echo.

node dist\cli-runner.js

pause
