# -*- coding: utf-8 -*-
"""处理证件照（蓝底抠图）并提取首页照片主题色。"""
import os, shutil
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "content")

# ---------- 1. 首页背景（候选图已删则跳过，保留现有背景） ----------
_cand = os.path.join(ROOT, ".candidates", "city-sunset.jpg")
if os.path.exists(_cand):
    shutil.copy(_cand, os.path.join(CONTENT, "hero-dusk.jpg"))
    print("[OK] 首页背景 -> content/hero-dusk.jpg")
else:
    print("[--] 首页背景已存在，跳过复制")

# ---------- 2. 主题色提取 ----------
im = Image.open(os.path.join(CONTENT, "hero-dusk.jpg")).convert("RGB")
small = im.resize((120, 80))
q = small.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
pal = q.getpalette()[:18]
print("[主题色] 主色调:")
for i in range(6):
    c = pal[i*3:i*3+3]
    lum = 0.299*c[0] + 0.587*c[1] + 0.114*c[2]
    print(f"   #{c[0]:02X}{c[1]:02X}{c[2]:02X}  亮度={lum:.0f}")
# 全图平均/最亮色（供文字对比用）
arr = np.asarray(im.resize((200, 150))).astype(np.float32)
print(f"[参考] 全图平均色 #{np.round(arr.mean(axis=(0,1))).astype(int)}")

# ---------- 3. 证件照抠图 ----------
ATT = r"C:\Users\23003\.dsh\attachments\v1\objects\90\905643b2f5cae4ca9bbf889af5eca4d2bd2f1d91aa7b55eb1b15cf6783aff33d"
SRC = os.path.join(CONTENT, "portrait-证件照.jpg")
if os.path.exists(SRC):
    src_path = SRC
else:
    if not os.path.exists(ATT):
        cand = ATT + ".jpg"
        if os.path.exists(cand):
            ATT = cand
    if os.path.exists(ATT):
        shutil.copy(ATT, SRC)
        src_path = SRC
    else:
        src_path = None
        print("[!!] 未找到证件照（content/portrait-证件照.jpg 或原始附件）")

if src_path:
    src = Image.open(src_path).convert("RGB")
    a = np.asarray(src).astype(np.float32)
    h, w, _ = a.shape

    # 用四周边框像素估计背景色（证件照蓝）
    m = 8
    border = np.concatenate([
        a[:m].reshape(-1, 3), a[-m:].reshape(-1, 3),
        a[:, :m].reshape(-1, 3), a[:, -m:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    print(f"[抠图] 背景色 ≈ RGB{np.round(bg).astype(int)}，原图 {w}x{h}")

    dist = np.sqrt(((a - bg) ** 2).sum(axis=-1))
    thr1, thr2 = 60, 130
    alpha = np.clip((dist - thr1) / (thr2 - thr1), 0, 1)

    # 平滑蒙版
    mask = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.8))
    alpha = np.asarray(mask).astype(np.float32) / 255.0

    # 去蓝边（despill）：在边缘半透明处按底色反推真实颜色
    alpha3 = np.clip(alpha, 0.05, 1)[:, :, None]
    out_rgb = np.clip((a - (1 - alpha3) * bg) / alpha3, 0, 255)

    # 注意：alpha 是 0~1 浮点，写 RGBA 前必须乘 255（否则人物会整张隐形）
    alpha8 = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    rgba = np.dstack([out_rgb, alpha8])
    out = Image.fromarray(rgba.astype(np.uint8), "RGBA")

    # 自动裁剪到人物区域
    ys, xs = np.where(alpha > 0.10)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    pad = 36
    box = (max(x0 - pad, 0), max(y0 - pad, 0), min(x1 + pad, w), min(y1 + pad, h))
    out = out.crop(box)

    # 按 3:4 构图居中加透明边
    cw, ch = out.size
    target_w = int(ch * 0.75)
    if cw < target_w:
        canvas = Image.new("RGBA", (target_w, ch), (0, 0, 0, 0))
        canvas.paste(out, ((target_w - cw) // 2, 0), out)
        out = canvas
    if out.size[1] > 1500:
        out = out.resize((int(out.size[0] * 1500 / out.size[1]), 1500), Image.LANCZOS)
    out.save(os.path.join(CONTENT, "me-cutout.png"))
    print(f"[OK] 抠图完成 -> content/me-cutout.png {out.size}")
else:
    print("[!!] 未找到证件照附件:", ATT)
print("DONE")