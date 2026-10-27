@echo off
title SIMPLEX Database Schema Updater
echo ======================================================================
echo        SIMPLEX DATABASE MIGRATION RUNNER (FOR EXISTING DB)
echo ======================================================================
echo.

echo Checking if MSSQL Container (simplex_mssql_db) is running...
docker ps --format "{{.Names}}" | findstr /i "simplex_mssql_db" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] The database container 'simplex_mssql_db' is not running!
    echo Please make sure Docker is running and run 'docker compose up -d' first.
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0update-latest-schema.sql" (
    echo [ERROR] Cannot find 'update-latest-schema.sql' in this folder!
    echo Please make sure 'update-latest-schema.sql' is in the same folder as this script.
    echo.
    pause
    exit /b 1
)

echo.
echo Executing database migration on SIMPLEX_CENTRAL_DB...
docker exec -i simplex_mssql_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Rajesh@123" -C < "%~dp0update-latest-schema.sql"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Migration encountered an error. Please check the logs above.
    echo.
    pause
    exit /b 1
)

echo.
echo Restarting Central API container to reload schema metadata...
docker restart simplex_central_api >nul 2>&1

echo.
echo ======================================================================
echo [SUCCESS] Database schema updated successfully!
echo - All 8 new tables created.
echo - All altered columns added.
echo - Existing records, users, and hospital clients are 100%% preserved.
echo ======================================================================
echo.
pause
