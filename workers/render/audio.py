#!/usr/bin/env python3
"""
音频合成 (T7)：numpy 向量化，立体声，5 种乐器 + 4 层声部 + SFX + 混响。

全部按"整块采样数组"运算，不用逐采样 Python 循环。
采样率 44100，输出 2 声道，最终走 ffmpeg loudnorm。

对外接口
--------
render_audio(wav_path, spec, events, duration, seed, arc_cfg) -> dict
    写出 WAV，返回统计信息（峰值、层统计等）供测试。
"""

import math
import struct
import wave
import zlib

import numpy as np

import arc as arcmod


SR = 44100
CHANNELS = 2

# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------

def midi_to_freq(midi) -> float:
    return 440.0 * (2.0 ** ((np.asarray(midi, dtype=np.float64) - 69.0) / 12.0))


def _t_array(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def _env_exp(n: int, tau: float, attack_sec: float = 0.0) -> np.ndarray:
    """指数衰减包络，可选起音斜坡。"""
    t = _t_array(n)
    env = np.exp(-t / max(1e-6, tau))
    if attack_sec > 0:
        a = max(1, int(attack_sec * SR))
        ramp = np.ones(n, dtype=np.float64)
        m = min(a, n)
        ramp[:m] = np.linspace(0.0, 1.0, m, dtype=np.float64)
        env *= ramp
    return env


def _pan_gains(pan: float) -> tuple:
    """等功率声像。pan ∈ [-0.7, 0.7]。"""
    pan = max(-0.7, min(0.7, pan))
    # 归一化到 [-1,1] 后做等功率
    theta = (pan / 0.7) * (math.pi / 4.0)
    return math.cos(theta), math.sin(theta)


def _sawtooth(freq: np.ndarray, n: int, phase0: float = 0.0) -> np.ndarray:
    """锯齿波（相位折叠，向量化）。"""
    t = _t_array(n)
    if np.isscalar(freq):
        ph = freq * t + phase0
    else:
        ph = freq * t + phase0
    return 2.0 * (ph - np.floor(ph + 0.5))


def _lowpass_1pole(x: np.ndarray, cutoff: np.ndarray) -> np.ndarray:
    """一阶低通，截止频率可随样本变化（用递推，但为 numpy 的 lfilter 近似）。

    这里用简化的分块平均近似：把信号按 cutoff 的段分成小块做加权平均，
    避免逐样本 Python 循环，同时对听感足够。
    """
    n = x.shape[0]
    if n == 0:
        return x
    # 用指数移动平均的向量化近似：卷积一个随截止频率变化的核
    # 取平均截止频率决定核长度
    c = float(np.mean(cutoff)) if not np.isscalar(cutoff) else float(cutoff)
    c = max(120.0, min(12000.0, c))
    k = max(1, int(SR / (2.0 * c)))
    if k <= 1:
        return x
    kernel = np.ones(k, dtype=np.float64) / k
    return np.convolve(x, kernel, mode="same")


# ---------------------------------------------------------------------------
# 乐器合成器（全部向量化）
# ---------------------------------------------------------------------------

def synth_marimba(freq: float, n: int, rng) -> np.ndarray:
    """基频 + 4×（衰减快 2.5 倍，0.35）+ 10×（更快，0.08）+ 6ms 噪声敲击。"""
    t = _t_array(n)
    base = np.sin(2.0 * np.pi * freq * t) * _env_exp(n, 0.18)
    h4 = 0.35 * np.sin(2.0 * np.pi * freq * 4.0 * t) * _env_exp(n, 0.18 / 2.5)
    h10 = 0.08 * np.sin(2.0 * np.pi * freq * 10.0 * t) * _env_exp(n, 0.18 / 5.0)
    out = base + h4 + h10

    # 6ms 噪声敲击
    click_n = max(1, int(0.006 * SR))
    m = min(click_n, n)
    click = rng.uniform(-1.0, 1.0, m) * np.linspace(1.0, 0.0, m)
    out[:m] += 0.25 * click
    return out


def synth_kalimba(freq: float, n: int, rng) -> np.ndarray:
    """基频 + 5.4×（0.22，衰减 0.12s）+ 0.02s 起音。"""
    t = _t_array(n)
    base = np.sin(2.0 * np.pi * freq * t) * _env_exp(n, 0.22, attack_sec=0.02)
    h = 0.22 * np.sin(2.0 * np.pi * freq * 5.4 * t) * _env_exp(n, 0.12)
    return base + h


def synth_pluck(freq: float, n: int, rng) -> np.ndarray:
    """Karplus-Strong 弹拨：延迟线长度 = SR/freq，衰减 0.996。"""
    delay = max(2, int(round(SR / max(20.0, freq))))
    if delay >= n:
        delay = max(2, n - 1)

    # 初始噪声（seed 派生）
    buf = rng.uniform(-1.0, 1.0, delay).astype(np.float64)
    pad = int(math.ceil(n / delay) + 2) * delay
    work = np.zeros(pad, dtype=np.float64)
    work[:delay] = buf

    # 向量化 KS：把输出按 delay 分块，每块 = 前一块滑窗平均 × 0.996^k
    decay = 0.996
    blocks = pad // delay
    prev = buf
    for b in range(1, blocks):
        start = b * delay
        # 前一块的两点平均（环形移位）
        shifted = np.roll(prev, 1)
        cur = 0.5 * (prev + shifted) * decay
        work[start:start + delay] = cur
        prev = cur

    return work[:n]


def synth_bell(freq: float, n: int, rng) -> np.ndarray:
    """2 算子 FM：调制比 3.5，深度 3 → 0.2 指数衰减。"""
    t = _t_array(n)
    depth = 0.2 + (3.0 - 0.2) * np.exp(-t / 0.35)
    mod = depth * np.sin(2.0 * np.pi * freq * 3.5 * t)
    carrier = np.sin(2.0 * np.pi * freq * t + mod)
    return carrier * _env_exp(n, 0.55)


def synth_synth(freq: float, n: int, rng) -> np.ndarray:
    """两个失谐锯齿（±6 音分）+ 低通（4000→900Hz）。"""
    t = _t_array(n)
    k = np.linspace(0.0, 1.0, n)
    cutoff = 4000.0 + (900.0 - 4000.0) * k
    detune = 2.0 ** (6.0 / 1200.0)
    s1 = _sawtooth(freq * detune, n)
    s2 = _sawtooth(freq / detune, n)
    mixed = 0.5 * (s1 + s2)
    filtered = _lowpass_1pole(mixed, cutoff)
    return filtered * _env_exp(n, 0.30, attack_sec=0.008)


INSTRUMENTS = {
    "marimba": (synth_marimba, 0.55),
    "kalimba": (synth_kalimba, 0.70),
    "pluck": (synth_pluck, 0.90),
    "bell": (synth_bell, 1.40),
    "synth": (synth_synth, 0.50),
}

DEFAULT_INSTRUMENT = "marimba"


# ---------------------------------------------------------------------------
# SFX
# ---------------------------------------------------------------------------

def sfx_soft_pop(rng) -> np.ndarray:
    n = int(0.060 * SR)
    t = _t_array(n)
    freq = 800.0 + (300.0 - 800.0) * (t / max(1e-6, t[-1] if n > 1 else 0.06))
    return np.sin(2.0 * np.pi * freq * t) * _env_exp(n, 0.020)


def sfx_whoosh(rng) -> np.ndarray:
    """0.4s 带通噪声，中心 500→3000Hz 上扫。"""
    n = int(0.40 * SR)
    noise = rng.uniform(-1.0, 1.0, n)
    k = np.linspace(0.0, 1.0, n)
    center = 500.0 + (3000.0 - 500.0) * k
    # 分段带通：用多个频段的加权叠加近似扫频
    out = np.zeros(n, dtype=np.float64)
    for f in (500.0, 900.0, 1500.0, 2200.0, 3000.0):
        w = np.exp(-((center - f) / 600.0) ** 2)
        band = _lowpass_1pole(noise, np.full(n, f * 1.6)) - _lowpass_1pole(noise, np.full(n, f * 0.6))
        out += band * w
    return out * _env_exp(n, 0.18)


def sfx_riser(rng) -> np.ndarray:
    """2s 噪声 + 上升正弦，线性渐强。"""
    n = int(2.0 * SR)
    t = _t_array(n)
    k = t / max(1e-6, t[-1] if n > 1 else 2.0)
    noise = rng.uniform(-1.0, 1.0, n) * 0.5
    sweep = np.sin(2.0 * np.pi * (200.0 + 1400.0 * k ** 2) * t)
    ramp = np.linspace(0.0, 1.0, n) ** 1.4
    return (noise + sweep) * ramp


def sfx_impact(rng) -> np.ndarray:
    """120ms 低频正弦 70Hz + 噪声爆破。"""
    n = int(0.120 * SR)
    t = _t_array(n)
    low = np.sin(2.0 * np.pi * 70.0 * t) * _env_exp(n, 0.045)
    burst_n = max(1, int(0.030 * SR))
    m = min(burst_n, n)
    burst = np.zeros(n, dtype=np.float64)
    burst[:m] = rng.uniform(-1.0, 1.0, m) * np.linspace(1.0, 0.0, m)
    return low + 0.6 * burst


def sfx_tick(rng) -> np.ndarray:
    """15ms 方波 2kHz。"""
    n = int(0.015 * SR)
    t = _t_array(n)
    sq = np.sign(np.sin(2.0 * np.pi * 2000.0 * t))
    return sq * _env_exp(n, 0.006)


SFX_BUILDERS = {
    "soft-pop": sfx_soft_pop,
    "whoosh": sfx_whoosh,
    "riser": sfx_riser,
    "impact": sfx_impact,
    "tick": sfx_tick,
}


# ---------------------------------------------------------------------------
# 音符渲染到总线
# ---------------------------------------------------------------------------

def _add_note(bus: np.ndarray, start_sec: float, wave_data: np.ndarray,
              gain: float, pan: float = 0.0) -> None:
    """把单声道波形以等功率声像混入立体声总线。"""
    n_total = bus.shape[0]
    start = int(round(start_sec * SR))
    if start >= n_total:
        return
    if start < 0:
        wave_data = wave_data[-start:]
        start = 0
    m = min(len(wave_data), n_total - start)
    if m <= 0:
        return

    gl, gr = _pan_gains(pan)
    seg = wave_data[:m] * gain
    bus[start:start + m, 0] += seg * gl
    bus[start:start + m, 1] += seg * gr


def _render_note(bus, t_sec, midi, intensity, instrument, pan, dur=None, vel=None):
    builder, length = INSTRUMENTS.get(instrument, INSTRUMENTS[DEFAULT_INSTRUMENT])
    freq = float(midi_to_freq(midi))

    # T8：dur 控制音符长度，上限为乐器自身总长
    note_len = length
    if dur is not None:
        try:
            note_len = min(length, max(0.05, float(dur)))
        except (TypeError, ValueError):
            note_len = length
    n = int(note_len * SR)
    if n <= 0:
        return

    # 稳定哈希：Python 的 hash() 对字符串受 PYTHONHASHSEED 随机化影响，
    # 会让同一 payload 两次渲染出不同音频。改用 zlib.crc32。
    _key = f"{instrument}|{round(t_sec, 3)}|{int(midi)}".encode("utf-8")
    rng = np.random.default_rng(zlib.crc32(_key) % (2 ** 32))
    wav = builder(freq, n, rng)

    # intensity 线性映射到 0.35–1.0
    amp = 0.35 + (1.0 - 0.35) * max(0.0, min(1.0, float(intensity)))
    # vel（0–127）作为额外力度微调（±15%）
    if vel is not None:
        try:
            amp *= 0.85 + 0.30 * max(0.0, min(1.0, float(vel) / 127.0))
        except (TypeError, ValueError):
            pass
    _add_note(bus, t_sec, wav, amp * 0.22, pan)


# ---------------------------------------------------------------------------
# 层 2/3/4
# ---------------------------------------------------------------------------

def _bar_beat_times(tempo_bpm: float, duration: float) -> tuple:
    """按 4/4 返回 (每拍时长, 拍时刻列表)。"""
    beat = 60.0 / max(20.0, tempo_bpm)
    n_beats = int(math.ceil(duration / beat))
    return beat, [i * beat for i in range(n_beats)]


def _layer_gain(t: float, i_val: float, threshold: float) -> float:
    """层的进出用 0.25 秒淡入淡出。返回该层在 t 时刻的增益 0–1。"""
    if i_val < threshold:
        return 0.0
    # 用 I 超出阈值的程度做淡入，避免硬切（0.25s 由调用方按音符时间粒度近似）
    over = (i_val - threshold) / max(1e-6, 1.0 - threshold)
    return max(0.0, min(1.0, over * 4.0))


def _add_bass_layer(bus, events, spec_audio, arc_cfg, duration, seed):
    """层 2：每小节第一拍弹主音低八度，正弦，0.9 拍，音量 0.5。"""
    tempo = float(spec_audio.get("tempo_bpm", 96))
    beat, beats = _bar_beat_times(tempo, duration)
    if not events:
        return 0
    count = 0
    for bt in beats:
        if abs((bt / beat) % 4.0) > 1e-6:
            continue
        i_val = arcmod.intensity_of(arc_cfg, bt)
        g = _layer_gain(bt, i_val, 0.35)
        if g <= 0:
            continue
        # 取该时刻附近最近的旋律音
        near = min(events, key=lambda e: abs(e["t"] - bt))
        root_midi = int(near["midi"]) - 12
        n = int(0.9 * beat * SR)
        if n <= 0:
            continue
        t = _t_array(n)
        wav = np.sin(2.0 * np.pi * float(midi_to_freq(root_midi)) * t) * _env_exp(n, 0.35, 0.01)
        _add_note(bus, bt, wav, 0.5 * g * 0.30, 0.0)
        count += 1
    return count


def _add_rhythm_layer(bus, spec_audio, arc_cfg, duration, seed):
    """层 3：每八分音符一个短"嗒"，重拍 0.2；第 1、3 拍柔和底鼓。"""
    tempo = float(spec_audio.get("tempo_bpm", 96))
    beat = 60.0 / max(20.0, tempo)
    eighth = beat / 2.0
    rng = np.random.default_rng(seed % (2 ** 32))
    count = 0

    n_tick = int(0.030 * SR)
    k = np.arange(n_tick, dtype=np.float64)
    tick_raw = rng.uniform(-1.0, 1.0, n_tick)
    # 高通：减去低频版本
    tick_hp = tick_raw - _lowpass_1pole(tick_raw, np.full(n_tick, 3000.0))
    tick_env = np.exp(-k / (0.006 * SR))

    t = 0.0
    idx = 0
    while t < duration:
        i_val = arcmod.intensity_of(arc_cfg, t)
        g = _layer_gain(t, i_val, 0.6)
        if g > 0:
            is_downbeat = (idx % 2 == 0) and (abs((idx / 2) % 4.0) < 1e-6)
            amp = (0.2 if (idx % 2 == 0 and abs((idx / 2) % 2.0) < 1e-6) else 0.12) * g
            _add_note(bus, t, tick_hp * tick_env, amp, 0.0)
            count += 1
        t += eighth
        idx += 1

    # 底鼓：第 1、3 拍
    for bi, bt in enumerate([i * beat for i in range(int(math.ceil(duration / beat)))]):
        if abs((bt / beat) % 4.0) > 1e-6 and abs((bt / beat) % 4.0 - 2.0) > 1e-6:
            continue
        i_val = arcmod.intensity_of(arc_cfg, bt)
        g = _layer_gain(bt, i_val, 0.6)
        if g <= 0:
            continue
        n = int(0.080 * SR)
        tt = _t_array(n)
        f = 110.0 + (45.0 - 110.0) * (tt / max(1e-6, tt[-1] if n > 1 else 0.08))
        kick = np.sin(2.0 * np.pi * f * tt) * _env_exp(n, 0.030)
        _add_note(bus, bt, kick, 0.30 * g, 0.0)
        count += 1
    return count


def _add_thicken_layer(bus, events, arc_cfg, duration):
    """层 4：主旋律每音叠加高八度、音量 0.4。"""
    count = 0
    for ev in events:
        t = ev["t"]
        i_val = arcmod.intensity_of(arc_cfg, t)
        g = _layer_gain(t, i_val, 0.85)
        if g <= 0:
            continue
        midi = int(ev["midi"]) + 12
        n = int(0.55 * SR)
        tt = _t_array(n)
        wav = np.sin(2.0 * np.pi * float(midi_to_freq(midi)) * tt) * _env_exp(n, 0.18)
        _add_note(bus, t, wav, 0.4 * g * 0.22, 0.0)
        count += 1
    return count


# ---------------------------------------------------------------------------
# SFX 调度
# ---------------------------------------------------------------------------

def _collect_sfx(spec: dict, duration: float, arc_cfg, events: list) -> list:
    """收集 spec.audio.sfx、timeline sfx、以及 arc 自动音效。

    返回 [(t, name, gain), ...]
    """
    out = []

    audio = spec.get("audio") or {}
    for item in (audio.get("sfx") or []):
        if not isinstance(item, dict):
            continue
        name = item.get("sound")
        if name not in SFX_BUILDERS:
            continue
        # 绑定到同名事件的首个时刻；没有则放在 0.05s
        ev_name = item.get("event")
        t = 0.05
        matching = [e for e in events if e.get("name") == ev_name]
        if matching:
            t = matching[0]["t"]
        else:
            # 常见绑定：ball_split 对应分裂事件（强度接近 1.0）
            strong = [e for e in events if float(e.get("intensity", 0)) >= 0.95]
            if strong:
                t = strong[0]["t"]
        gain_db = float(item.get("gain_db", -14))
        out.append((max(0.0, t), name, 10.0 ** (gain_db / 20.0)))

    for item in (spec.get("timeline") or []):
        if not isinstance(item, dict) or item.get("type") != "sfx":
            continue
        name = item.get("sound")
        if name not in SFX_BUILDERS:
            continue
        t_raw = float(item.get("t", 0.0))
        t = duration + t_raw if t_raw < 0 else t_raw
        gain_db = float(item.get("gain_db", -12))
        out.append((max(0.0, t), name, 10.0 ** (gain_db / 20.0)))

    # --- arc 自动音效 ---
    preset = arc_cfg.preset
    if preset == "drop":
        burst_u = 0.40
        burst_t = duration * burst_u
        out.append((max(0.0, burst_t - 1.0), "riser", 0.45))
        out.append((burst_t, "impact", 0.85))
    elif preset == "countdown":
        for bt in arcmod.beat_points(spec):
            out.append((bt, "tick", 0.5))

    # hook_peek 的倒带过渡处 whoosh
    if arc_cfg.hook_peek:
        out.append((arcmod.HOOK_PEEK_SEC, "whoosh", 0.35))

    return out


# ---------------------------------------------------------------------------
# 混响
# ---------------------------------------------------------------------------

def _make_ir(seed: int, length_sec: float = 1.2) -> np.ndarray:
    """指数衰减噪声脉冲响应（seed 派生）。"""
    n = int(length_sec * SR)
    rng = np.random.default_rng(seed % (2 ** 32))
    noise = rng.uniform(-1.0, 1.0, n)
    env = np.exp(-np.arange(n, dtype=np.float64) / (0.30 * SR))
    return noise * env


def _fft_convolve(x: np.ndarray, h: np.ndarray) -> np.ndarray:
    n = len(x) + len(h) - 1
    nfft = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, nfft)
    H = np.fft.rfft(h, nfft)
    y = np.fft.irfft(X * H, nfft)[:len(x)]
    return y


