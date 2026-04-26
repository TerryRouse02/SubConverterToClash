@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%Generate-ClashMeta-Profile.ps1"
set "SUB_URL="

if not exist "%PS_SCRIPT%" (
  echo ❌ 缺少核心脚本："%PS_SCRIPT%"
  echo.
  pause
  exit /b 1
)

if "%~1"=="" (
  echo 📎 请粘贴 ClashMeta 订阅链接，然后按 Enter。
  set /p "SUB_URL=🔗 订阅链接 > "
) else (
  set "SUB_URL=%~1"
)

if not defined SUB_URL (
  echo ❌ 没有输入订阅链接。
  echo.
  pause
  exit /b 1
)

if /i not "%SUB_URL:~0,4%"=="http" (
  echo ❌ 订阅链接必须以 http 或 https 开头。
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -SubscriptionUrl "%SUB_URL%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo ❌ 生成失败，退出码：%EXIT_CODE%。
) else (
  echo ✅ 生成完成。
)
echo.
pause
exit /b %EXIT_CODE%
