#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_thumbs.py —— 为图片/视频封面生成低分辨率 WebP 缩略图（预览用，加速加载）
   原图不动；缩略图存到 content/.thumbs/<相对路径>.webp（400px 宽，质量 60）
   增量生成：缩略图已存在且不旧于原图则跳过。"""
import os, sys

try:
    from PIL import Image
except ImportError:
    print("ERROR: 需要 Pillow，请 pip install Pillow", file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "content")
THUMB_DIR = os.path.join(CONTENT, ".thumbs")
THUMB_W = 400
QUALITY = 60
EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tiff")

def make_thumb(src, dst):
    try:
        mtime_src = os.path.getmtime(src)
    except OSError:
        return False
    if os.path.exists(dst) and os.path.getmtime(dst) >= mtime_src:
        return False  # 已有且新，跳过
    try:
        im = Image.open(src)
        try:
            im.draft("RGB", (THUMB_W, THUMB_W))  # JPEG 快速低分打开
        except Exception:
            pass
        im = im.convert("RGB")
        w, h = im.size
        if w > THUMB_W:
            nh = max(1, int(h * THUMB_W / w))
            im = im.resize((THUMB_W, nh), Image.LANCZOS)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        im.save(dst, "WebP", quality=QUALITY, method=4)
        return True
    except Exception as e:
        print("WARN: 缩略图失败 %s: %s" % (src, e), file=sys.stderr)
        return False

def scan_dir(sub):
    d = os.path.join(CONTENT, sub)
    if not os.path.isdir(d):
        return
    for root, _, files in os.walk(d):
        for f in files:
            if f.startswith(".") or not f.lower().endswith(EXTS):
                continue
            src = os.path.join(root, f)
            rel = os.path.relpath(src, CONTENT)
            dst = os.path.join(THUMB_DIR, os.path.splitext(rel)[0] + ".webp")
            yield src, dst

count = 0
# 日常 + 图片作品
for sub in ["daily", "works/image"]:
    for src, dst in scan_dir(sub):
        if make_thumb(src, dst):
            count += 1

# 视频封面 poster（make_posters.py 生成的 *.poster.jpg）
vd = os.path.join(CONTENT, "works", "video")
if os.path.isdir(vd):
    for f in os.listdir(vd):
        low = f.lower()
        if low.endswith(".poster.jpg") or low.endswith(".poster.jpeg") or low.endswith(".poster.png"):
            src = os.path.join(vd, f)
            rel = os.path.relpath(src, CONTENT)
            dst = os.path.join(THUMB_DIR, os.path.splitext(rel)[0] + ".webp")
            if make_thumb(src, dst):
                count += 1

print("OK thumbs=%d (dir=%s)" % (count, THUMB_DIR))
