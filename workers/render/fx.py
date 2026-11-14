#!/usr/bin/env python3
"""
视觉反馈特效层 (T3)。

所有效果都由"事件"驱动：每次碰撞/掉落调用 spawn()，随后逐帧 update()。
粒子与随机方向一律来自 seed 派生的 rng，保证可复现。

强度来源（由渲染器按模板传入 intensity i∈[0.3, 1.0]）：
  melody-bounce  碰墙 0.6 / 分裂 1.0 / 每第 8 次碰撞 +0.2
  ball-sort      钉子 0.4 / 入桶 0.9 / 整桶满 1.0
  pendulum-wave  过中线 0.5 / 全体对齐 1.0
  orbit-sync     过光束 0.6

性能约束：只在包围盒内运算；粒子总数硬上限 60。
"""

import math

import numpy as np

import gfx


# ---------------------------------------------------------------------------
# level 预设
# ---------------------------------------------------------------------------

FX_FIELDS = ("flash", "ripple", "particles", "shake", "pop", "vignette")

LEVEL_PRESETS = {
    0: {"flash": 0.0, "ripple": 0.0, "particles": 0.0, "shake": 0.0, "pop": 0.0, "vignette": 0.0},
    1: {"flash": 0.4, "ripple": 0.5, "particles": 0.4, "shake": 0.0, "pop": 0.5, "vignette": 0.3},
    2: {"flash": 0.7, "ripple": 0.8, "particles": 0.7, "shake": 0.5, "pop": 0.8, "vignette": 0.5},
    3: {"flash": 1.0, "ripple": 1.0, "particles": 1.0, "shake": 1.0, "pop": 1.0, "vignette": 0.7},
}

DEFAULT_LEVEL = 2

# 粒子硬上限
MAX_PARTICLES = 60


class FxConfig:
    """解析后的特效强度。"""

    __slots__ = FX_FIELDS

    def __init__(self, flash: float, ripple: float, particles: float,
                 shake: float, pop: float, vignette: float):
        self.flash = flash
        self.ripple = ripple
        self.particles = particles
        self.shake = shake
        self.pop = pop
        self.vignette = vignette

    @property
    def disabled(self) -> bool:
        return all(getattr(self, f) <= 0.0 for f in FX_FIELDS)

    def as_dict(self) -> dict:
        return {f: getattr(self, f) for f in FX_FIELDS}


def parse_fx(raw) -> FxConfig:
    """scene.style.fx → FxConfig。level 给预设，显式字段覆盖。"""
    raw = raw if isinstance(raw, dict) else {}

    level = raw.get("level", DEFAULT_LEVEL)
    if level not in LEVEL_PRESETS:
        level = DEFAULT_LEVEL
    preset = LEVEL_PRESETS[level]

    vals = {}
    for f in FX_FIELDS:
        v = raw.get(f)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            vals[f] = max(0.0, min(1.0, float(v)))
        else:
            vals[f] = preset[f]

    return FxConfig(**vals)


# ---------------------------------------------------------------------------
# 单个效果的时间参数
# ---------------------------------------------------------------------------

FLASH_TAU = 0.10          # 背景闪光指数衰减时间常数（秒）
RIPPLE_LIFE = 0.45        # 涟漪寿命
RIPPLE_MAX_REL = 0.12     # 涟漪最大半径 = 0.12 * W
POP_LIFE = 0.12           # 弹跳放大回落时间
WALL_LIFE = 0.25          # 墙体点亮衰减
SHAKE_LIFE = 0.14         # 震屏衰减
SHAKE_FREQ = 30.0         # 震屏频率 Hz
SHAKE_STRONG_I = 0.8      # 仅 i≥0.8 触发震屏
WALL_SEGMENTS = 24        # 圆形场地墙体分段数


class Ripple:
    __slots__ = ("x", "y", "t0", "color", "strength")

    def __init__(self, x, y, t0, color, strength):
        self.x = x
        self.y = y
        self.t0 = t0
        self.color = color
        self.strength = strength


