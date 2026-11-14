#!/usr/bin/env python3
"""
统一视觉主题 (T4)。

把"背景 + 光斑 + 配色 + 墙体/文字颜色"集中到一处，四个模板共用，
保证同一套设计语言。

要点
----
- 背景渐变来自 spec.style.background.colors；只有一种颜色时，
  第二色 = 第一色向黑色混合 55%。
- 慢速漂浮光斑 bokeh：12 个，半径 0.04W–0.12W，透明度 0.05–0.10，
  位置按 seed 生成，以 0.01W/秒漂移，循环包裹，加色混合。
- 颜色循环：球碰撞后切换到调色板下一个颜色，0.08 秒渐变过渡。
- 墙体/文字默认色：调色板第一色的 85% 亮度，替代写死的 (203,213,225)。
"""

import math

import numpy as np

import gfx


BOKEH_COUNT = 12
BOKEH_R_MIN = 0.04
BOKEH_R_MAX = 0.12
BOKEH_ALPHA_MIN = 0.05
BOKEH_ALPHA_MAX = 0.10
BOKEH_SPEED = 0.01          # 相对 W / 秒

COLOR_TRANSITION_SEC = 0.08


def _hex_to_rgb_local(hex_color: str, fallback=(56, 189, 248)):
    s = (hex_color or "").strip().lstrip("#")
    if len(s) != 6:
        return fallback
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except ValueError:
        return fallback


def mix_to_black(rgb, amount: float):
    """向黑色混合：amount=0.55 表示变成原亮度的 45%。"""
    return tuple(int(c * (1.0 - amount)) for c in rgb)


def scale_brightness(rgb, factor: float):
    return tuple(max(0, min(255, int(c * factor))) for c in rgb)


def lerp_rgb(a, b, k: float):
    """两色线性插值。"""
    k = max(0.0, min(1.0, k))
    return (
        int(a[0] + (b[0] - a[0]) * k),
        int(a[1] + (b[1] - a[1]) * k),
        int(a[2] + (b[2] - a[2]) * k),
    )


def palette_gradient(colors, k: float):
    """沿调色板整体做渐变取色（用于摆球序号渐变，不是循环取色）。"""
    if not colors:
        return (255, 255, 255)
    if len(colors) == 1:
        return colors[0]
    k = max(0.0, min(1.0, k))
    pos = k * (len(colors) - 1)
    i0 = int(math.floor(pos))
    i1 = min(len(colors) - 1, i0 + 1)
    return lerp_rgb(colors[i0], colors[i1], pos - i0)


class Bokeh:
    """一个漂浮光斑。位置用相对坐标(0–1)，绘制时乘 W/H。"""
    __slots__ = ("x", "y", "r", "alpha", "vx", "vy", "color")

    def __init__(self, x, y, r, alpha, vx, vy, color):
        self.x = x
        self.y = y
        self.r = r
        self.alpha = alpha
        self.vx = vx
        self.vy = vy
        self.color = color

    def advance(self, dt: float) -> None:
        """按速度漂移并循环包裹（位置是相对值，0–1 之外回绕）。"""
        self.x = (self.x + self.vx * dt) % 1.0
        self.y = (self.y + self.vy * dt) % 1.0


class Theme:
    """四模板共用的视觉主题。"""

    def __init__(self, spec: dict, w: int, h: int, rng):
        self.w = w
        self.h = h

        scene = spec.get("scene") or {}
        style = scene.get("style") or {}

        # ---- 调色板 ----
        pal_raw = ((style.get("palette") or {}).get("colors")) or []
        self.palette = [_hex_to_rgb_local(c) for c in pal_raw] or [(56, 189, 248)]
        if not self.palette:
            self.palette = [(56, 189, 248)]

        # ---- 背景渐变 ----
        bg_raw = style.get("background") or {}
        bg_colors = bg_raw.get("colors") or []
        if not bg_colors:
            bg_colors = ["#05060F", "#101437"]

        top = _hex_to_rgb_local(bg_colors[0], (5, 6, 15))
        if len(bg_colors) >= 2:
            bottom = _hex_to_rgb_local(bg_colors[1], (16, 20, 55))
        else:
            # 只有一种颜色：第二色 = 第一色向黑色混合 55%
            bottom = mix_to_black(top, 0.55)

        self.bg_top = top
        self.bg_bottom = bottom

        # ---- 墙体 / 文字默认色 ----
        self.ui_color = scale_brightness(self.palette[0], 0.85)
        self.text_color = self.ui_color

        # ---- bokeh 光斑 ----
        self.bokeh: list = []
        for _ in range(BOKEH_COUNT):
            ang = rng.uniform(0.0, 2.0 * math.pi)
            speed_rel = BOKEH_SPEED * rng.uniform(0.6, 1.4)
            self.bokeh.append(Bokeh(
                x=rng.random(),
                y=rng.random(),
                r=rng.uniform(BOKEH_R_MIN, BOKEH_R_MAX),
                alpha=rng.uniform(BOKEH_ALPHA_MIN, BOKEH_ALPHA_MAX),
                vx=math.cos(ang) * speed_rel,
                vy=math.sin(ang) * speed_rel,
                color=self.palette[rng.randrange(len(self.palette))],
            ))

    # -- 背景 ----------------------------------------------------------

    def build_background(self) -> np.ndarray:
        """渐变背景 + bokeh 光斑（加色混合），整段只生成一次。"""
        fb = gfx.fill_gradient(self.h, self.w, self.bg_top, self.bg_bottom)

        for b in self.bokeh:
            cx = b.x * self.w
            cy = b.y * self.h
            r = b.r * self.w
            gfx.add_glow(fb, cx, cy, r, b.color, b.alpha)

        np.clip(fb, 0.0, 255.0, out=fb)
        return fb

    def advance_bokeh(self, dt: float) -> None:
        """推进光斑漂移（若需要整段动画背景可每帧调用；
        当前背景是缓存复用，故此方法供将来按需使用）。"""
        for b in self.bokeh:
            b.advance(dt)


class ColorCycler:
    """球碰撞后颜色切到调色板下一个，用 0.08 秒渐变过渡。"""

    __slots__ = ("palette", "_from", "_to", "_t0", "_idx")

    def __init__(self, palette):
        self.palette = palette if palette else [(255, 255, 255)]
        self._from = self.palette[0]
        self._to = self.palette[0]
        self._t0 = -1e9
        self._idx = 0

    def advance(self, t: float) -> None:
        """切换到下一个颜色，从 t 时刻开始过渡。"""
        self._from = self.current(t)
        self._idx = (self._idx + 1) % len(self.palette)
        self._to = self.palette[self._idx]
        self._t0 = t

    def current(self, t: float):
        if t <= self._t0:
            return self._to
        k = (t - self._t0) / COLOR_TRANSITION_SEC
        if k >= 1.0:
            return self._to
        return lerp_rgb(self._from, self._to, k)


def get_theme(spec: dict, w: int, h: int, rng) -> Theme:
    """从 spec 构建主题。rng 必须是 seed 派生的，保证可复现。"""
    return Theme(spec, w, h, rng)
