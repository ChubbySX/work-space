@echo off
cd /d "%~dp0%"
echo ============================================
echo   第 1 步：提取视频封面（自动截帧）
echo ============================================
echo.

if exist "C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" (
    "C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" tools\make_posters.py
) else (
    python tools\make_posters.py
)

echo.
echo ============================================
echo   第 2 步：构建网站内容
echo ============================================
echo.

if exist "C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
    "C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" build.js
) else (
    where node >nul 2>&1 && (
        node build.js
    ) || (
        echo [错误] 找不到 Node.js
    )
)

echo.
echo ============================================
echo   全部完成！刷新网页即可看到新内容
echo   按任意键关闭此窗口
echo ============================================
pause >nul
