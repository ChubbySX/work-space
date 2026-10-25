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

echo [1/8] 提取视频封面...
"%PY%" tools\make_posters.py
echo.

echo [2/8] 生成缩略图（预览用，加速加载）...
"%PY%" tools\make_thumbs.py
echo.

echo [3/8] 暂存改动...
git add .
echo.

echo [4/8] 分析改动并记录更新历史（自动概述）...
"%NODE%" tools\analyze_and_record.js
echo.

echo [5/8] 构建网站内容（c+1, d+1）...
"%NODE%" build.js
if errorlevel 1 (
  echo.
  echo *** 构建失败，请检查上面的错误 ***
  pause
  exit /b 1
)
echo.

echo [6/8] 暂存构建产物并提交...
git add .
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "TS=%%t"
git commit -m "更新内容 %TS%"
echo.

echo [7/8] 推送到 GitHub（最多重试3次）...
set ATTEMPT=0
:PUSHRETRY1
set /a ATTEMPT+=1
echo   第 %ATTEMPT% 次推送...
git push origin main
if errorlevel 1 goto PUSHFAIL1
goto PUSHDONE1
:PUSHFAIL1
if %ATTEMPT% LSS 3 (echo   失败3秒后重试... & timeout /t 3 >nul & goto PUSHRETRY1)
echo.
echo *** 推送失败！版本号未更新，请稍后重试 ***
echo   1) 等几分钟再双击本脚本
echo   2) 临时开手机热点再双击
pause
exit /b 1
:PUSHDONE1
echo.

echo [8/8] 更新发布版本号（b+1, c归零, d还原）并推送...
"%PY%" tools\bump_publish.py
git add .
git commit -m "发布版本号更新"
set ATTEMPT=0
:PUSHRETRY2
set /a ATTEMPT+=1
echo   第 %ATTEMPT% 次推送版本号...
git push origin main
if errorlevel 1 goto PUSHFAIL2
goto PUSHDONE2
:PUSHFAIL2
if %ATTEMPT% LSS 3 (echo   失败3秒后重试... & timeout /t 3 >nul & goto PUSHRETRY2)
echo.
echo *** 版本号推送失败！内容已上传，但版本号未同步到远程 ***
echo   本地版本号已更新，下次发布会自动包含
pause
exit /b 1
:PUSHDONE2
echo.
echo ============================================
echo   发布完成！1-2分钟后刷新网页
echo   https://chubbysx.github.io/work-space/
echo ============================================
exit /b 0