# -*- coding: utf-8 -*-
"""生成个人网站的示例素材（占位图 / 动画 GIF / 示例文档）。
运行一次即可；之后用户替换 content/ 里的真实内容。
用法：python tools/make_demo_assets.py
"""
import os
import math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = lambda *p: os.path.join(ROOT, "content", *p)

def ensure(*parts):
    d = C(*parts) if parts else os.path.join(ROOT, "content")
    os.makedirs(d, exist_ok=True)
    return d

def write_asset(relpath, content, mode="w", encoding="utf-8"):
    """把 relpath（相对 content/）写成文件，自动建父目录。"""
    full = C(relpath)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, mode, encoding=encoding, newline="") as f:
        f.write(content)
    return full

# ---------------------------------------------------------------- SVG 助手
def svg(w, h, body):
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}">\n{body}\n</svg>\n')

def grad(id, c1, c2, x1=0, y1=0, x2=0, y2=1):
    return (f'<linearGradient id="{id}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
            f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>'
            f'</linearGradient>')

def text(x, y, s, size, fill, anchor="middle", weight="700", opacity=None, spacing=None):
    o = f' opacity="{opacity}"' if opacity else ""
    sp = f' letter-spacing="{spacing}"' if spacing else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-weight="{weight}" font-family="PingFang SC, Microsoft YaHei, sans-serif"{sp}{o}>{s}</text>')

# ---------------------------------------------------------------- 头像
def make_avatar():
    body = (
        '<defs>' + grad("g0", "#1c1b1a", "#1d4ed8", 0, 0, 1, 1) + '</defs>'
        '<rect width="512" height="512" fill="url(#g0)"/>'
        '<circle cx="256" cy="256" r="176" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="6"/>'
        '<circle cx="256" cy="256" r="138" fill="rgba(255,255,255,.10)"/>'
        + text(256, 300, "钟", 150, "#ffffff", spacing=4)
        + text(256, 396, "CHUBBY", 30, "rgba(255,255,255,.85)", spacing=8)
    )
    write_asset("avatar.svg", svg(512, 512, body))

# ---------------------------------------------------------------- 日常占位
def make_daily():
    items = [
        ("日常照片占位-骑行.svg", 640, 800, "#2563eb", "#7c3aed", "🚴", "骑行在路上"),
        ("日常照片占位-工坊时光.svg", 640, 640, "#0f766e", "#2563eb", "🔧", "工坊时光"),
        ("日常照片占位-装机日常.svg", 640, 960, "#b45309", "#dc2626", "🖥️", "装机日常"),
        ("日常照片占位-周末散步.svg", 640, 720, "#0369a1", "#0ea5e9", "🌿", "周末散步"),
    ]
    d = ensure("daily")
    for name, w, h, c1, c2, icon, cap in items:
        body = (
            '<defs>' + grad("g", c1, c2) + '</defs>'
            f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
            f'<circle cx="{w*0.82}" cy="{h*0.16}" r="{min(w,h)*0.22}" fill="rgba(255,255,255,.10)"/>'
            f'<circle cx="{w*0.12}" cy="{h*0.9}" r="{min(w,h)*0.3}" fill="rgba(255,255,255,.08)"/>'
            + text(w/2, h*0.42, icon, min(w,h)*0.24, "#ffffff")
            + text(w/2, h*0.55, cap, 34, "#ffffff")
            + text(w/2, h*0.93, "示例占位 · 替换为你的照片", 20, "rgba(255,255,255,.75)")
        )
        write_asset(os.path.join("daily", name), svg(w, h, body))

# ---------------------------------------------------------------- 作品图片占位
def make_work_images():
    items = [
        ("示例作品图-机械结构.svg", 800, 500, "#1e293b", "#1d4ed8", "⚙️", "机械结构作品"),
        ("示例作品图-建模渲染.svg", 800, 560, "#312e81", "#0ea5e9", "🧊", "3D 建模渲染"),
    ]
    d = ensure("works", "image")
    for name, w, h, c1, c2, icon, cap in items:
        body = (
            '<defs>' + grad("g", c1, c2) + '</defs>'
            f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
            f'<rect x="28" y="28" width="{w-56}" height="{h-56}" rx="18" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/>'
            + text(w/2, h*0.44, icon, 84, "#ffffff")
            + text(w/2, h*0.62, cap, 32, "#ffffff")
            + text(w/2, h*0.84, "示例占位 · 替换为你的作品图片", 19, "rgba(255,255,255,.72)")
        )
        write_asset(os.path.join("works", "image", name), svg(w, h, body))
    # 给机械结构那张配一句描述
    write_asset(os.path.join("works", "image", "示例作品图-机械结构.txt"),
                "这是我做的一个机械结构设计（示例描述）——你可以为每个作品写一句介绍，方法见 README。")

