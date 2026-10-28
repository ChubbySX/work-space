@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"
echo [process-uploads] ?????????/??/??/??/??/???...
"%NODE%" "%~dp0process-uploads.js"
echo.
pause
