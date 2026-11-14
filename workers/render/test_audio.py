#!/usr/bin/env python3
"""
audio.py 自检：声道数、时长、NaN、峰值、层启停、SFX 覆盖。

运行：
    python3 workers/render/test_audio.py
"""

import math
import os
import sys
import tempfile
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import arc  # noqa: E402
import audio  # noqa: E402


DURATION = 6.0
SEED = 424242


def make_spec(**over) -> dict:
    spec = {
        "format": {"duration_sec": DURATION, "fps": 30},
        "scene": {
            "seed": SEED,
            "arc": {"preset": "ramp", "climax_at": 0.85, "hook_peek": False},
        },
        "audio": {
            "mode": "sim-driven",
            "music": {
                "instrument": "marimba",
                "transpose": 0,
                "tempo_bpm": 96,
                "reverb": 0.15,
            },
            "sfx": [{"event": "ball_split", "sound": "soft-pop", "gain_db": -14}],
            "mix": {"target_lufs": -14, "true_peak_db": -1},
        },
        "timeline": [],
    }
    for k, v in over.items():
        if k == "instrument":
            spec["audio"]["music"]["instrument"] = v
        elif k == "reverb":
            spec["audio"]["music"]["reverb"] = v
        elif k == "mode":
            spec["audio"]["mode"] = v
        elif k == "preset":
            spec["scene"]["arc"]["preset"] = v
        elif k == "no_arc":
            spec["scene"].pop("arc", None)
    return spec


def make_events(n=40, start=0.02) -> list:
    """模拟物理事件：均匀分布，带 intensity 与 x。"""
    rng = np.random.default_rng(7)
    evs = []
    for i in range(n):
        t = start + i * (DURATION - start) / n
        evs.append({
            "t": t,
            "midi": int(rng.integers(55, 78)),
            "intensity": float(rng.uniform(0.5, 1.0)),
            "x": float(rng.uniform(100, 980)),
        })
    return evs


def read_wav(path: str):
    with wave.open(path, "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        frames = wf.getnframes()
        data = np.frombuffer(wf.readframes(frames), dtype=np.int16)
    return nch, sw, sr, frames, data


def check_basic(name: str, spec: dict, events: list, expect_mute=False) -> bool:
    print(f"\n  [{name}]")
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec, events, DURATION,
                                   seed=SEED, arc_cfg=arc.parse_arc(spec))
        nch, sw, sr, frames, data = read_wav(path)

        ok = True
        # 2 声道
        c1 = nch == 2
        print(f"    声道数 {nch}  {'✅' if c1 else '❌'}")
        ok &= c1

        # 采样率
        c2 = sr == 44100
        print(f"    采样率 {sr}  {'✅' if c2 else '❌'}")
        ok &= c2

        # 长度 == duration
        expect = int(round(DURATION * 44100))
        c3 = frames == expect
        print(f"    帧数 {frames} / 期望 {expect}  {'✅' if c3 else '❌'}")
        ok &= c3

        # 无 NaN
        c4 = not np.isnan(data).any()
        print(f"    无 NaN  {'✅' if c4 else '❌'}")
        ok &= c4

        # 峰值 ≤ 0.98
        peak = float(np.max(np.abs(data)) / 32767.0) if data.size else 0.0
        c5 = peak <= 0.98
        print(f"    峰值 {peak:.4f} ≤ 0.98  {'✅' if c5 else '❌'}")
        ok &= c5

        if expect_mute:
            c6 = peak < 0.001
            print(f"    mode=none 静音  {'✅' if c6 else '❌'}")
            ok &= c6
        else:
            c6 = peak > 0.01
            print(f"    有实际声音  {'✅' if c6 else '❌'}")
            ok &= c6

        return ok


def check_instruments() -> bool:
    print("\n  [5 种乐器 + 未知回落]")
    ok = True
    evs = make_events(20)
    for inst in ("marimba", "kalimba", "pluck", "bell", "synth", "unknown_inst"):
        spec = make_spec(instrument=inst, reverb=0.0)
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "a.wav")
            audio.render_audio(path, spec, evs, DURATION, SEED, arc.parse_arc(spec))
            _, _, _, _, data = read_wav(path)
            peak = float(np.max(np.abs(data)) / 32767.0) if data.size else 0.0
            good = 0.005 < peak <= 0.98
            print(f"    {inst:<14} 峰值 {peak:.4f}  {'✅' if good else '❌'}")
            ok &= good
    return ok


def check_layers() -> bool:
    print("\n  [层启停随 I 变化]")
    evs = make_events(60)

    # ramp 的 I 从 0.25 升到 1.0，层 2/3/4 应逐步加入
    spec_low = make_spec()
    spec_low["scene"]["arc"] = {"preset": "countdown", "climax_at": 0.85, "hook_peek": False}
    stats = None
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec_low, evs, DURATION, SEED,
                                   arc.parse_arc(spec_low))
    layers = stats["layers"]
    print(f"    countdown 层统计: {layers}")
    ok = True
    for name in ("bass", "rhythm", "thicken"):
        good = layers.get(name, 0) > 0
        print(f"    层 {name:<8} 音符数 {layers.get(name,0):>3}  {'✅' if good else '❌'}")
        ok &= good
    return ok


