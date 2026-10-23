# -*- coding: utf-8 -*-
"""
生成三段环境背景音乐（纯 Python 合成 WAV → MP3）：
  1. 海风海浪  2. 春日鸟鸣  3. 都市喧嚣
无外部依赖，用 numpy 合成波形，再用内置 ffmpeg 转 mp3。
"""
import os, struct, wave, math, random
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "content", "audio")
os.makedirs(AUDIO, exist_ok=True)

SR = 44100  # 采样率
DUR = 30    # 每段时长（秒），循环播放

def save_wav(path, samples):
    """samples: float32 numpy array [-1,1], mono"""
    samples = np.clip(samples, -1, 1)
    data = (samples * 32767).astype(np.int16)
    with wave.open(path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(f"  WAV: {os.path.basename(path)} ({len(data)/SR:.1f}s)")

def to_mp3(wav_path, mp3_path):
    """用 ffmpeg 将 wav 转 mp3"""
    import subprocess
    # 尝试 imageio-ffmpeg
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        import shutil
        ff = shutil.which("ffmpeg")
    if not ff:
        print(f"  [!] 无 ffmpeg，保留 WAV: {os.path.basename(wav_path)}")
        return False
    subprocess.run([ff, '-y', '-i', wav_path, '-codec:a', 'libmp3lame',
                    '-b:a', '128k', mp3_path],
                   capture_output=True, timeout=30)
    if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 100:
        os.remove(wav_path)
        print(f"  MP3: {os.path.basename(mp3_path)} ({os.path.getsize(mp3_path)//1024}KB)")
        return True
    return False

# ======================== 1. 海风海浪 ========================
def gen_ocean():
    print("[1/3] 合成：海风海浪")
    n = SR * DUR
    t = np.arange(n) / SR
    # 多层海浪：不同频率的正弦叠加模拟涨落
    wave1 = np.sin(2*np.pi * 0.13 * t)    # 慢周期涨落
    wave2 = np.sin(2*np.pi * 0.07 * t + 1.3)
    swell = (wave1 * 0.5 + wave2 * 0.3 + 0.2)  # 0~1 包络
    swell = np.clip(swell, 0, 1)
    # 白噪声 = 海浪声 + 风声
    noise = np.random.randn(n).astype(np.float32)
    # 低通滤波（简易：滑动平均）
    kern = 80
    noise = np.convolve(noise, np.ones(kern)/kern, mode='same')
    # 用 swell 调制噪声幅度 → 涨潮声音大、退潮声音小
    audio = noise * swell * 0.6
    # 叠加风声（高频成分）
    wind_noise = np.random.randn(n).astype(np.float32)
    wind_noise = np.convolve(wind_noise, np.ones(20)/20, mode='same')
    audio += wind_noise * 0.15 * (0.5 + 0.5*np.sin(2*np.pi*0.05*t))
    # 淡入淡出
    fade = int(SR * 2)
    audio[:fade] *= np.linspace(0, 1, fade)
    audio[-fade:] *= np.linspace(1, 0, fade)
    audio = audio.astype(np.float32) * 0.7
    wav = os.path.join(AUDIO, "ocean_temp.wav")
    mp3 = os.path.join(AUDIO, "海风海浪.mp3")
    save_wav(wav, audio)
    to_mp3(wav, mp3)

# ======================== 2. 春日鸟鸣 ========================
def gen_spring():
    print("[2/3] 合成：春日鸟鸣")
    n = SR * DUR
    t = np.arange(n) / SR
    audio = np.zeros(n, dtype=np.float32)
    # 鸟鸣：随机短促的频率调制正弦
    random.seed(42)
    for _ in range(45):
        start = random.randint(SR, n - SR * 3)
        dur_bird = random.randint(int(SR*0.15), int(SR*0.5))
        f0 = random.uniform(2000, 4500)
        # 频率上扫
        freq = f0 + random.uniform(200, 800) * np.linspace(0, 1, dur_bird)
        phase = 2*np.pi * np.cumsum(freq) / SR
        tweet = np.sin(phase) * 0.25
        # 包络（快速淡入淡出）
        env = np.ones(dur_bird)
        fade = min(50, dur_bird//4)
        env[:fade] = np.linspace(0, 1, fade)
        env[-fade:] = np.linspace(1, 0, fade)
        tweet *= env
        end = min(start + dur_bird, n)
        audio[start:end] += tweet[:end-start]
    # 背景风声 + 树叶沙沙
    bg = np.random.randn(n).astype(np.float32)
    bg = np.convolve(bg, np.ones(60)/60, mode='same') * 0.08
    bg *= 0.5 + 0.5 * np.sin(2*np.pi*0.03*t)
    audio += bg
    # 淡入淡出
    fade = int(SR * 2)
    audio[:fade] *= np.linspace(0, 1, fade)
    audio[-fade:] *= np.linspace(1, 0, fade)
    audio = np.clip(audio, -1, 1) * 0.6
    wav = os.path.join(AUDIO, "spring_temp.wav")
    mp3 = os.path.join(AUDIO, "春日鸟鸣.mp3")
    save_wav(wav, audio)
    to_mp3(wav, mp3)

# ======================== 3. 都市喧嚣 ========================
def gen_city():
    print("[3/3] 合成：都市喧嚣")
    n = SR * DUR
    t = np.arange(n) / SR
    audio = np.zeros(n, dtype=np.float32)
    random.seed(99)
    # 低频底噪（交通嗡嗡声）
    rumble = np.random.randn(n).astype(np.float32)
    rumble = np.convolve(rumble, np.ones(200)/200, mode='same') * 0.15
    audio += rumble
    # 汽车驶过：带通噪声 + 多普勒效应模拟
    for _ in range(12):
        start = random.randint(0, n - SR * 4)
        dur_car = random.randint(int(SR*2), int(SR*4))
        car = np.random.randn(dur_car).astype(np.float32)
        car = np.convolve(car, np.ones(30)/30, mode='same')
        # 多普勒：频率先升后降
        dop = np.sin(2*np.pi * (0.5 + 0.3*np.sin(np.linspace(0, np.pi, dur_car))) * np.arange(dur_car)/SR)
        car = car * (0.4 + 0.3 * np.sin(np.linspace(0, np.pi, dur_car)))  # 驶近→远离
        end = min(start + dur_car, n)
        audio[start:end] += car[:end-start] * 0.3
    # 远处鸣笛（短促中频音）
    for _ in range(5):
        start = random.randint(SR, n - SR)
        horn_dur = int(SR * 0.8)
        f = random.choice([400, 500, 450])
        horn = np.sin(2*np.pi*f*np.arange(horn_dur)/SR) * 0.15
        horn *= np.hanning(horn_dur)  # 平滑包络
        end = min(start + horn_dur, n)
        audio[start:end] += horn[:end-start]
    # 人群杂音
    crowd = np.random.randn(n).astype(np.float32)
    crowd = np.convolve(crowd, np.ones(100)/100, mode='same') * 0.06
    audio += crowd
    # 淡入淡出
    fade = int(SR * 2)
    audio[:fade] *= np.linspace(0, 1, fade)
    audio[-fade:] *= np.linspace(1, 0, fade)
    audio = np.clip(audio, -1, 1) * 0.55
    wav = os.path.join(AUDIO, "city_temp.wav")
    mp3 = os.path.join(AUDIO, "都市喧嚣.mp3")
    save_wav(wav, audio)
    to_mp3(wav, mp3)

if __name__ == "__main__":
    print("开始生成背景音乐...")
    gen_ocean()
    gen_spring()
    gen_city()
    print("\n完成！文件在 content/audio/")
    for f in sorted(os.listdir(AUDIO)):
        if f.endswith('.mp3'):
            print(f"  {f}  ({os.path.getsize(os.path.join(AUDIO,f))//1024}KB)")
