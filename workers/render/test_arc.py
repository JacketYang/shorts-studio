#!/usr/bin/env python3
"""
arc.py 自检：验证 5 个 preset 的值域、末尾平滑、climax 峰值。

可独立运行：
    python3 workers/render/test_arc.py
    python3 -m workers.render.test_arc   （在仓库根亦可）
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import arc  # noqa: E402


DURATION = 28.0
SPEC_BASE = {"format": {"duration_sec": DURATION}, "scene": {}}
SAMPLES = 2000


def make_spec(preset: str, climax: float = 0.85) -> dict:
    return {
        "format": {"duration_sec": DURATION},
        "scene": {"arc": {"preset": preset, "climax_at": climax, "hook_peek": False}},
    }


def sample_curve(spec: dict, n: int = SAMPLES):
    cfg = arc.parse_arc(spec)
    return [arc.intensity_of(cfg, DURATION * k / (n - 1)) for k in range(n)]


def check_range(name: str, vals) -> bool:
    lo, hi = min(vals), max(vals)
    ok = 0.0 <= lo and hi <= 1.0
    print(f"    值域 [{lo:.4f}, {hi:.4f}]  {'✅' if ok else '❌ 越界'}")
    return ok


def check_tail_smooth(name: str, vals) -> bool:
    """末尾 3% 内相邻采样差不应有突变。"""
    n = len(vals)
    tail_start = int((1.0 - arc.TAIL_SMOOTH) * (n - 1))
    tail = vals[tail_start:]
    if len(tail) < 3:
        print("    末尾采样不足，跳过")
        return True
    max_jump = max(abs(tail[i + 1] - tail[i]) for i in range(len(tail) - 1))
    # 单个采样步长的合理上界：0.05
    ok = max_jump <= 0.05
    print(f"    末尾 3% 最大跳变 {max_jump:.5f}  {'✅' if ok else '❌ 不平滑'}")
    return ok


# ramp 与 countdown 的公式本身不含 climax_at 概念（ramp 单调递增到结尾，
# countdown 末段固定 1.0），峰值判据只适用于显式使用 climax_at 的 preset。
CLIMAX_AWARE = {"tease-then-build", "wave", "drop"}


def check_climax_peak(name: str, vals, climax_at: float) -> bool:
    """climax_at 附近应达到曲线最大值。仅对 climax-aware 的 preset 生效。"""
    n = len(vals)
    k = int(climax_at * (n - 1))
    window = max(2, int(0.03 * n))
    lo = max(0, k - window)
    hi = min(n, k + window + 1)
    local_max = max(vals[lo:hi])
    global_max = max(vals)
    ok = local_max >= global_max - 0.02
    print(f"    climax@{climax_at:.2f} 附近峰值 {local_max:.4f} / 全局 {global_max:.4f}  "
          f"{'✅' if ok else '❌ 未在 climax 达峰'}")
    return ok


def check_preset(preset: str, climax: float = 0.85) -> bool:
    print(f"\n  [{preset}]")
    spec = make_spec(preset, climax)
    vals = sample_curve(spec)
    all_ok = True
    all_ok &= check_range(preset, vals)
    all_ok &= check_tail_smooth(preset, vals)
    if preset in CLIMAX_AWARE:
        all_ok &= check_climax_peak(preset, vals, climax)
    else:
        print(f"    climax 峰值判据不适用（{preset} 公式不含 climax_at，单调/分段递增）")
    print(f"    头/中/尾采样: {vals[0]:.3f} / {vals[len(vals)//2]:.3f} / {vals[-1]:.3f}")
    return all_ok


def check_drop_structure() -> bool:
    """drop 的静默—爆发结构。"""
    print("\n  [drop 专项：静默 → 爆发]")
    spec = make_spec("drop")
    cfg = arc.parse_arc(spec)

    pre = arc.intensity_of(cfg, DURATION * 0.30)
    silence = arc.intensity_of(cfg, DURATION * 0.375)
    burst = arc.intensity_of(cfg, DURATION * 0.45)
    ok = pre > silence and burst > 0.9
    print(f"    u=0.30 → {pre:.3f}（稀疏）")
    print(f"    u=0.375 → {silence:.3f}（静默蓄力）")
    print(f"    u=0.45 → {burst:.3f}（爆发）  {'✅' if ok else '❌'}")

    # 静默窗判定
    sil_t = DURATION * 0.375
    is_sil = arc.is_drop_silence(spec, sil_t)
    not_sil = not arc.is_drop_silence(spec, DURATION * 0.20)
    print(f"    is_drop_silence(0.375)={is_sil}, (0.20)={not_sil}  "
          f"{'✅' if is_sil and not_sil else '❌'}")
    return ok and is_sil and not_sil


def check_countdown_beats() -> bool:
    print("\n  [countdown 专项：5 段 + 节拍点]")
    spec = make_spec("countdown")
    cfg = arc.parse_arc(spec)
    levels = [arc.intensity_of(cfg, DURATION * (k / 5.0 + 0.02)) for k in range(5)]
    expected = [0.25, 0.40, 0.55, 0.75, 1.00]
    ok = all(abs(a - b) < 1e-6 for a, b in zip(levels, expected))
    print(f"    5 段强度 {[round(x,3) for x in levels]}  期望 {expected}  "
          f"{'✅' if ok else '❌'}")

    beats = arc.beat_points(spec)
    ok2 = len(beats) == 5
    print(f"    节拍点 {[round(b,2) for b in beats]}  {'✅' if ok2 else '❌'}")
    return ok and ok2


def check_hook_peek() -> bool:
    print("\n  [hook_peek：前 0.5s 高潮态，0.2s 倒带]")
    spec = make_spec("ramp")
    spec["scene"]["arc"]["hook_peek"] = True
    f0 = arc.hook_peek_factor(spec, 0.1)
    f_mid = arc.hook_peek_factor(spec, 0.55)
    f_end = arc.hook_peek_factor(spec, 0.8)
    ok = abs(f0 - 1.0) < 1e-6 and 0.0 < f_mid < 1.0 and f_end == 0.0
    print(f"    t=0.10 → {f0:.3f}（高潮态）")
    print(f"    t=0.55 → {f_mid:.3f}（倒带中）")
    print(f"    t=0.80 → {f_end:.3f}（结束）  {'✅' if ok else '❌'}")

    spec2 = make_spec("ramp")
    off = arc.hook_peek_factor(spec2, 0.1)
    ok2 = off == 0.0
    print(f"    hook_peek=false 时 t=0.10 → {off:.3f}  {'✅' if ok2 else '❌'}")
    return ok and ok2


def check_defaults() -> bool:
    print("\n  [默认值与非法输入]")
    cfg = arc.parse_arc(SPEC_BASE)
    ok = cfg.preset == "ramp" and abs(cfg.climax_at - 0.85) < 1e-9 and cfg.hook_peek is True
    print(f"    无 arc 字段 → {cfg}  {'✅' if ok else '❌'}")

    bad = {"format": {"duration_sec": 10}, "scene": {"arc": {"preset": "nonsense", "climax_at": 9.0}}}
    cfg2 = arc.parse_arc(bad)
    ok2 = cfg2.preset == "ramp" and 0.5 <= cfg2.climax_at <= 0.95
    print(f"    非法 preset/climax → {cfg2}  {'✅' if ok2 else '❌'}")

    # 各处采样都在值域内
    inrange = all(0.0 <= arc.intensity(SPEC_BASE, t) <= 1.0
                  for t in [i * 0.37 for i in range(100)])
    print(f"    未加 arc 的旧 spec 全程值域正常  {'✅' if inrange else '❌'}")
    return ok and ok2 and inrange


def check_mapping() -> bool:
    print("\n  [I → 视觉参数映射]")
    cases = [
        (0.0, 0.8, 1.00, 0.6, 1.0, 0.9, 0.7),
        (1.0, 1.4, 1.06, 1.4, 1.8, 1.1, 1.3),
    ]
    ok = True
    for i, spd, zm, pc, rot, bg, wall in cases:
        got = (arc.speed_mult(i), arc.zoom_mult(i), arc.particle_mult(i),
               arc.rotation_mult(i), arc.bg_brightness_mult(i), arc.wall_glow_mult(i))
        exp = (spd, zm, pc, rot, bg, wall)
        good = all(abs(a - b) < 1e-9 for a, b in zip(got, exp))
        ok &= good
        print(f"    I={i}: 速度{got[0]:.2f} 缩放{got[1]:.2f} 粒子{got[2]:.2f} "
              f"旋转{got[3]:.2f} 亮度{got[4]:.2f} 墙光{got[5]:.2f}  {'✅' if good else '❌'}")
    return ok


def main() -> int:
    print("=" * 68)
    print("arc.py 自检")
    print("=" * 68)

    all_ok = True
    for preset in arc.ARC_PRESETS:
        all_ok &= check_preset(preset)

    print("\n" + "-" * 68)
    all_ok &= check_drop_structure()
    all_ok &= check_countdown_beats()
    all_ok &= check_hook_peek()
    all_ok &= check_defaults()
    all_ok &= check_mapping()

    print("\n" + "=" * 68)
    print("✅ 全部通过" if all_ok else "❌ 存在失败项")
    print("=" * 68)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
