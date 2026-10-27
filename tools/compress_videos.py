#!/usr/bin/env python
"""批量重编码视频到 720p H.264 CRF28，降低仓库体积。"""
import os, subprocess, sys, shutil

FFMPEG = r"C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
VIDEO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "content", "works", "video")

# 只压这4个（火控.mp4 已经只有1MB，跳过）
TARGETS = ["宿舍.mp4", "移栽机！.mp4", "地铁.mp4", "狐狸森林.mp4"]

def compress_one(src):
    if not os.path.exists(src):
        print(f"  SKIP (not found): {os.path.basename(src)}")
        return False
    sz_before = os.path.getsize(src)
    tmp = src + ".tmp.mp4"
    # 720p H.264 CRF28 + AAC 128k, faststart for web
    cmd = [
        FFMPEG, "-y", "-i", src,
        "-vf", "scale=-2:720",      # 等比缩放到720p高
        "-c:v", "libx264", "-crf", "28", "-preset", "medium",
        "-profile:v", "high", "-level", "4.0",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        tmp
    ]
    print(f"  Encoding: {os.path.basename(src)} ({sz_before/1048576:.1f}MB) → 720p CRF28...")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0 or not os.path.exists(tmp):
        print(f"  FAILED: {r.stderr[-500:] if r.stderr else 'no stderr'}")
        if os.path.exists(tmp):
            os.remove(tmp)
        return False
    sz_after = os.path.getsize(tmp)
    pct = (1 - sz_after / sz_before) * 100
    print(f"  OK: {sz_before/1048576:.1f}MB → {sz_after/1048576:.1f}MB (省 {pct:.0f}%)")
    shutil.move(tmp, src)  # 替换原文件
    return True

def main():
    os.chdir(VIDEO_DIR)
    print(f"Video dir: {VIDEO_DIR}")
    ok, fail = 0, 0
    for name in TARGETS:
        src = os.path.join(VIDEO_DIR, name)
        if compress_one(src):
            ok += 1
        else:
            fail += 1
    print(f"\n完成: {ok} 成功, {fail} 失败")

if __name__ == "__main__":
    main()
