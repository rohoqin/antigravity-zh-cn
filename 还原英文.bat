@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18 或更高版本: https://nodejs.org/
  pause
  exit /b 1
)

echo 提示：Windows 下请先从系统托盘完全退出 Antigravity 客户端，避免文件被占用。
echo.
node cli.js restore
echo.
pause
