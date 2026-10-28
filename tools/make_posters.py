# -*- coding: utf-8 -*-
"""从视频文件中截取一帧画面作为封面（poster）。
自动扫描 content/works/video/ 和 content/daily/ 里的视频文件，
对没有 .poster.jpg 的视频自动选帧生成封面：
  1. 探测时长 → 均匀采样 5 个时间点（5%/20%/40%/60%/80%）抽小帧；
  2. 用亮度方差做「画面信息量」打分，选信息最丰富的一帧；
  3. 在该时间点按 800px 出正式封面。探测/采样失败则回落 [3,1,0.5]s。
"""
import os
import re
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


def probe_duration(ffmpeg, video_path):
    """从 ffmpeg -i 的 stderr 里解析 Duration，失败返回 None"""
    try:
        r = subprocess.run([ffmpeg, "-i", video_path], capture_output=True, timeout=30)
        text = (r.stderr or b"").decode("utf-8", "ignore") + (r.stdout or b"").decode("utf-8", "ignore")
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
        if m:
            h, mi, s = m.groups()
            return int(h) * 3600 + int(mi) * 60 + float(s)
    except Exception:
        pass
    return None


def frame_score(img_path):
    """小帧的亮度方差（画面信息量）——越有内容分数越高"""
    try:
        from PIL import Image
        im = Image.open(img_path).convert("L")
        w, h = im.size
        px = im.load()
        step = 3
        s = n = 0
        for y in range(0, h, step):
            for x in range(0, w, step):
                s += px[x, y]
                n += 1
        mean = s / max(n, 1)
        v = 0
        for y in range(0, h, step):
            for x in range(0, w, step):
                d = px[x, y] - mean
                v += d * d
        return v / max(n, 1)
    except Exception:
        return -1


def pick_best_time(ffmpeg, video_path):
    """采样打分选最合适的时间点；失败返回 None 走回落逻辑"""
    dur = probe_duration(ffmpeg, video_path)
    points = [dur * f for f in (0.05, 0.2, 0.4, 0.6, 0.8)] if (dur and dur > 1) else [3, 1, 0.5]
    best_t, best_sc = None, -1
    for t in points:
        small = video_path + ".pick.jpg"   # 与 poster 同目录，保证可写
        try:
            cmd = [ffmpeg, "-y", "-ss", str(t), "-i", video_path,
                   "-frames:v", "1", "-vf", "scale=240:-1", "-q:v", "3", small]
            r = subprocess.run(cmd, capture_output=True, timeout=60)
            if r.returncode != 0 or not os.path.exists(small):
                continue
            sc = frame_score(small)
            if sc > best_sc:
                best_t, best_sc = t, sc
        finally:
            try:
                if os.path.exists(small):
                    os.remove(small)
            except Exception:
                pass
    return best_t


def extract_frame(ffmpeg, video_path, poster_path, seek):
    """从视频 seek 秒处截取一帧，800px 宽 q3"""
    cmd = [
        ffmpeg, "-y",
        "-ss", str(seek),
        "-i", video_path,
        "-frames:v", "1",
        "-vf", "scale=800:-1",
        "-q:v", "3",
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
        print(f"  [..] 正在选帧截封面: {f}")
        t = pick_best_time(ffmpeg, video)
        ok = False
        if t is not None and extract_frame(ffmpeg, video, poster, t):
            ok = True
        if not ok:
            # 回落：3秒、1秒、0.5秒
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
