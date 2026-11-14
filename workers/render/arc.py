#!/usr/bin/env python3
"""
强度曲线 (T5)：为每条视频提供 I(t) ∈ [0,1]，让成片有铺垫、升级、高潮、收尾。

对外接口
--------
intensity(spec, t) -> float          # 纯函数，无副作用，可被 T7 音频复用
parse_arc(spec) -> ArcConfig         # 解析 scene.arc
hook_peek_factor(spec, t) -> float   # 前 0.5 秒的"高潮预告"强度
is_drop_silence(spec, t) -> bool     # drop preset 的蓄力静默窗
beat_points(spec) -> list[float]     # countdown 的节拍点时刻

所有 preset 在末尾 3% 内平滑过渡（smoothstep），避免硬切。
"""

import math


ARC_PRESETS = ("ramp", "tease-then-build", "wave", "countdown", "drop")
DEFAULT_PRESET = "ramp"
DEFAULT_CLIMAX = 0.85
DEFAULT_HOOK_PEEK = True

# 末尾平滑过渡窗口（相对时长）
TAIL_SMOOTH = 0.03


class ArcConfig:
    __slots__ = ("preset", "climax_at", "hook_peek", "duration")

    def __init__(self, preset: str, climax_at: float, hook_peek: bool, duration: float):
        self.preset = preset
        self.climax_at = climax_at
        self.hook_peek = hook_peek
        self.duration = duration

    def __repr__(self):
        return (f"ArcConfig(preset={self.preset!r}, climax_at={self.climax_at}, "
                f"hook_peek={self.hook_peek}, duration={self.duration})")


def parse_arc(spec: dict) -> ArcConfig:
    """从 spec.scene.arc 解析；缺字段用默认值，非法 preset 回落 ramp。"""
    scene = spec.get("scene") or {}
    raw = scene.get("arc")
    raw = raw if isinstance(raw, dict) else {}

    preset = raw.get("preset", DEFAULT_PRESET)
    if preset not in ARC_PRESETS:
        preset = DEFAULT_PRESET

    climax = raw.get("climax_at", DEFAULT_CLIMAX)
    if not isinstance(climax, (int, float)) or isinstance(climax, bool):
        climax = DEFAULT_CLIMAX
    climax = max(0.5, min(0.95, float(climax)))

    hook_peek = raw.get("hook_peek", DEFAULT_HOOK_PEEK)
    if not isinstance(hook_peek, bool):
        hook_peek = DEFAULT_HOOK_PEEK

    fmt = spec.get("format") or {}
    duration = float(fmt.get("duration_sec") or 28.0)
    duration = max(0.1, duration)

    return ArcConfig(preset, climax, hook_peek, duration)


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

def _smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _tail_smooth(u: float, target: float, raw: float) -> float:
    """在末尾 TAIL_SMOOTH 窗口内把 raw 平滑过渡到 target。"""
    start = 1.0 - TAIL_SMOOTH
    if u <= start:
        return raw
    k = (u - start) / TAIL_SMOOTH
    return raw + (target - raw) * _smoothstep(k)


# ---------------------------------------------------------------------------
# 各 preset 的原始曲线（不含末尾过渡）
# ---------------------------------------------------------------------------

def _ramp(u: float, cfg: ArcConfig) -> float:
    return 0.25 + 0.75 * (u ** 1.6)


def _tease_then_build(u: float, cfg: ArcConfig) -> float:
    if u < 0.05:
        return 0.9
    if u < 0.15:
        # 0.9 → 0.2 线性下降
        k = (u - 0.05) / 0.10
        return 0.9 + (0.2 - 0.9) * k
    # 0.2 起按 1.4 次方升到 climax_at 处的 1.0
    span = max(0.05, cfg.climax_at - 0.15)
    k = min(1.0, (u - 0.15) / span)
    return 0.2 + 0.8 * (k ** 1.4)


def _wave(u: float, cfg: ArcConfig) -> float:
    """三个正弦叠加，波峰 0.6/0.6/1.0，波谷不低于 0.2，最后波峰在 climax_at。"""
    # 以 climax_at 为第三个波峰，反推基础周期
    # 波峰出现在 sin=1 处；用 2.5 个周期的结构铺满全片
    phase = u / max(0.05, cfg.climax_at) * math.pi * 5.0
    w1 = 0.6 * (0.5 + 0.5 * math.sin(phase))
    w2 = 0.6 * (0.5 + 0.5 * math.sin(phase * 1.7 + 1.1))
    w3 = 1.0 * (0.5 + 0.5 * math.sin(phase * 0.62 - math.pi / 2))
    raw = (w1 + w2 + w3) / 3.0
    # 归一到 [0.2, 1.0] 并保证 climax_at 处取到峰值
    val = 0.2 + 0.8 * raw
    if u >= cfg.climax_at * 0.985:
        # climax 附近强制贴近 1.0
        val = max(val, 0.97)
    return _clamp01(val)


