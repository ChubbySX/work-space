@echo off
cd /d "%~dp0%"

set "PY=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   构建网站（提取封面 + 生成数据）
echo ============================================
echo.

echo [1/2] 提取视频封面...
"%PY%" tools\make_posters.py
echo.

echo [2/2] 构建网站内容...
"%NODE%" build.js
if errorlevel 1 (
  echo.
  echo *** 构建失败，请检查上面的错误 ***
  pause
  exit /b 1
)

echo.
echo ============================================
echo   构建完成！刷新网页即可看到新内容
echo ============================================
exit /b 0