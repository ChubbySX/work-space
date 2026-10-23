# -*- coding: utf-8 -*-
"""用 GBK 编码写两个 bat 脚本（Windows cmd 默认用 GBK，中文不乱码）"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = r"C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
PY = r"C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"

build_bat = f'''@echo off
cd /d "%~dp0%"
echo ============================================
echo   第 1 步：提取视频封面（自动截帧）
echo ============================================
echo.

if exist "{PY}" (
    "{PY}" tools\\make_posters.py
) else (
    python tools\\make_posters.py
)

echo.
echo ============================================
echo   第 2 步：构建网站内容
echo ============================================
echo.

if exist "{NODE}" (
    "{NODE}" build.js
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
'''

start_bat = f'''@echo off
cd /d "%~dp0%"
echo ============================================
echo   启动预览服务器
echo   网址: http://127.0.0.1:8367
echo   (关闭此窗口即可停止服务器)
echo ============================================
echo.

set PORT=8367
start "" cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:%PORT%"

if exist "{PY}" (
    "{PY}" -m http.server %PORT%
) else (
    python -m http.server %PORT%
)
'''

with open(os.path.join(ROOT, "构建网站.bat"), "w", encoding="gbk") as f:
    f.write(build_bat)
with open(os.path.join(ROOT, "启动预览.bat"), "w", encoding="gbk") as f:
    f.write(start_bat)

print("OK: 两个 bat 已用 GBK 编码重新生成")
