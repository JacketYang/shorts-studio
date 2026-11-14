#!/usr/bin/env python3
"""
文字层 (T6)：在最终合成阶段往帧缓冲上叠加文字。

用 Pillow 把每个文字块预渲染成 RGBA 小贴图并缓存（只在内容/字号/样式变化时重建），
再用 alpha 混合贴到 numpy 帧缓冲上。

关键约束
--------
- 文字只在最后合成阶段叠加，绝不写进 trail_buffer，避免拖尾把字糊掉。
- 安全区：top-safe 垂直中心 16%，center 50%，bottom-safe 74%（不超过 78%）。
  右侧 12% 不放文字。
- 宽度超过 86% 画面宽时先尝试 2 行换行，仍超则缩小字号（最低 70%）。
- emoji 一律过滤（Montserrat 无彩色 emoji 字形）。
"""

import math
import os
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFont


_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
FONT_BOLD = os.path.join(_FONT_DIR, "Montserrat-Bold.ttf")

# ---- 安全区 ----
SAFE_Y = {"top-safe": 0.16, "center": 0.50, "bottom-safe": 0.74}
SAFE_MAX_Y = 0.78
SAFE_RIGHT = 0.12          # 右侧留空
MAX_TEXT_WIDTH = 0.86      # 文字最大宽度（相对画面宽）

# ---- 字高（相对画面高）----
ROLE_HEIGHT = {"hook": 0.054, "caption": 0.034, "end_card": 0.038}
HUD_HEIGHT = 0.042

# ---- 样式 ----
STROKE_RATIO = 0.12        # 描边宽 = 字高 × 0.12
SHADOW_DY = 4              # 阴影下移像素（在输出分辨率下）
SHADOW_ALPHA = 0.55

# ---- 动画 ----
HOOK_IN_SEC = 0.15
HOOK_OVERSCALE = 1.08
HOOK_OUT_SEC = 0.20
HOOK_OUT_RISE = 0.02
HOOK_MAX_DUR = 2.2
FADE_SEC = 0.20
HUD_POP_SEC = 0.12
HUD_POP_SCALE = 1.25

# ---- 自动字幕 ----
AUTO_CAPTION_TIMES = (0.30, 0.60, 0.85)
AUTO_CAPTION_TEXTS = ("Wait for it...", "Faster now...", "Here it comes!")
AUTO_CAPTION_DUR = 1.6

# emoji 过滤：常见 emoji 区间
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F5FF"   # 符号与象形
    "\U0001F600-\U0001F64F"   # 表情
    "\U0001F680-\U0001F6FF"   # 交通与地图
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "\U00002600-\U000027BF"   # 杂项符号与装饰
    "\U0001F1E6-\U0001F1FF"   # 区域指示符
    "\U00002700-\U000027BF"
    "\U0000FE00-\U0000FE0F"   # 变体选择符
    "\U0001F3FB-\U0001F3FF"   # 肤色修饰
    "\U0000200D"              # 零宽连接符
    "]+",
    flags=re.UNICODE,
)


def strip_emoji(text: str) -> str:
    """移除 emoji 与变体选择符。"""
    if not text:
        return ""
    return _EMOJI_RE.sub("", text).strip()


# ---------------------------------------------------------------------------
# 字贴图缓存
# ---------------------------------------------------------------------------

_FONT_CACHE: dict = {}
_GLYPH_CACHE: dict = {}


def _get_font(size_px: int) -> ImageFont.FreeTypeFont:
    size_px = max(6, int(round(size_px)))
    f = _FONT_CACHE.get(size_px)
    if f is None:
        f = ImageFont.truetype(FONT_BOLD, size_px)
        _FONT_CACHE[size_px] = f
    return f


def _measure(text: str, font) -> tuple:
    bbox = font.getbbox(text, stroke_width=0)
    return bbox[2] - bbox[0], bbox[3] - bbox[1], bbox


def _wrap_two_lines(text: str, font, max_w: float) -> list:
    """把文字折成最多 2 行；优先在空格处断。"""
    text = text.strip()
    if not text:
        return []
    if _measure(text, font)[0] <= max_w:
        return [text]

    words = text.split()
    if len(words) < 2:
        return [text]

    best = None
    for k in range(1, len(words)):
        l1 = " ".join(words[:k])
        l2 = " ".join(words[k:])
        w1 = _measure(l1, font)[0]
        w2 = _measure(l2, font)[0]
        score = max(w1, w2)
        if best is None or score < best[0]:
            best = (score, [l1, l2])
    assert best is not None
    return best[1]