def _highpass_200(x: np.ndarray) -> np.ndarray:
    return x - _lowpass_1pole(x, np.full(x.shape[0], 200.0))


def _apply_reverb(bus: np.ndarray, reverb: float, seed: int) -> np.ndarray:
    if reverb <= 0.0:
        return bus
    ir = _make_ir(seed)
    wet_ratio = reverb * 0.35
    out = np.empty_like(bus)
    for ch in range(bus.shape[1]):
        wet = _fft_convolve(bus[:, ch], ir)
        wet = _highpass_200(wet)
        # 归一化湿声，避免爆音
        peak = float(np.max(np.abs(wet))) or 1.0
        wet = wet / peak * 0.5
        out[:, ch] = bus[:, ch] + wet * wet_ratio
    return out


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def render_audio(wav_path: str, spec: dict, events: list, duration: float,
                 seed: int = 1, arc_cfg=None, loop_mode: str = "none") -> dict:
    """生成整段音频并写 WAV，返回统计信息。

    loop_mode 由 arc.parse_loop(spec).effective() 给出，决定结尾处理方式。
    """
    audio = spec.get("audio") or {}
    mode = audio.get("mode", "sim-driven")
    music = audio.get("music") or {}

    total = int(round(duration * SR))
    if total <= 0:
        total = 1
    bus = np.zeros((total, CHANNELS), dtype=np.float64)

    stats = {"layers": {}, "sfx": 0, "events": 0, "mode": mode}

    if arc_cfg is None:
        arc_cfg = arcmod.parse_arc(spec)

    # ---- audio.mode == none → 静音 ----
    if mode == "none":
        _write_wav(wav_path, bus)
        stats["peak"] = 0.0
        return stats

    instrument = music.get("instrument", DEFAULT_INSTRUMENT)
    if instrument not in INSTRUMENTS:
        instrument = DEFAULT_INSTRUMENT

    # ---- 层 1：主旋律 ----
    W_hint = 1080.0
    for ev in events:
        midi = ev.get("midi")
        if midi is None:
            continue
        x = float(ev.get("x", W_hint * 0.5))
        pan = (x / W_hint - 0.5) * 1.2
        _render_note(bus, ev["t"], int(midi), float(ev.get("intensity", 0.85)),
                     instrument, pan, dur=ev.get("dur"), vel=ev.get("vel"))
        stats["events"] += 1

    # ---- 层 2/3/4 ----
    stats["layers"]["bass"] = _add_bass_layer(bus, events, music, arc_cfg, duration, seed)
    stats["layers"]["rhythm"] = _add_rhythm_layer(bus, music, arc_cfg, duration, seed)
    stats["layers"]["thicken"] = _add_thicken_layer(bus, events, arc_cfg, duration)

    # ---- 首个声音 0.3 秒内必须出现 ----
    first_t = min((e["t"] for e in events), default=1e9)
    if first_t > 0.3:
        _, _ = None, None
        rng = np.random.default_rng(seed % (2 ** 32))
        _add_note(bus, 0.05, sfx_soft_pop(rng), 0.55, 0.0)
        stats["early_pop"] = True
    else:
        stats["early_pop"] = False

    # ---- SFX ----
    sfx_list = _collect_sfx(spec, duration, arc_cfg, events)
    for (t, name, gain) in sfx_list:
        rng = np.random.default_rng(int(t * 1000) % (2 ** 32))
        _add_note(bus, t, SFX_BUILDERS[name](rng), gain, 0.0)
        stats["sfx"] += 1

    # ---- 混响 ----
    reverb = float(music.get("reverb", 0.0) or 0.0)
    reverb = max(0.0, min(1.0, reverb))
    if reverb > 0:
        bus = _apply_reverb(bus, reverb, seed)

    # ---- 软削波（tanh），峰值 ≤ 0.98 ----
    # 先按峰值归一化到 0.9 再 tanh，保证不削顶又不至于过小
    peak = float(np.max(np.abs(bus))) if bus.size else 0.0
    if peak > 0:
        bus = bus / peak * 1.15
    bus = np.tanh(bus)
    peak2 = float(np.max(np.abs(bus))) if bus.size else 0.0
    if peak2 > 0.98:
        bus = bus / peak2 * 0.98

    # ---- T9：结尾处理 ----
    bus = _apply_ending(bus, spec, duration, loop_mode, arc_cfg, events)

    # ---- 统一 30ms 淡出，杜绝尾部爆音 ----
    n_fade = int(arcmod.MASTER_FADE_SEC * SR)
    if n_fade > 0 and bus.shape[0] > n_fade:
        ramp = np.linspace(1.0, 0.0, n_fade, dtype=np.float64)[:, None]
        bus[-n_fade:] *= ramp

    stats["peak"] = float(np.max(np.abs(bus))) if bus.size else 0.0
    _write_wav(wav_path, bus)
    return stats


