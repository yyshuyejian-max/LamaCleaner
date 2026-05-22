@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist venv (
    echo [ERROR] Dependencies not installed, please run install.bat first
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
python lama_server.py
pause