def _render_glyph_block(
    lines: list,
    size_px: int,
    rgb=(255, 255, 255),
    stroke_rgb=(0, 0, 0),
    stroke_px: int = 0,
    shadow: bool = True,
) -> tuple:
    """把多行文字渲染成 RGBA 图，返回 (numpy RGBA float, w, h)。

    shadow 为 True 时贴图下方预留 SHADOW_DY 像素空间画柔和阴影。
    """
    key = (
        tuple(lines), int(size_px), tuple(rgb), tuple(stroke_rgb),
        int(stroke_px), bool(shadow),
    )
    cached = _GLYPH_CACHE.get(key)
    if cached is not None:
        return cached

    font = _get_font(size_px)
    line_h = int(round(size_px * 1.18))
    stroke_px = max(0, int(round(stroke_px)))

    widths = []
    for ln in lines:
        w = _measure(ln, font)[0]
        widths.append(w)
    block_w = max(widths) if widths else 1
    block_h = line_h * len(lines)

    pad = stroke_px + 4
    canvas_w = int(block_w + pad * 2)
    canvas_h = int(block_h + pad * 2 + (SHADOW_DY if shadow else 0))

    img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 阴影：整体下移，画一层黑色（带 alpha）
    if shadow:
        shadow_layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(shadow_layer)
        for i, ln in enumerate(lines):
            y = pad + i * line_h
            sdraw.text((pad, y + SHADOW_DY), ln, font=font,
                       fill=(0, 0, 0, int(255 * SHADOW_ALPHA)),
                       stroke_width=stroke_px, stroke_fill=(0, 0, 0, int(255 * SHADOW_ALPHA)))
        img = Image.alpha_composite(img, shadow_layer)
        draw = ImageDraw.Draw(img)

    for i, ln in enumerate(lines):
        y = pad + i * line_h
        draw.text((pad, y), ln, font=font, fill=tuple(rgb) + (255,),
                  stroke_width=stroke_px, stroke_fill=tuple(stroke_rgb) + (255,))

    arr = np.asarray(img, dtype=np.float32) / 255.0
    result = (arr, canvas_w, canvas_h)
    if len(_GLYPH_CACHE) > 256:
        _GLYPH_CACHE.clear()
    _GLYPH_CACHE[key] = result
    return result


# ---------------------------------------------------------------------------
# 合成：把 RGBA 贴图 alpha 混合到帧缓冲
# ---------------------------------------------------------------------------

def blit(fb: np.ndarray, rgba: np.ndarray, x: float, y: float,
         scale: float = 1.0, alpha: float = 1.0) -> None:
    """把 RGBA 贴图按 scale/alpha 混合到 fb 的 (x, y)（贴图左上角）。"""
    if alpha <= 0.001 or scale <= 0.01:
        return

    h, w = rgba.shape[0], rgba.shape[1]
    if abs(scale - 1.0) > 1e-3:
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        img = Image.fromarray((rgba * 255.0).astype(np.uint8), mode="RGBA")
        img = img.resize((nw, nh), Image.BILINEAR)
        rgba = np.asarray(img, dtype=np.float32) / 255.0
        h, w = nh, nw

    fh, fw = fb.shape[0], fb.shape[1]
    x0 = int(round(x))
    y0 = int(round(y))
    x1 = x0 + w
    y1 = y0 + h

    sx0 = max(0, -x0)
    sy0 = max(0, -y0)
    dx0 = max(0, x0)
    dy0 = max(0, y0)
    sx1 = min(w, fw - x0)
    sy1 = min(h, fh - y0)
    if sx1 <= sx0 or sy1 <= sy0:
        return

    patch = rgba[sy0:sy1, sx0:sx1, :]
    a = patch[:, :, 3:4] * alpha
    rgb = patch[:, :, :3]
    region = fb[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0), :]
    fb[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0), :] = region * (1.0 - a) + rgb * 255.0 * a


# ---------------------------------------------------------------------------
# 时间轴解析
# ---------------------------------------------------------------------------

class TextItem:
    __slots__ = ("role", "text", "position", "style", "t0", "t1", "dur")

    def __init__(self, role, text, position, style, t0, t1, dur):
        self.role = role
        self.text = text
        self.position = position
        self.style = style
        self.t0 = t0
        self.t1 = t1
        self.dur = dur

    def active(self, t: float) -> bool:
        return self.t0 <= t < self.t1


