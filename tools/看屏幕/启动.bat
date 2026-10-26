@echo off
chcp 936 >nul
title 看屏幕 - 运行中（关掉这个窗口就停）
cd /d "%~dp0"

set PY=
where python >nul 2>nul && set PY=python
if "%PY%"=="" (
  where py >nul 2>nul && set PY=py
)
if "%PY%"=="" (
  echo [X] 没找到 Python，先双击 安装.bat
  pause
  exit /b 1
)

echo ============================================
echo   让她看见你的屏幕
echo ============================================
echo.
echo   这个窗口开着就一直在跑。
echo   要停就按 Ctrl+C 或者直接关掉窗口。
echo.

set PYTHONIOENCODING=gbk
%PY% -u screen_ocr.py

echo.
echo 停了。
pause