class Particle:
    __slots__ = ("x", "y", "vx", "vy", "t0", "life", "r0", "color")

    def __init__(self, x, y, vx, vy, t0, life, r0, color):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.t0 = t0
        self.life = life
        self.r0 = r0
        self.color = color


class Pop:
    """球体弹跳放大：记录 (球序号, 起始时刻, 强度)。"""
    __slots__ = ("key", "t0", "intensity")

    def __init__(self, key, t0, intensity):
        self.key = key
        self.t0 = t0
        self.intensity = intensity


class WallFlash:
    """最近一段墙的点亮。seg 为段索引；圆场地按 24 段，多边形按边数。"""
    __slots__ = ("seg", "t0", "color", "strength")

    def __init__(self, seg, t0, color, strength):
        self.seg = seg
        self.t0 = t0
        self.color = color
        self.strength = strength


# ---------------------------------------------------------------------------
# 特效系统
# ---------------------------------------------------------------------------

class FxSystem:
    """持有一帧内所有活跃特效，负责 update 与合成。"""

    def __init__(self, cfg: FxConfig, rng, w: int, h: int):
        self.cfg = cfg
        self.rng = rng
        self.w = w
        self.h = h

        self.ripples: list = []
        self.particles: list = []
        self.pops: dict = {}          # key -> Pop
        self.wall_flashes: list = []
        self.flash_val = 0.0          # 当前背景闪光余量（0–1 归一）
        self.flash_color = (255, 255, 255)

        # 震屏：只保留最近一次强事件的参数
        self.shake_t0 = -1e9
        self.shake_amp = 0.0

        # 统计用（断言上限）
        self.peak_particles = 0

    # -- 事件入口 ----------------------------------------------------------

    def spawn(
        self,
        t: float,
        x: float,
        y: float,
        intensity: float,
        color,
        *,
        palette=None,
        wall_seg: int | None = None,
        ball_key=None,
    ) -> None:
        """一次碰撞/掉落产生全部反馈。"""
        cfg = self.cfg
        if cfg.disabled:
            return

        i = max(0.3, min(1.0, float(intensity)))

        # 1) 背景闪光（只记录强度，逐帧衰减）
        if cfg.flash > 0:
            self.flash_val = min(1.0, self.flash_val + (0.06 + 0.10 * i) * cfg.flash)
            self.flash_color = color

        # 2) 涟漪
        if cfg.ripple > 0:
            self.ripples.append(Ripple(x, y, t, color, cfg.ripple))

        # 3) 粒子
        if cfg.particles > 0:
            n = int(round((6 + 10 * i) * cfg.particles))
            for _ in range(n):
                ang = self.rng.uniform(0.0, 2.0 * math.pi)
                spd = self.rng.uniform(0.12, 0.36) * self.w
                pcol = color
                if palette and self.rng.random() < 0.5:
                    pcol = palette[self.rng.randrange(len(palette))]
                self.particles.append(Particle(
                    x, y,
                    math.cos(ang) * spd, math.sin(ang) * spd,
                    t, self.rng.uniform(0.35, 0.60),
                    self.rng.uniform(3.0, 4.5),
                    pcol,
                ))
            # 硬上限：超出丢弃最早的（任务要求任意时刻存活 ≤ 60）
            if len(self.particles) > MAX_PARTICLES:
                self.particles = self.particles[-MAX_PARTICLES:]
            assert len(self.particles) <= MAX_PARTICLES, "粒子数超上限"

        # 4) 弹跳放大
        if cfg.pop > 0 and ball_key is not None:
            self.pops[ball_key] = Pop(ball_key, t, min(1.0, 0.35 * i * cfg.pop))

        # 5) 墙体点亮
        if wall_seg is not None:
            self.wall_flashes.append(WallFlash(wall_seg, t, color, i))

        # 6) 震屏：仅强事件
        if cfg.shake > 0 and i >= SHAKE_STRONG_I:
            self.shake_t0 = t
            self.shake_amp = cfg.shake * i * 0.006 * self.w

    # -- 逐帧更新 ----------------------------------------------------------

    def update(self, t: float, dt: float) -> None:
        """推进所有效果的生命周期，丢弃已死亡的。"""
        self.flash_val *= math.exp(-dt / FLASH_TAU)

        self.ripples = [r for r in self.ripples if t - r.t0 < RIPPLE_LIFE]

        alive = []
        for p in self.particles:
            age = t - p.t0
            if age >= p.life:
                continue
            # 轻微重力
            p.vy += 0.3 * self.w * dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            alive.append(p)
        self.particles = alive

        self.pops = {k: v for k, v in self.pops.items() if t - v.t0 < POP_LIFE}
        self.wall_flashes = [w for w in self.wall_flashes if t - w.t0 < WALL_LIFE]

        if self.peak_particles < len(self.particles):
            self.peak_particles = len(self.particles)

    # -- 查询 --------------------------------------------------------------

    def pop_scale(self, ball_key, t: float) -> float:
        """返回该球当前的半径倍率（1.0 表示原尺寸）。"""
        p = self.pops.get(ball_key)
        if p is None:
            return 1.0
        age = t - p.t0
        if age < 0 or age >= POP_LIFE:
            return 1.0
        k = age / POP_LIFE
        ease_out = (1.0 - k) ** 2
        return 1.0 + p.intensity * ease_out

    def wall_boost(self, seg: int, t: float):
        """返回该墙段的 (额外亮度倍率, 颜色) 或 None。"""
        best = None
        for w in self.wall_flashes:
            if w.seg != seg:
                continue
            age = t - w.t0
            if age < 0 or age >= WALL_LIFE:
                continue
            k = 1.0 - age / WALL_LIFE
            bright = 0.25 + 0.75 * k          # 1.0 → 0.25
            if best is None or bright > best[0]:
                best = (bright, w.color)
        return best

    # -- 绘制 --------------------------------------------------------------

    def apply_background_flash(self, fb: np.ndarray) -> None:
        """背景闪光：整体提亮（加色）。"""
        if self.flash_val <= 0.0:
            return
        amt = self.flash_val * 255.0
        col = self.flash_color
        # 按颜色比例轻微着色，避免纯白死板
        mx = max(1, max(col))
        contrib = np.array(
            [amt * (0.55 + 0.45 * col[0] / mx),
             amt * (0.55 + 0.45 * col[1] / mx),
             amt * (0.55 + 0.45 * col[2] / mx)],
            dtype=np.float32,
        )
        fb += contrib

    def draw_ripples(self, fb: np.ndarray, t: float) -> None:
        for r in self.ripples:
            age = t - r.t0
            if age < 0 or age >= RIPPLE_LIFE:
                continue
            k = age / RIPPLE_LIFE
            radius = RIPPLE_MAX_REL * self.w * k
            if radius <= 0.5:
                continue
            width = 3.0 - 2.0 * k                 # 3px → 1px
            alpha = (0.8 * (1.0 - k)) * r.strength
            if alpha <= 0.01:
                continue
            gfx.draw_ring_aa(fb, r.x, r.y, radius, max(0.8, width), r.color, alpha)

    def draw_particles(self, fb: np.ndarray, t: float) -> None:
        for p in self.particles:
            age = t - p.t0
            if age < 0 or age >= p.life:
                continue
            k = age / p.life
            radius = max(0.5, p.r0 * (1.0 - k) + 0.5 * k)
            # 粒子用 add_glow 绘制（加色，自然发光）
            gfx.add_glow(fb, p.x, p.y, radius * 2.2, p.color, 0.85 * (1.0 - 0.6 * k))

    def shake_offset(self, t: float):
        """返回当前帧的整体位移 (dx, dy)。"""
        age = t - self.shake_t0
        if age < 0 or age >= SHAKE_LIFE or self.shake_amp <= 0.0:
            return 0.0, 0.0
        decay = 1.0 - age / SHAKE_LIFE
        amp = self.shake_amp * decay
        phase = 2.0 * math.pi * SHAKE_FREQ * age
        return amp * math.sin(phase), amp * math.cos(phase * 1.31)
