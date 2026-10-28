@echo off
chcp 936 >nul
cd /d "%~dp0%"
echo ============================================
echo   启动预览服务器（支持视频拖动进度条）
echo   网址: http://127.0.0.1:8367
echo   (关闭此窗口即可停止服务器)
echo ============================================
echo.

set PORT=8367
start "" cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:%PORT%"

if exist "C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" (
    "C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" "tools\preview_server.py" %PORT%
) else (
    python "tools\preview_server.py" %PORT%
)