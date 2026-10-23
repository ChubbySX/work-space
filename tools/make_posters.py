# -*- coding: utf-8 -*-
"""从视频文件中截取一帧画面作为封面（poster）。
自动扫描 content/works/video/ 和 content/daily/ 里的视频文件，
对没有 .poster.jpg 的视频提取一帧保存。
"""
import os
import sys
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "content")
VIDEO_EXT = (".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v")
POSTER_EXT = ".poster.jpg"

def get_ffmpeg():
    """获取 ffmpeg 可执行文件路径"""
    # 1. 项目自带的 tools/ffmpeg.exe
    local = os.path.join(ROOT, "tools", "ffmpeg.exe")
    if os.path.exists(local):
        return local
    # 2. imageio-ffmpeg 提供的
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if os.path.exists(exe):
            return exe
    except Exception:
        pass
    # 3. 系统 PATH 上的 ffmpeg
    import shutil
    ff = shutil.which("ffmpeg")
    if ff:
        return ff
    return None

def extract_frame(ffmpeg, video_path, poster_path, seek=3):
    """从视频 seek 秒处截取一帧"""
    cmd = [
        ffmpeg, "-y",
        "-ss", str(seek),        # 快速跳转到 seek 秒
        "-i", video_path,
        "-frames:v", "1",        # 只取一帧
        "-vf", "scale=800:-1",   # 缩放到 800px 宽
        "-q:v", "3",             # JPEG 质量
        poster_path,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=60)
    return result.returncode == 0

def scan_dir(dirpath):
    """扫描目录里的视频文件，为缺少 poster 的视频生成封面"""
    if not os.path.isdir(dirpath):
        return
    for f in os.listdir(dirpath):
        if not f.lower().endswith(VIDEO_EXT):
            continue
        base = os.path.splitext(f)[0]
        video = os.path.join(dirpath, f)
        poster = os.path.join(dirpath, base + POSTER_EXT)
        if os.path.exists(poster):
            print(f"  [--] {f} 已有封面，跳过")
            continue
        print(f"  [..] 正在截取封面: {f}")
        ok = False
        # 尝试不同的 seek 时间点（3秒、1秒、0.5秒）
        for seek in [3, 1, 0.5]:
            if extract_frame(ffmpeg, video, poster, seek):
                ok = True
                break
        if ok:
            print(f"  [OK] 封面已保存: {base}{POSTER_EXT}")
        else:
            print(f"  [!!] 截取失败: {f}")

if __name__ == "__main__":
    ffmpeg = get_ffmpeg()
    if not ffmpeg:
        print("[错误] 找不到 ffmpeg。请先运行: python -m pip install imageio-ffmpeg")
        sys.exit(1)
    print(f"ffmpeg: {ffmpeg}")
    print()

    # 扫描作品视频
    print("=== 作品视频 ===")
    scan_dir(os.path.join(CONTENT, "works", "video"))

    # 扫描日常视频
    print()
    print("=== 日常视频 ===")
    scan_dir(os.path.join(CONTENT, "daily"))

    print()
    print("封面截取完成。")
