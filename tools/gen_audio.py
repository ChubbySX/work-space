# -*- coding: utf-8 -*-
"""
生成三段更自然的背景音乐（FFT 滤波 + 谐波合成 + 乐器模仿）：
  1. 海风海浪 — 颂钵冥想音 + 多频段海浪噪声 + 水滴
  2. 春日鸟鸣 — 五声音阶笛声旋律 + 风铃 + FM 鸟鸣 + 微风
  3. 都市喧嚣 — 低频脉动 + 多普勒车流 + 鸣笛 + 城市嗡鸣
"""
import os, wave, random
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "content", "audio")
os.makedirs(AUDIO, exist_ok=True)
SR = 44100
DUR = 60

# ====== 工具 ======

def bandpass(sig, low, high):
    spec = np.fft.rfft(sig)
    freqs = np.fft.rfftfreq(len(sig), 1.0/SR)
    spec[(freqs < low) | (freqs > high)] = 0
    return np.fft.irfft(spec, len(sig)).astype(np.float32)

def fade_io(audio, sec=2):
    f = int(SR * sec)
    audio[:f] *= np.linspace(0, 1, f)
    audio[-f:] *= np.linspace(1, 0, f)
    return audio

def flute(freq, dur, vol=0.3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 4 * np.sin(2*np.pi*5*t)
    phase = 2*np.pi * np.cumsum(freq + vib) / SR
    tone = np.sin(phase) + 0.4*np.sin(phase*2) + 0.15*np.sin(phase*3) + 0.06*np.sin(phase*4)
    env = np.ones(n)
    a, r = int(SR*0.06), min(int(SR*0.25), n//3)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    tone += 0.015 * np.random.randn(n)
    return (tone * env * vol / 1.61).astype(np.float32)

def chime(freq, dur, vol=0.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tone = (np.sin(2*np.pi*freq*t) + 0.5*np.sin(2*np.pi*freq*2.0*t) +
            0.3*np.sin(2*np.pi*freq*2.4*t) + 0.12*np.sin(2*np.pi*freq*3.5*t))
    return (tone * np.exp(-2.5*t/max(dur,0.1)) * vol / 1.92).astype(np.float32)

def bell(freq, dur, vol=0.15):
    n = int(dur * SR)
    t = np.arange(n) / SR
    tone = (np.sin(2*np.pi*freq*t) + 0.5*np.sin(2*np.pi*freq*2*t) +
            0.35*np.sin(2*np.pi*freq*3*t) + 0.2*np.sin(2*np.pi*freq*4.2*t) +
            0.1*np.sin(2*np.pi*freq*5.4*t))
    return (tone * np.exp(-0.8*t/max(dur,0.1)) * vol / 2.15).astype(np.float32)

def bird_chirp(f0, dur, vol=0.25):
    n = int(dur * SR)
    t = np.arange(n) / SR
    freq = f0 + (f0 * 0.3) * np.linspace(0, 1, n)
    mod = 3 * np.sin(2*np.pi*30*t)
    carrier = np.sin(2*np.pi * np.cumsum(freq + mod) / SR)
    env = np.ones(n)
    f = min(40, n//4)
    env[:f] = np.linspace(0, 1, f)
    env[-f:] = np.linspace(1, 0, f)
    return (carrier * env * vol).astype(np.float32)

def save_mp3(audio, name):
    audio = np.clip(audio, -1, 1)
    wav_path = os.path.join(AUDIO, name + "_temp.wav")
    mp3_path = os.path.join(AUDIO, name + ".mp3")
    data = (audio * 32767).astype(np.int16)
    with wave.open(wav_path, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(data.tobytes())
    import subprocess, shutil
    ff = None
    try:
        import imageio_ffmpeg; ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ff = shutil.which("ffmpeg")
    if ff:
        subprocess.run([ff, '-y', '-i', wav_path, '-codec:a', 'libmp3lame',
                        '-b:a', '128k', mp3_path], capture_output=True, timeout=120)
        if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 100:
            os.remove(wav_path)
            print(f"  MP3: {name}.mp3 ({os.path.getsize(mp3_path)//1024}KB)")
            return
    print(f"  WAV: {name}.wav")

# ====== 1. 海风海浪 ======
def gen_ocean():
    print("[1/3] 海风海浪")
    n = SR * DUR
    t = np.arange(n) / SR
    audio = np.zeros(n, dtype=np.float32)
    # 颂钵冥想音
    drone = bell(110, DUR, 0.06) + 0.5 * bell(164.81, DUR, 0.03)
    drone *= (0.6 + 0.4 * np.sin(2*np.pi*0.04*t))
    audio += drone
    # 多频段海浪
    noise = np.random.randn(n).astype(np.float32)
    waves = (bandpass(noise.copy(), 20, 80) * 0.35 +
             bandpass(noise.copy(), 200, 900) * 0.30 +
             bandpass(noise.copy(), 2000, 8000) * 0.12)
    swell = np.clip(0.5 + 0.3*np.sin(2*np.pi*0.12*t) +
             0.15*np.sin(2*np.pi*0.07*t+1.3) + 0.08*np.sin(2*np.pi*0.19*t), 0, 1)
    audio += waves * swell
    # 水滴
    random.seed(7)
    for _ in range(8):
        pos = random.randint(SR, n - SR)
        d = int(SR*0.3)
        audio[pos:pos+d] += chime(random.choice([1047,1319,1568,1760]), 0.3, 0.04)
    audio = fade_io(audio, 2)
    save_mp3(audio * 0.7, "海风海浪")

# ====== 2. 春日鸟鸣 ======
def gen_spring():
    print("[2/3] 春日鸟鸣")
    n = SR * DUR
    t = np.arange(n) / SR
    audio = np.zeros(n, dtype=np.float32)
    random.seed(42)
    # 五声音阶笛声旋律
    penta = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25]
    pos = SR
    while pos < n - SR * 3:
        note = random.choice(penta)
        dur = random.uniform(0.6, 1.5)
        d = int(dur*SR)
        audio[pos:pos+d] += flute(note, dur, 0.18)
        pos += d + random.randint(int(SR*0.3), int(SR*1.5))
    # 鸟鸣
    for _ in range(40):
        p = random.randint(SR, n - SR)
        d = int(random.uniform(0.12, 0.35) * SR)
        audio[p:p+d] += bird_chirp(random.uniform(2500, 4500), d/SR, 0.12)
    # 风铃
    for _ in range(15):
        p = random.randint(SR, n - SR*2)
        f = random.choice([1046.5, 1318.5, 1568.0, 1760.0, 2093.0])
        d = int(random.uniform(1.5, 3.5) * SR)
        audio[p:p+d] += chime(f, d/SR, 0.06)
    # 微风
    breeze = bandpass(np.random.randn(n).astype(np.float32), 300, 2000) * 0.05
    breeze *= (0.5 + 0.3*np.sin(2*np.pi*0.03*t))
    audio += breeze
    audio = fade_io(audio, 2)
    save_mp3(audio * 0.65, "春日鸟鸣")

# ====== 3. 都市喧嚣 ======
def gen_city():
    print("[3/3] 都市喧嚣")
    n = SR * DUR
    t = np.arange(n) / SR
    audio = np.zeros(n, dtype=np.float32)
    random.seed(99)
    # 城市嗡鸣 pad
    audio += (np.sin(2*np.pi*110*t) + 0.5*np.sin(2*np.pi*164.81*t)) * 0.04 * (0.7+0.2*np.sin(2*np.pi*0.02*t))
    # 交通底噪
    audio += bandpass(np.random.randn(n).astype(np.float32), 40, 250) * 0.15
    # 节奏脉动 60BPM
    for beat in range(0, n, SR):
        pd = int(SR*0.15)
        pulse = np.sin(2*np.pi*55*t[:pd]) * np.exp(-8*np.arange(pd)/SR)
        audio[beat:beat+pd] += pulse * 0.04
    # 汽车驶过
    for _ in range(10):
        start = random.randint(0, max(1, n - SR*5))
        dur = random.randint(SR*2, SR*4)
        cn = np.random.randn(dur).astype(np.float32)
        cn = bandpass(cn, 100, 400)
        cn *= (0.35 + 0.25*np.sin(np.linspace(0, np.pi, dur))) * 0.3
        end = min(start+dur, n)
        audio[start:end] += cn[:end-start]
    # 鸣笛
    for _ in range(4):
        p = random.randint(SR, n - SR)
        d = int(SR*0.9)
        audio[p:p+d] += flute(random.choice([400,440,500]), 0.9, 0.12)
    # 人群
    crowd = bandpass(np.random.randn(n).astype(np.float32), 200, 3000) * 0.04
    crowd *= (0.6 + 0.3*np.sin(2*np.pi*0.05*t))
    audio += crowd
    audio = fade_io(audio, 2)
    save_mp3(audio * 0.6, "都市喧嚣")

if __name__ == "__main__":
    print("生成背景音乐（增强版）...")
    gen_ocean()
    gen_spring()
    gen_city()
    print("\n完成！")
    for f in sorted(os.listdir(AUDIO)):
        if f.endswith('.mp3'):
            print(f"  {f}  ({os.path.getsize(os.path.join(AUDIO,f))//1024}KB)")
