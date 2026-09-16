@echo off
title SIMPLEX Central Operations Console - Launcher
echo ======================================================================
echo        SIMPLEX CENTRAL OPERATIONS CONSOLE (1-CLICK RUNNER)
echo ======================================================================
echo.
echo Checking Docker Desktop status...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not running!
    echo Please start Docker Desktop first and try again.
    echo.
    pause
    exit /b 1
)

echo Starting SIMPLEX Services (Database, API, Web Console)...
docker compose up -d

echo.
echo ======================================================================
echo   [SUCCESS] SIMPLEX Central Operations Console is now running!
echo ======================================================================
echo.
echo   Web Portal URL:  http://localhost:5173
echo   API Endpoint:    http://localhost:3000/api/v1
echo   Default Login:   admin / Rajesh@123
echo.
echo Opening browser...
start http://localhost:5173
echo.
pause
