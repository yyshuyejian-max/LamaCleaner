@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ===================================
echo   LaMa Cleaner Server Setup
echo ===================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found
    echo Please install Python 3.10+ and check "Add to PATH"
    echo Download: https://www.python.org/downloads/
    pause
    exit /b 1
)

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create venv
        pause
        exit /b 1
    )
)

echo Activating venv...
call venv\Scripts\activate.bat

echo Upgrading pip...
python -m pip install --upgrade pip

echo Installing dependencies (5-10 min, will download ~2GB PyTorch)...
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

if errorlevel 1 (
    echo.
    echo [ERROR] Install failed, please check network
    pause
    exit /b 1
)

echo.
echo ===================================
echo   [OK] Setup Complete
echo ===================================
echo Now click "Start Server" in PS panel
echo Or run run.bat manually
pause
