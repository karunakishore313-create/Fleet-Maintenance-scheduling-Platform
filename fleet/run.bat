@echo off
title GoVehicle Fleet Maintenance Platform
echo ===================================================
echo Starting GoVehicle Fleet Maintenance Platform...
echo ===================================================
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Python virtual environment not found. Setting up...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

echo.
echo Launching application on http://127.0.0.1:5000
echo Press Ctrl+C to stop the server.
echo.
python app.py
pause