# ---------------------------------------------------------------- 默认海报
def make_posters():
    # 视频卡片默认海报
    body = (
        '<defs>' + grad("g", "#111827", "#1d4ed8") + '</defs>'
        '<rect width="800" height="500" fill="url(#g)"/>'
        '<circle cx="400" cy="205" r="64" fill="rgba(255,255,255,.92)"/>'
        '<polygon points="380,168 380,242 448,205" fill="#111827"/>'
        + text(400, 330, "视频作品占位", 36, "#ffffff", spacing=2)
        + text(400, 386, "把你的 .mp4 放进 content/works/video/ 即可播放", 22, "rgba(255,255,255,.75)")
        + text(400, 446, "（此图为占位封面，会自动替换）", 18, "rgba(255,255,255,.5)")
    )
    write_asset(os.path.join("works", "video.svg"), svg(800, 500, body))

    # 文档卡片默认海报
    body = (
        '<defs>' + grad("g", "#78350f", "#b45309") + '</defs>'
        '<rect width="800" height="500" fill="url(#g)"/>'
        '<rect x="352" y="120" width="96" height="128" rx="10" fill="rgba(255,255,255,.94)"/>'
        '<rect x="364" y="150" width="72" height="10" rx="5" fill="#b45309"/>'
        '<rect x="364" y="174" width="72" height="8" rx="4" fill="#d6d3d1"/>'
        '<rect x="364" y="190" width="52" height="8" rx="4" fill="#d6d3d1"/>'
        + text(400, 330, "文档作品占位", 36, "#ffffff", spacing=2)
        + text(400, 386, "Word / PPT / PDF / Excel 均可直接下载", 22, "rgba(255,255,255,.78)")
    )
    write_asset(os.path.join("works", "doc.svg"), svg(800, 500, body))

# ---------------------------------------------------------------- 齿轮动画 GIF
def make_gear_gif():
    from PIL import Image, ImageDraw
    W, H = 360, 300
    cx, cy = W // 2, H // 2
    n_teeth = 8
    r_out, r_in, r_hub, r_hole = 92, 74, 34, 14
    frames = []

    def gear_frame(angle_deg):
        img = Image.new("RGB", (W, H), "#fafaf8")
        dr = ImageDraw.Draw(img)
        a0 = math.radians(angle_deg)
        tooth_w = math.radians(360 / n_teeth) * 0.42
        # 齿
        pts = []
        for i in range(n_teeth):
            a = a0 + i * math.radians(360 / n_teeth)
            ca = math.cos(a); sa = math.sin(a)
            hull = (
                (cx + (r_out+10) * math.cos(a - tooth_w), cy + (r_out+10) * math.sin(a - tooth_w)),
                (cx + r_in * math.cos(a - tooth_w), cy + r_in * math.sin(a - tooth_w)),
                (cx + r_in * math.cos(a + tooth_w), cy + r_in * math.sin(a + tooth_w)),
                (cx + (r_out+10) * math.cos(a + tooth_w), cy + (r_out+10) * math.sin(a + tooth_w)),
            )
            pts.extend(hull)
        dr.polygon(pts, fill="#1d4ed8")
        # 外圈
        dr.ellipse([cx-r_out, cy-r_out, cx+r_out, cy+r_out], fill="#1d4ed8")
        # 辐条孔
        for i in range(4):
            a = a0 + i * math.radians(90)
            rx = cx + 52 * math.cos(a) - 8
            ry = cy + 52 * math.sin(a) - 8
            dr.ellipse([rx, ry, rx+16, ry+16], fill="#fafaf8")
        # 轮毂
        dr.ellipse([cx-r_hub, cy-r_hub, cx+r_hub, cy+r_hub], fill="#1e40af")
        dr.ellipse([cx-r_hole, cy-r_hole, cx+r_hole, cy+r_hole], fill="#fafaf8")
        return img

    # 8 齿齿轮每 45° 重复，12 帧均匀旋转构成无缝循环
    for k in range(12):
        frames.append(gear_frame(k * 45.0 / 12))
    d = ensure("works", "video")
    frames[0].save(
        os.path.join(d, "齿轮转动演示.gif"),
        save_all=True, append_images=frames[1:], duration=120, loop=0, optimize=True,
    )
    write_asset(os.path.join("works", "video", "齿轮转动演示.txt"),
                "齿轮转动动画（示例视频占位）——这是用动画模拟的示例，把你的真实视频文件（.mp4 等）放进这个文件夹就能直接播放。")

