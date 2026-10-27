@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

rem If port 8390 is already in use, another bridge is running - no need to start again.
netstat -ano | findstr ":8390" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
  echo [info] Bridge is already running on port 8390.
  echo Phone: open http://192.168.137.1:8390/  or  http://YOUR-LAN-IP:8390/
  pause
  exit /b 0
)

echo Mobile-uploader bridge starting on port 8390...
echo Phone: open http://YOUR-LAN-IP:8390/  (set token, then upload)
echo.
"%NODE%" bridge.js
pause