def check_sfx_names() -> bool:
    print("\n  [5 个内置 SFX]")
    ok = True
    for nm in ("soft-pop", "whoosh", "riser", "impact", "tick"):
        spec = make_spec()
        spec["audio"]["sfx"] = [{"event": "x", "sound": nm, "gain_db": -6}]
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "a.wav")
            stats = audio.render_audio(path, spec, make_events(5), DURATION, SEED,
                                       arc.parse_arc(spec))
            good = stats["sfx"] >= 1
            print(f"    {nm:<10} 已调度 {stats['sfx']} 个  {'✅' if good else '❌'}")
            ok &= good

    # 未知 SFX 应被忽略
    spec = make_spec()
    spec["audio"]["sfx"] = [{"event": "x", "sound": "no_such_sfx", "gain_db": -6}]
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec, make_events(5), DURATION, SEED,
                                   arc.parse_arc(spec))
        good = stats["sfx"] == 0
        print(f"    未知名字被忽略  {'✅' if good else '❌'}")
        ok &= good
    return ok


def check_early_sound() -> bool:
    print("\n  [首个声音 0.3 秒内必须出现]")
    ok = True
    # 事件从 1.5s 才开始 → 应自动补 soft-pop
    late = [{"t": 1.5, "midi": 60, "intensity": 1.0, "x": 540}]
    spec = make_spec()
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec, late, 3.0, SEED, arc.parse_arc(spec))
        good = stats.get("early_pop") is True
        print(f"    事件晚于 0.3s → 补 soft-pop  {'✅' if good else '❌'}")
        ok &= good

    early = [{"t": 0.05, "midi": 60, "intensity": 1.0, "x": 540}]
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec, early, 3.0, SEED, arc.parse_arc(spec))
        good = stats.get("early_pop") is False
        print(f"    事件早于 0.3s → 不补  {'✅' if good else '❌'}")
        ok &= good
    return ok


def check_reverb() -> bool:
    print("\n  [混响]")
    evs = make_events(20)
    peaks = {}
    for rev in (0.0, 0.8):
        spec = make_spec(reverb=rev)
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "a.wav")
            audio.render_audio(path, spec, evs, DURATION, SEED, arc.parse_arc(spec))
            _, _, _, _, data = read_wav(path)
            peaks[rev] = float(np.max(np.abs(data)) / 32767.0)
    ok = peaks[0.0] > 0.01 and peaks[0.8] > 0.01
    print(f"    reverb=0.0 峰值 {peaks[0.0]:.4f}  {'✅' if ok else '❌'}")
    print(f"    reverb=0.8 峰值 {peaks[0.8]:.4f}  {'✅' if ok else '❌'}")
    return ok


def check_arc_sfx() -> bool:
    print("\n  [arc 自动音效]")
    ok = True
    # drop → riser + impact
    spec = make_spec(preset="drop")
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec, make_events(10), 10.0, SEED,
                                   arc.parse_arc(spec))
        good = stats["sfx"] >= 2
        print(f"    drop 自动加 riser+impact → {stats['sfx']} 个 SFX  {'✅' if good else '❌'}")
        ok &= good

    # countdown → 每段 tick
    spec = make_spec(preset="countdown")
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec, make_events(10), 10.0, SEED,
                                   arc.parse_arc(spec))
        good = stats["sfx"] >= 5
        print(f"    countdown 加 5 个 tick → {stats['sfx']} 个 SFX  {'✅' if good else '❌'}")
        ok &= good

    # hook_peek → whoosh
    spec = make_spec()
    spec["scene"]["arc"]["hook_peek"] = True
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "a.wav")
        stats = audio.render_audio(path, spec, make_events(10), 6.0, SEED,
                                   arc.parse_arc(spec))
        good = stats["sfx"] >= 1
        print(f"    hook_peek 加 whoosh → {stats['sfx']} 个 SFX  {'✅' if good else '❌'}")
        ok &= good
    return ok


def check_transpose() -> bool:
    print("\n  [transpose 影响音高]")
    evs = [{"t": 0.1, "midi": 60, "intensity": 1.0, "x": 540}]
    freqs = {}
    for tr in (0, 12):
        spec = make_spec(reverb=0.0)
        spec["audio"]["music"]["transpose"] = tr
        # transpose 由渲染器加到 midi 上；这里手动模拟
        shifted = [{"t": e["t"], "midi": e["midi"] + tr,
                    "intensity": e["intensity"], "x": e["x"]} for e in evs]
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "a.wav")
            audio.render_audio(path, spec, shifted, 1.0, SEED, arc.parse_arc(spec))
            _, _, _, _, data = read_wav(path)
            stereo = data.reshape(-1, 2).mean(axis=1)
            spec_ = np.abs(np.fft.rfft(stereo))
            freqs[tr] = float(np.argmax(spec_)) * 44100 / len(stereo)
    ok = freqs[12] > freqs[0] * 1.8
    print(f"    transpose=0  主频 {freqs[0]:.1f} Hz")
    print(f"    transpose=12 主频 {freqs[12]:.1f} Hz  {'✅' if ok else '❌'}")
    return ok


def main() -> int:
    print("=" * 70)
    print("audio.py 自检")
    print("=" * 70)

    all_ok = True
    all_ok &= check_basic("标准 marimba", make_spec(), make_events())
    all_ok &= check_basic("mode=none 静音", make_spec(mode="none"), make_events(), expect_mute=True)
    all_ok &= check_basic("无 arc（默认 ramp）", make_spec(no_arc=True), make_events())
    all_ok &= check_instruments()
    all_ok &= check_layers()
    all_ok &= check_sfx_names()
    all_ok &= check_early_sound()
    all_ok &= check_reverb()
    all_ok &= check_arc_sfx()
    all_ok &= check_transpose()

    print("\n" + "=" * 70)
    print("✅ 全部通过" if all_ok else "❌ 存在失败项")
    print("=" * 70)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
