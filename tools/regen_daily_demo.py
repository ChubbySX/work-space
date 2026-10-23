# -*- coding: utf-8 -*-
"""重建“日常”示例内容：单图 / 图片组（专辑）/ 视频+说明文本。"""
import os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = os.path.join(ROOT, "content", "daily")
VIDEO_SRC = os.path.join(ROOT, "content", "works", "video", "齿轮转动演示.gif")

# 清空 daily 现有文件
for f in os.listdir(DAILY):
    p = os.path.join(DAILY, f)
    if os.path.isfile(p):
        os.remove(p)

def svg(w, h, body):
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n{body}\n</svg>\n')

def grad(id, c1, c2):
    return (f'<linearGradient id="{id}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>')

def text(x, y, s, size, fill, anchor="middle", weight="700", opacity=None):
    o = f' opacity="{opacity}"' if opacity else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" '
            f'font-weight="{weight}" font-family="PingFang SC, Microsoft YaHei, sans-serif"{o}>{s}</text>')

def place_card(fname, w, h, c1, c2, icon, cap, sub):
    body = ('<defs>' + grad("g", c1, c2) + '</defs>'
            f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
            f'<circle cx="{w*0.82}" cy="{h*0.16}" r="{min(w,h)*0.22}" fill="rgba(255,255,255,.10)"/>'
            f'<circle cx="{w*0.12}" cy="{h*0.9}" r="{min(w,h)*0.3}" fill="rgba(255,255,255,.08)"/>'
            + text(w/2, h*0.42, icon, min(w,h)*0.24, "#ffffff")
            + text(w/2, h*0.56, cap, 34, "#ffffff")
            + text(w/2, h*0.93, sub, 19, "rgba(255,255,255,.72)"))
    with open(os.path.join(DAILY, fname), "w", encoding="utf-8") as f:
        f.write(svg(w, h, body))

# ---- 单图 ----
place_card("骑行路上.svg", 640, 820, "#2563eb", "#7c3aed", "🚴", "骑行路上", "示例占位 · 换成你的照片")
place_card("工坊时光.svg", 640, 640, "#0f766e", "#2563eb", "🔧", "工坊时光", "示例占位 · 换成你的照片")

# ---- 图片组（专辑）----
album = os.path.join(DAILY, "海边随手拍")
os.makedirs(album, exist_ok=True)
def place_album_card(fname, c1, c2, icon, cap):
    body = ('<defs>' + grad("g", c1, c2) + '</defs>'
            f'<rect width="640" height="760" fill="url(#g)"/>'
            f'<circle cx="520" cy="120" r="150" fill="rgba(255,255,255,.10)"/>'
            f'<circle cx="80" cy="680" r="190" fill="rgba(255,255,255,.08)"/>'
            + text(320, 320, icon, 100, "#ffffff")
            + text(320, 420, cap, 32, "#ffffff")
            + text(320, 700, "示例占位 · 专辑内照片", 18, "rgba(255,255,255,.7)"))
    with open(os.path.join(album, fname), "w", encoding="utf-8") as f:
        f.write(svg(640, 760, body))
place_album_card("周末散步.svg", "#b45309", "#dc2626", "🌿", "周末散步")
place_album_card("装机日常.svg", "#0f766e", "#0369a1", "🖥️", "装机日常")
place_album_card("晚霞海岸.svg", "#e0782c", "#7a3b5c", "🌇", "晚霞海岸")
with open(os.path.join(DAILY, "海边随手拍.txt"), "w", encoding="utf-8") as f:
    f.write("一组青岛海边的随手拍（示例说明）——把多张照片放进同一个文件夹，网站会自动显示成“共 N 张”的相册卡片。")

# ---- 视频 + 说明 ----
if os.path.exists(VIDEO_SRC):
    shutil.copy(VIDEO_SRC, os.path.join(DAILY, "工坊小动画.gif"))
    with open(os.path.join(DAILY, "工坊小动画.txt"), "w", encoding="utf-8") as f:
        f.write("工坊小动画（示例视频）——日常板块支持视频，可以配上这段说明文字。换成真实 .mp4 就能直接播放。")
    print("[OK] 视频示例 -> 工坊小动画.gif")
print("日常示例内容重建完成")