# ---------------------------------------------------------------- 示例文档
def make_docs():
    doc_dir = ensure("works", "doc")

    # Word
    try:
        from docx import Document
        from docx.shared import Pt
        doc = Document()
        doc.add_heading("示例 Word 作品说明", 0)
        doc.add_paragraph("这是一份自动生成的示例文档，用来演示网站的文档卡片效果。你可以把真实的 Word 作品直接放进 content/works/doc/ 文件夹。")
        doc.add_heading("文档里可以写点什么？", level=1)
        for t in ["项目 / 设计说明", "学习笔记与总结", "论文 / 报告初稿"]:
            doc.add_paragraph(t, style="List Bullet")
        p = doc.add_paragraph()
        run = p.add_run("祝浏览愉快！")
        run.bold = True
        doc.save(os.path.join(doc_dir, "示例作品说明文档.docx"))
    except Exception as e:
        print("  ⚠ Word 示例生成失败:", e)

    # PPT
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
        prs = Presentation()
        blank = prs.slide_layouts[5]

        def add_slide(title, lines, big=False):
            s = prs.slides.add_slide(blank)
            tb = s.shapes.add_textbox(Inches(0.6), Inches(0.5), Inches(11.3), Inches(6.5))
            tf = tb.text_frame
            tf.word_wrap = True
            tf.text = title
            tf.paragraphs[0].font.size = Pt(40 if big else 28)
            tf.paragraphs[0].font.bold = True
            for ln in lines:
                para = tf.add_paragraph()
                para.text = ln
                para.font.size = Pt(18)
            return s

        add_slide("示例 PPT 演示文稿", ["自动生成的示例幻灯片", "用来演示网站的文档下载卡片"], big=True)
        add_slide("目录", ["一、项目背景", "二、技术方案", "三、成果展示"])
        add_slide("技术方案", ["• 机械结构设计", "• 3D 建模与装配", "• 动手测试与迭代"])
        add_slide("谢谢观看", ["有任何想法欢迎交流 👋"], big=True)
        prs.save(os.path.join(doc_dir, "示例演示文稿.pptx"))
    except Exception as e:
        print("  ⚠ PPT 示例生成失败:", e)

    # Excel
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        wb = Workbook()
        ws = wb.active
        ws.title = "示例数据"
        headers = ["项目", "数量", "完成度"]
        ws.append(headers)
        rows = [["齿轮模型", 3, "100%"], ["图纸整理", 1, "60%"], ["视频剪辑", 2, "80%"]]
        for r in rows:
            ws.append(r)
        for j, h in enumerate(headers, 1):
            c = ws.cell(1, j)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="1D4ED8")
            c.alignment = Alignment(horizontal="center")
        for i in range(1, 5):
            ws.cell(i, 3).alignment = Alignment(horizontal="center")
        wb.save(os.path.join(doc_dir, "示例数据表格.xlsx"))
    except Exception as e:
        print("  ⚠ Excel 示例生成失败:", e)

if __name__ == "__main__":
    print("生成示例素材……")
    make_avatar();    print("  [OK] 头像")
    make_daily();     print("  [OK] 日常占位图 x4")
    make_work_images(); print("  [OK] 作品占位图 x2")
    make_posters();   print("  [OK] 视频/文档默认海报")
    make_gear_gif();  print("  [OK] 齿轮动画 GIF")
    make_docs();      print("  [OK] 示例 Word / PPT / Excel")
    print("完成。")