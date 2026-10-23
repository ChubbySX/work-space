# -*- coding: utf-8 -*-
"""压缩超 GitHub 100MB 上限的大文件，使其可上传。
视频: 720p H.264 CRF28；图片: 缩放到 1920 宽。
输出到 *_compressed / *_new，不动原始文件（由后续步骤备份+替换）。
"""
import os, subprocess, imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
print("ffmpeg:", FF)
print("ffmpeg exists:", os.path.exists(FF))
if not os.path.exists(FF):
    print("ERROR: ffmpeg 不可用")
    raise SystemExit(1)

ROOT = "D:/DS harnessw/work station/personal-website"

def mb(p):
    return round(os.path.getsize(p) / 1048576, 1) if os.path.exists(p) else None

# ---------- 视频: 宿舍.mp4 ----------
vsrc = ROOT + "/content/works/video/宿舍.mp4"
vout = ROOT + "/content/works/video/宿舍_compressed.mp4"
print("\n=== 视频 ===")
print("源:", mb(vsrc), "MB")
cmd = [FF, "-y", "-nostats", "-i", vsrc,
       "-c:v", "libx264", "-preset", "fast", "-crf", "28",
       "-vf", "scale=-2:720",
       "-c:a", "aac", "-b:a", "128k",
       "-movflags", "+faststart", vout]
r = subprocess.run(cmd, capture_output=True, text=True)
print("returncode:", r.returncode)
if r.returncode != 0:
    print("STDERR tail:", r.stderr[-1500:])
print("压缩后:", mb(vout), "MB")

# ---------- 图片: 宿舍.png ----------
isrc = ROOT + "/content/works/image/宿舍.png"
iout = ROOT + "/content/works/image/宿舍_new.png"
print("\n=== 图片 ===")
print("源:", mb(isrc), "MB")
cmd = [FF, "-y", "-nostats", "-i", isrc, "-vf", "scale=1920:-2", "-update", "1", iout]
r = subprocess.run(cmd, capture_output=True, text=True)
print("returncode:", r.returncode)
if r.returncode != 0:
    print("STDERR tail:", r.stderr[-1500:])
print("压缩后:", mb(iout), "MB")

print("\nALLDONE")
