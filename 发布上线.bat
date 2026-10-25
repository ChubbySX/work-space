@echo off
cd /d "%~dp0%"

set "PY=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   发布上线到 GitHub Pages
echo   https://chubbysx.github.io/work-space/
echo ============================================
echo.
echo   注意：请先双击 构建网站.bat 完成构建
echo.

echo [1/4] 升级发布版本号 (c+1)...
"%PY%" tools\bump_publish.py
echo.

echo [2/4] 暂存改动...
git add .
echo.

echo [3/4] 分析改动并记录更新历史...
"%NODE%" tools\analyze_and_record.js
echo.

echo [4/4] 提交并推送到 GitHub...
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "TS=%%t"
git commit -m "发布 %TS%"
set ATTEMPT=0
:PUSHRETRY
set /a ATTEMPT+=1
echo   第 %ATTEMPT% 次推送...
git push
if errorlevel 1 goto PUSHFAIL
goto PUSHDONE
:PUSHFAIL
if %ATTEMPT% LSS 3 (echo   失败3秒后重试... & timeout /t 3 >nul & goto PUSHRETRY)
echo.
echo *** 推送失败！网络可能不稳定 ***
echo   1) 等几分钟再双击本脚本
echo   2) 临时开手机热点再双击
pause
exit /b 1
:PUSHDONE
echo.
echo ============================================
echo   发布完成！1-2分钟后刷新网页
echo   https://chubbysx.github.io/work-space/
echo ============================================
exit /b 0
