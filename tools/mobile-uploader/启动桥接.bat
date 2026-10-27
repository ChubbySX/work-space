@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"
echo Mobile-uploader bridge starting on port 8390...
echo Phone: open http://YOUR-LAN-IP:8390/  (set token, then upload)
echo.
"%NODE%" bridge.js
pause
