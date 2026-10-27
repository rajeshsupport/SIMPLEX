@echo off
title SIMPLEX Central Operations Console - Updater
echo ======================================================================
echo        SIMPLEX CENTRAL OPERATIONS CONSOLE (1-CLICK UPDATER)
echo ======================================================================
echo.
echo Checking for updates from registry...
docker compose pull

echo.
echo Applying updates and restarting services...
echo (NOTE: All existing database records, users, and clients are 100%% PRESERVED!)
docker rm -f simplex_central_web simplex_central_api >nul 2>&1
docker compose up -d

echo.
echo Applying database migrations...
timeout /t 5 /nobreak >nul
docker exec -i simplex_mssql_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Rajesh@123" -C < update-latest-schema.sql >nul 2>&1
docker compose restart simplex_api >nul 2>&1

echo.
echo ======================================================================
echo   [SUCCESS] Update completed successfully!
echo ======================================================================
echo   Web Portal URL:  http://localhost:5173
echo.
pause