def parse_timeline(spec: dict, duration: float, captions_auto: bool) -> list:
    """解析 spec.timeline 的 text 项；t<0 表示从末尾倒数。"""
    items = []
    for raw in (spec.get("timeline") or []):
        if not isinstance(raw, dict) or raw.get("type") != "text":
            continue
        text = strip_emoji(str(raw.get("text", "")))
        if not text:
            continue

        t_raw = float(raw.get("t", 0.0))
        dur = float(raw.get("dur", 1.5))
        t0 = duration + t_raw if t_raw < 0 else t_raw

        role = raw.get("role", "caption")
        if role not in ROLE_HEIGHT:
            role = "caption"

        # hook 最长 2.2 秒
        eff_dur = min(dur, HOOK_MAX_DUR) if role == "hook" else dur
        items.append(TextItem(
            role=role,
            text=text,
            position=raw.get("position", "top-safe"),
            style=raw.get("style", "bold-white-shadow"),
            t0=max(0.0, t0),
            t1=max(0.0, t0) + eff_dur,
            dur=eff_dur,
        ))

    if captions_auto:
        for idx, u in enumerate(AUTO_CAPTION_TIMES):
            t0 = duration * u
            items.append(TextItem(
                role="caption",
                text=AUTO_CAPTION_TEXTS[idx % len(AUTO_CAPTION_TEXTS)],
                position="center",
                style="bold-white-shadow",
                t0=t0,
                t1=t0 + AUTO_CAPTION_DUR,
                dur=AUTO_CAPTION_DUR,
            ))

    return items


# ---------------------------------------------------------------------------
# 动画
# ---------------------------------------------------------------------------

def _hook_transform(item: TextItem, t: float) -> tuple:
    """返回 (scale, alpha, dy_ratio)。"""
    age = t - item.t0
    remain = item.t1 - t

    # 出场：0.15s 内 70%→108%→100%
    if age < HOOK_IN_SEC:
        k = age / HOOK_IN_SEC
        if k < 0.72:
            # 70% → 108%
            s = 0.70 + (HOOK_OVERSCALE - 0.70) * (k / 0.72)
        else:
            # 108% → 100%
            k2 = (k - 0.72) / 0.28
            s = HOOK_OVERSCALE + (1.0 - HOOK_OVERSCALE) * k2
        a = min(1.0, 0.35 + 0.65 * (k / 0.6)) if k < 0.6 else 1.0
        return s, a, 0.0

    # 退场：0.2s 淡出 + 上移 2% 画面高
    if remain < HOOK_OUT_SEC:
        k = max(0.0, remain / HOOK_OUT_SEC)
        return 1.0, k, -HOOK_OUT_RISE * (1.0 - k)

    return 1.0, 1.0, 0.0


def _fade_transform(item: TextItem, t: float) -> tuple:
    """caption / end_card：0.2s 淡入淡出。"""
    age = t - item.t0
    remain = item.t1 - t
    a = 1.0
    if age < FADE_SEC:
        a = age / FADE_SEC
    if remain < FADE_SEC:
        a = min(a, max(0.0, remain / FADE_SEC))
    return 1.0, max(0.0, min(1.0, a)), 0.0


# ---------------------------------------------------------------------------
# 文字绘制
# ---------------------------------------------------------------------------

