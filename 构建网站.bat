@echo off
cd /d "%~dp0%"

set "PY=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"
set "NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   构建网站（提取封面 + 缩略图 + 生成数据）
echo ============================================
echo.

echo [1/3] 提取视频封面...
"%PY%" tools\make_posters.py
echo.

echo [2/3] 生成缩略图（预览用，加速加载）...
"%PY%" tools\make_thumbs.py
echo.

echo [3/3] 构建网站内容...
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