def _countdown(u: float, cfg: ArcConfig) -> float:
    """5 等分，强度 0.25/0.4/0.55/0.75/1.0。"""
    levels = (0.25, 0.40, 0.55, 0.75, 1.00)
    idx = min(4, int(u * 5))
    return levels[idx]


def _drop(u: float, cfg: ArcConfig) -> float:
    if u < 0.35:
        return 0.3
    if u < 0.40:
        return 0.1            # 静默蓄力
    if u < 0.90:
        return 1.0            # 爆发后保持
    # 最后 10% 降到 0.4
    k = (u - 0.90) / 0.10
    return 1.0 + (0.4 - 1.0) * k


_RAW = {
    "ramp": _ramp,
    "tease-then-build": _tease_then_build,
    "wave": _wave,
    "countdown": _countdown,
    "drop": _drop,
}

# 各 preset 末尾要过渡到的目标值
_TAIL_TARGET = {
    "ramp": 1.0,
    "tease-then-build": 0.5,
    "wave": 0.35,
    "countdown": 1.0,
    "drop": 0.4,
}


# ---------------------------------------------------------------------------
# 主接口
# ---------------------------------------------------------------------------

def intensity(spec: dict, t: float) -> float:
    """返回时刻 t 的强度 I ∈ [0,1]。纯函数。"""
    cfg = parse_arc(spec)
    if cfg.duration <= 0:
        return 0.5
    u = max(0.0, min(1.0, t / cfg.duration))

    raw = _RAW[cfg.preset](u, cfg)
    raw = _clamp01(raw)

    # 末尾 3% 平滑
    out = _tail_smooth(u, _TAIL_TARGET[cfg.preset], raw)
    return _clamp01(out)


def intensity_of(cfg: ArcConfig, t: float) -> float:
    """同 intensity()，但复用已解析的 cfg，避免渲染循环里反复解析。"""
    if cfg.duration <= 0:
        return 0.5
    u = max(0.0, min(1.0, t / cfg.duration))
    raw = _clamp01(_RAW[cfg.preset](u, cfg))
    return _clamp01(_tail_smooth(u, _TAIL_TARGET[cfg.preset], raw))


# ---------------------------------------------------------------------------
# hook_peek
# ---------------------------------------------------------------------------

HOOK_PEEK_SEC = 0.5
REWIND_SEC = 0.2


def hook_peek_factor(spec: dict, t: float) -> float:
    """前 0.5 秒返回 1.0（按高潮态呈现），之后 0.2 秒倒带过渡回 0.0。"""
    cfg = parse_arc(spec)
    if not cfg.hook_peek:
        return 0.0
    if t < HOOK_PEEK_SEC:
        return 1.0
    if t < HOOK_PEEK_SEC + REWIND_SEC:
        k = (t - HOOK_PEEK_SEC) / REWIND_SEC
        return 1.0 - _smoothstep(k)
    return 0.0


# ---------------------------------------------------------------------------
# drop 静默窗
# ---------------------------------------------------------------------------

def is_drop_silence(spec: dict, t: float) -> bool:
    """drop preset 的 0.35–0.40 蓄力段：抑制音频事件、球速降到 0.4 倍。"""
    cfg = parse_arc(spec)
    if cfg.preset != "drop":
        return False
    u = t / cfg.duration
    return 0.35 <= u < 0.40


def is_drop_burst(spec: dict, t: float) -> bool:
    """drop preset 在 u=0.40 的那一帧（爆发点）。"""
    cfg = parse_arc(spec)
    if cfg.preset != "drop":
        return False
    u = t / cfg.duration
    return 0.40 <= u < 0.40 + 1.5 / max(1.0, cfg.duration * 30.0)


# ---------------------------------------------------------------------------
# countdown 节拍点
# ---------------------------------------------------------------------------

def beat_points(spec: dict) -> list:
    """countdown preset 每段开头的节拍点时刻（每段开头 0.15 秒内）。"""
    cfg = parse_arc(spec)
    if cfg.preset != "countdown":
        return []
    return [cfg.duration * k / 5.0 for k in range(5)]


# ---------------------------------------------------------------------------
# 强度 → 视觉参数映射（任务规定的统一公式）
# ---------------------------------------------------------------------------

def speed_mult(i: float) -> float:
    return 0.8 + 0.6 * i


def zoom_mult(i: float) -> float:
    return 1.0 + 0.06 * i


def particle_mult(i: float) -> float:
    return 0.6 + 0.8 * i


def rotation_mult(i: float) -> float:
    return 1.0 + 0.8 * i


def bg_brightness_mult(i: float) -> float:
    return 0.9 + 0.2 * i


def wall_glow_mult(i: float) -> float:
    return 0.7 + 0.6 * i


def split_interval_mult(i: float) -> float:
    """every_n_bounces 实际取值 = max(1, round(base * (1.4 - 0.8*i)))"""
    return 1.4 - 0.8 * i