class TextLayer:
    """负责整段的文字叠加。构造一次，逐帧调用 draw()。"""

    def __init__(self, spec: dict, w: int, h: int, palette, duration: float):
        self.w = w
        self.h = h
        self.palette = palette or [(255, 255, 255)]
        self.duration = duration

        hud = (spec.get("scene") or {}).get("hud") or {}
        if not isinstance(hud, dict):
            hud = {}
        self.hud_counter = hud.get("counter", "none")
        if self.hud_counter not in ("none", "balls", "notes", "bounces", "bins_filled"):
            self.hud_counter = "none"
        self.hud_label = strip_emoji(str(hud.get("label") or "")) or None
        self.hud_position = hud.get("position", "bottom-safe")
        if self.hud_position not in ("top-safe", "bottom-safe"):
            self.hud_position = "bottom-safe"

        captions_auto = bool((spec.get("scene") or {}).get("captions_auto", False))
        self.items = parse_timeline(spec, duration, captions_auto)

        # HUD 数字跳动状态
        self._last_hud_value = None
        self._hud_pop_t0 = -1e9

    # -- 布局 -----------------------------------------------------------

    def _layout(self, text: str, role: str):
        """返回 (lines, size_px, stroke_px)。处理换行与缩字。"""
        base = ROLE_HEIGHT[role] * self.h
        max_w = MAX_TEXT_WIDTH * self.w
        right_limit = (1.0 - SAFE_RIGHT) * self.w

        for shrink in (1.0, 0.92, 0.85, 0.78, 0.70):
            size_px = base * shrink
            font = _get_font(size_px)
            lines = _wrap_two_lines(text, font, max_w - size_px * 0.3)
            if not lines:
                continue
            widest = max(_measure(ln, font)[0] for ln in lines)
            if widest <= right_limit - self.w * 0.05:
                stroke = max(1, int(round(size_px * STROKE_RATIO)))
                return lines, size_px, stroke

        # 最低档强行返回
        size_px = base * 0.70
        font = _get_font(size_px)
        lines = _wrap_two_lines(text, font, max_w)
        stroke = max(1, int(round(size_px * STROKE_RATIO)))
        return lines or [text], size_px, stroke

    def _draw_item(self, fb: np.ndarray, item: TextItem, t: float) -> None:
        if item.role == "hook":
            scale, alpha, dy = _hook_transform(item, t)
        else:
            scale, alpha, dy = _fade_transform(item, t)
        if alpha <= 0.01:
            return

        lines, size_px, stroke = self._layout(item.text, item.role)
        rgba, gw, gh = _render_glyph_block(
            lines, size_px,
            rgb=(255, 255, 255),
            stroke_rgb=(0, 0, 0),
            stroke_px=stroke,
            shadow=True,
        )

        cy_ratio = SAFE_Y.get(item.position, 0.50)
        cy = cy_ratio * self.h + dy * self.h

        x = (self.w - gw) * 0.5
        y = cy - gh * 0.5
        blit(fb, rgba, x, y, scale=scale, alpha=alpha)

    # -- HUD ------------------------------------------------------------

    def _hud_value(self, stats: dict) -> int:
        if self.hud_counter == "balls":
            return int(stats.get("balls", 0))
        if self.hud_counter == "notes":
            return int(stats.get("notes", 0))
        if self.hud_counter == "bounces":
            return int(stats.get("bounces", 0))
        if self.hud_counter == "bins_filled":
            return int(stats.get("bins_filled", 0))
        return 0

    def _hud_text(self, value: int) -> str:
        default_label = {
            "balls": "BALLS",
            "notes": "NOTES",
            "bounces": "BOUNCES",
            "bins_filled": "BINS",
        }.get(self.hud_counter, "")
        label = self.hud_label or default_label
        return f"{label} {value}".strip()

    def _draw_hud(self, fb: np.ndarray, t: float, stats: dict) -> None:
        if self.hud_counter == "none":
            return

        value = self._hud_value(stats)
        if self._last_hud_value is not None and value != self._last_hud_value:
            self._hud_pop_t0 = t
        self._last_hud_value = value

        # 数字跳动：0.12s 内 1.0 → 1.25 → 1.0
        pop_age = t - self._hud_pop_t0
        if 0 <= pop_age < HUD_POP_SEC:
            k = pop_age / HUD_POP_SEC
            pop = 1.0 + (HUD_POP_SCALE - 1.0) * math.sin(k * math.pi)
        else:
            pop = 1.0

        text = strip_emoji(self._hud_text(value))
        if not text:
            return

        size_px = HUD_HEIGHT * self.h
        stroke = max(1, int(round(size_px * STROKE_RATIO)))
        rgba, gw, gh = _render_glyph_block(
            [text], size_px,
            rgb=tuple(self.palette[0]),
            stroke_rgb=(0, 0, 0),
            stroke_px=stroke,
            shadow=True,
        )

        cy_ratio = SAFE_Y.get(self.hud_position, 0.74)
        cy = cy_ratio * self.h
        # HUD 靠右侧安全区内
        x = self.w * (1.0 - SAFE_RIGHT) - gw - self.w * 0.03
        y = cy - gh * 0.5
        blit(fb, rgba, x, y, scale=pop, alpha=1.0)

    # -- 对外 -----------------------------------------------------------

    def draw(self, fb: np.ndarray, t: float, stats: dict = None) -> None:
        """在当前帧上叠加所有文字。t 为当前时刻（秒）。"""
        stats = stats or {}

        active = [it for it in self.items if it.active(t)]

        # 同一时刻最多 1 个 hook + 1 个 caption
        hooks = [it for it in active if it.role == "hook"]
        captions = [it for it in active if it.role == "caption"]
        ends = [it for it in active if it.role == "end_card"]

        chosen = []
        if hooks:
            chosen.append(max(hooks, key=lambda x: x.t0))   # 最新出现的
        if captions:
            chosen.append(max(captions, key=lambda x: x.t0))
        chosen.extend(ends)

        for it in chosen:
            self._draw_item(fb, it, t)

        self._draw_hud(fb, t, stats)
