@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo.
echo  ==============================================
echo    LaMa Cleaner v1.1.0   Windows 一键安装
echo  ==============================================
echo.
echo  安装全程自动完成，请勿关闭此窗口
echo.

set "SRC=%~dp0"
set "DST=%APPDATA%\Adobe\CEP\extensions\LamaCleaner"

:: ══════════════════════════════════════════════
:: 1. 检查 / 安装 Python
:: ══════════════════════════════════════════════
echo  [1/4] 检查 Python...
python --version >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo   未找到 Python，尝试通过 winget 自动安装 Python 3.12...
    echo   （Windows 10/11 自带 winget，如提示需同意协议请按 Y）
    echo.
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        winget install --id Python.Python.3.12 -e --silent --accept-source-agreements --accept-package-agreements
        :: 刷新 PATH 让 python 命令立即可用
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python312\Scripts\;%LOCALAPPDATA%\Programs\Python\Python312\;%PATH%"
        python --version >nul 2>&1
        if !errorlevel! neq 0 (
            echo.
            echo   安装完成，但需重启命令行。
            echo   请关闭此窗口后再次双击 setup.bat 继续安装。
            pause & exit /b 0
        )
    ) else (
        echo.
        echo   [!] 未找到 winget，请手动安装 Python：
        echo.
        echo       https://www.python.org/downloads/
        echo.
        echo       安装时务必勾选 "Add Python to PATH"
        echo       安装完成后再次运行 setup.bat
        echo.
        pause & exit /b 1
    )
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo   OK  %%v

:: ══════════════════════════════════════════════
:: 2. 复制扩展文件到 CEP 目录
:: ══════════════════════════════════════════════
echo.
echo  [2/4] 安装扩展文件...

if not exist "%DST%"          mkdir "%DST%"
if not exist "%DST%\server"   mkdir "%DST%\server"

robocopy "%SRC%client"  "%DST%\client"  /E /NFL /NDL /NJH /NJS >nul
robocopy "%SRC%jsx"     "%DST%\jsx"     /E /NFL /NDL /NJH /NJS >nul
robocopy "%SRC%CSXS"    "%DST%\CSXS"   /E /NFL /NDL /NJH /NJS >nul
robocopy "%SRC%server"  "%DST%\server" /E /XD venv /NFL /NDL /NJH /NJS >nul
if exist "%SRC%README.md" copy /Y "%SRC%README.md" "%DST%\" >nul

echo   OK  已安装到：
echo       %DST%

:: ══════════════════════════════════════════════
:: 3. 注册表（开启第三方扩展，HKCU 无需管理员）
:: ══════════════════════════════════════════════
echo.
echo  [3/4] 开启 PS 扩展调试权限...
for %%v in (10 11 12 13) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo   OK  支持 Photoshop 2022 ~ 2026

:: ══════════════════════════════════════════════
:: 4. 创建 Python venv 并安装依赖
:: ══════════════════════════════════════════════
echo.
echo  [4/4] 安装 AI 依赖包...
echo        首次安装约 10~20 分钟，需下载约 2GB 的 AI 组件
echo        请耐心等待，勿关闭此窗口
echo.

set "VENV=%DST%\server\venv"

if exist "%VENV%\Scripts\python.exe" (
    echo   检测到已有 Python 环境，跳过安装
    goto :done
)

echo   创建虚拟环境...
python -m venv "%VENV%"
if errorlevel 1 (
    echo.
    echo   [错误] 虚拟环境创建失败，请检查 Python 是否正确安装
    pause & exit /b 1
)

echo   安装依赖包（使用清华镜像加速）...
echo.
"%VENV%\Scripts\pip.exe" install --upgrade pip --quiet

"%VENV%\Scripts\pip.exe" install -r "%DST%\server\requirements.txt" ^
    -i https://pypi.tuna.tsinghua.edu.cn/simple ^
    --trusted-host pypi.tuna.tsinghua.edu.cn

if errorlevel 1 (
    echo.
    echo   清华源失败，切换官方源重试...
    echo.
    "%VENV%\Scripts\pip.exe" install -r "%DST%\server\requirements.txt"
    if errorlevel 1 (
        echo.
        echo   [错误] 依赖安装失败，请检查网络后重新运行 setup.bat
        pause & exit /b 1
    )
)

:done
echo.
echo  ==============================================
echo    安装完成！
echo  ==============================================
echo.
echo    接下来只需三步：
echo.
echo    1. 重启 Photoshop
echo    2. 菜单：窗口 → 扩展功能 → LaMa Cleaner
echo    3. 面板中点击「启动后端服务」
echo.
echo    提示：首次启动服务会自动下载 LaMa 模型（约 200MB）
echo.
pause
exit /b 0
