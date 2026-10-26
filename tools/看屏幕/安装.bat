@echo off
chcp 936 >nul
title 安装 - 看屏幕
cd /d "%~dp0"

echo ============================================
echo   让她看见你的屏幕 - 安装
echo ============================================
echo.

set PY=
where python >nul 2>nul && set PY=python
if "%PY%"=="" (
  where py >nul 2>nul && set PY=py
)
if "%PY%"=="" (
  echo [X] 没找到 Python。
  echo     去 python.org 下 3.10 以上，装的时候一定要勾 Add Python to PATH。
  pause
  exit /b 1
)

echo [1/3] Python 找到了:
%PY% --version
echo.

echo [2/3] 装依赖...
%PY% -m pip install --upgrade pip -q 2>nul
%PY% -m pip install rapidocr_onnxruntime pillow
if errorlevel 1 (
  echo [!] 默认源失败，换阿里云...
  %PY% -m pip install rapidocr_onnxruntime pillow -i https://mirrors.aliyun.com/pypi/simple/
)
if errorlevel 1 (
  echo [!] 还失败，换清华...
  %PY% -m pip install rapidocr_onnxruntime pillow -i https://pypi.tuna.tsinghua.edu.cn/simple
)
if errorlevel 1 (
  echo [X] 依赖装不上，检查网络。
  pause
  exit /b 1
)

echo.
echo [3/3] 自检...
%PY% -c "from rapidocr_onnxruntime import RapidOCR; from PIL import ImageGrab; print('OK 依赖全在')"
if errorlevel 1 (
  echo [X] 自检没过。
  pause
  exit /b 1
)

echo.
echo ============================================
echo   装好了。双击 启动.bat 开始。
echo ============================================
echo.
pause