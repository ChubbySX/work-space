@echo off
cd /d "%~dp0%"

set "PY=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   发布更新到 GitHub Pages
echo   https://chubbysx.github.io/work-space/
echo   (自动分析改动 + 记录更新历史)
echo ============================================
echo.

echo [1/5] 提取视频封面...
"%PY%" tools\make_posters.py
echo.

echo [2/5] 暂存改动...
git add .
echo.

echo [3/5] 分析改动并记录更新历史（自动生成分点概述）...
"%NODE%" tools\analyze_and_record.js
echo.

echo [4/5] 构建网站内容...
"%NODE%" build.js
if errorlevel 1 (echo 构建失败！ & pause & exit /b 1)
git add .
echo.

echo [5/5] 提交并推送到 GitHub...
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "TS=%%t"
git commit -m "更新内容 %TS%"
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
pause