# ---------------------------------------------------------------------------
# T9：结尾处理
# ---------------------------------------------------------------------------

def _apply_ending(bus: np.ndarray, spec: dict, duration: float, loop_mode: str,
                  arc_cfg, events: list) -> np.ndarray:
    """按 loop_mode 处理结尾，保证"不硬切、不爆音"。

    - visual-return：声音不做特殊处理（画面回环，音频自然结束）
    - audio-return ：最后 1 秒把主旋律以外的层退掉，最后一个音的尾音
                      在结束前 0.3 秒淡出
    - reveal       ：最后 2 秒强度拉到 1.0（音频侧提高整体存在感）
    - cut          ：结束前 0.08 秒快速淡出
    """
    n = bus.shape[0]
    if n == 0:
        return bus
    t_axis = np.arange(n, dtype=np.float64) / SR

    if loop_mode == "audio-return":
        # 尾音淡出：结束前 0.3 秒
        left = duration - t_axis
        fade = np.clip(left / arcmod.TAIL_DECAY_SEC, 0.0, 1.0)
        bus = bus * fade[:, None]
        # 最后 1 秒整体轻微收敛（声部退层在合成阶段已按 I 处理，
        # 这里再叠一层整体收束，让结尾与开头的密度相当）
        layer = np.clip((left / arcmod.AUDIO_RETURN_SEC), 0.0, 1.0)
        layer = 0.45 + 0.55 * layer
        bus = bus * layer[:, None]

    elif loop_mode == "cut":
        left = duration - t_axis
        fade = np.clip(left / arcmod.CUT_FADE_SEC, 0.0, 1.0)
        bus = bus * fade[:, None]

    elif loop_mode == "reveal":
        # 最后 2 秒提一点整体能量（配合画面的闪白）
        left = duration - t_axis
        k = np.clip(1.0 - left / arcmod.REVEAL_SEC, 0.0, 1.0)
        boost = 1.0 + 0.25 * k
        bus = bus * boost[:, None]

    return bus


def _write_wav(path: str, bus: np.ndarray) -> None:
    """写 16bit 立体声 WAV。"""
    clipped = np.clip(bus, -1.0, 1.0)
    int16 = (clipped * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(int16.tobytes())
