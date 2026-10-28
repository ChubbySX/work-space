@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

netstat -ano | findstr ":8390" | findstr "LISTENING" >nul
if %errorlevel% equ 0 goto already

echo Mobile-uploader bridge starting on port 8390...
echo Phone (LAN): http://YOUR-LAN-IP:8390/  (set token, then upload)
echo Close this window to stop the bridge.
echo.

:loop
"%NODE%" bridge.js
netstat -ano | findstr ":8390" | findstr "LISTENING" >nul
if %errorlevel% equ 1 goto restart
echo [info] Another bridge holds port 8390. This window is finished.
goto end

:restart
echo.
echo [info] Bridge exited unexpectedly. Restarting in 3s... close this window to stop.
timeout /t 3 /nobreak >nul
goto loop

:already
echo [info] Bridge is already running on port 8390.
echo Phone: open http://192.168.137.1:8390/  (hotspot)

:end
pause