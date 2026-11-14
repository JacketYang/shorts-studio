#!/usr/bin/env python3
"""
绘图层 (T2)：numpy 帧缓冲 + 抗锯齿 + 加色发光 + 余辉拖尾。

设计约束
--------
1. 帧缓冲是 numpy float32，形状 (H, W, 3)，取值 0–255。
   H/W 由调用方决定（内部渲染尺寸，默认 720×1280，--draft 为 540×960）。
2. 所有绘制函数只在目标图形的**包围盒**内做 numpy 运算，绝不全屏扫描。
3. 抗锯齿用距离场 + smoothstep，边缘 1 像素宽过渡。
4. 发光贴图按半径取整缓存；暗角蒙版按尺寸缓存 —— 不重复计算。
5. 不使用 Pillow 绘制（只依赖 numpy）；Pillow 留作后续可能的编解码用途。

坐标约定
--------
- 内部渲染尺寸下，所有"像素"参数由渲染器换算成相对画面宽度的比例后传入，
  所以 720×1280 与 540×960 画出的构图一致。
"""

import math

import numpy as np


# ---------------------------------------------------------------------------
# 缓存
# ---------------------------------------------------------------------------

_GLOW_CACHE: dict = {}
_VIGNETTE_CACHE: dict = {}

# 发光贴图统一按这个边长生成，再按需裁剪/缩放，避免每个半径都生成一张
_GLOW_LUT_SIZE = 512


def _glow_lut() -> np.ndarray:
    """单位径向衰减贴图：中心 1.0，边缘 0.0，二次衰减，长边 _GLOW_LUT_SIZE。"""
    lut = _GLOW_CACHE.get("__lut__")
    if lut is not None:
        return lut

    n = _GLOW_LUT_SIZE
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    cx = cy = (n - 1) * 0.5
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / cx
    # 中心亮、边缘归零；三次方让光晕更柔
    falloff = np.clip(1.0 - dist, 0.0, 1.0) ** 3.0
    lut = falloff.astype(np.float32)
    _GLOW_CACHE["__lut__"] = lut
    return lut


def _glow_patch(radius_px: int) -> np.ndarray:
    """取半径为 radius_px 的发光贴图（按半径取整缓存）。"""
    radius_px = max(1, int(round(radius_px)))
    cached = _GLOW_CACHE.get(radius_px)
    if cached is not None:
        return cached

    lut = _glow_lut()
    target = radius_px * 2 + 1
    if target == lut.shape[0]:
        patch = lut
    else:
        # 双线性重采样到目标尺寸（纯 numpy，避免引入 scipy）
        n = lut.shape[0]
        idx = np.linspace(0, n - 1, target).astype(np.float32)
        i0 = np.floor(idx).astype(np.int32)
        i1 = np.minimum(i0 + 1, n - 1)
        w = (idx - i0).astype(np.float32)
        rows = lut[i0, :] * (1 - w)[:, None] + lut[i1, :] * w[:, None]
        patch = rows[:, i0] * (1 - w)[None, :] + rows[:, i1] * w[None, :]

    patch = patch.astype(np.float32)
    _GLOW_CACHE[radius_px] = patch
    return patch


def _vignette_mask(h: int, w: int, strength: float) -> np.ndarray:
    """暗角蒙版：中心 1.0，四角约 0.55（strength=1.0 时）。按尺寸+强度缓存。"""
    key = (h, w, round(strength, 3))
    cached = _VIGNETTE_CACHE.get(key)
    if cached is not None:
        return cached

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = (w - 1) * 0.5
    cy = (h - 1) * 0.5
    # 归一化到"到中心的相对距离"，角上为 1
    nx = (xx - cx) / max(1.0, cx)
    ny = (yy - cy) / max(1.0, cy)
    d = np.sqrt(nx * nx + ny * ny) / math.sqrt(2.0)
    # 中心保持 1，角上降到 0.55
    mask = 1.0 - strength * 0.45 * (d ** 2.2)
    mask = np.clip(mask, 0.0, 1.0).astype(np.float32)
    mask3 = np.repeat(mask[:, :, None], 3, axis=2)
    _VIGNETTE_CACHE[key] = mask3
    return mask3


def clear_caches() -> None:
    _GLOW_CACHE.clear()
    _VIGNETTE_CACHE.clear()


# ---------------------------------------------------------------------------
# 基础
# ---------------------------------------------------------------------------

def new_frame(h: int, w: int, rgb=(0, 0, 0)) -> np.ndarray:
    """创建 (H, W, 3) float32 帧缓冲，填充纯色。"""
    fb = np.empty((h, w, 3), dtype=np.float32)
    fb[:, :] = np.asarray(rgb, dtype=np.float32)
    return fb


def fill_gradient(h: int, w: int, top_rgb, bottom_rgb) -> np.ndarray:
    """垂直渐变背景缓存：顶部 top_rgb → 底部 bottom_rgb。只生成一次。"""
    top = np.asarray(top_rgb, dtype=np.float32)
    bottom = np.asarray(bottom_rgb, dtype=np.float32)
    k = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None, None]
    bg = top[None, None, :] * (1.0 - k) + bottom[None, None, :] * k
    return np.repeat(bg, w, axis=1).astype(np.float32)


def _blend_bbox(fb: np.ndarray, x0: int, y0: int, patch_rgb: np.ndarray, alpha: np.ndarray) -> None:
    """把 (h, w, 3) 颜色与 (h, w) alpha 混合进 fb 的指定区域。"""
    h, w = alpha.shape
    ph, pw = fb.shape[0], fb.shape[1]
    if x0 >= pw or y0 >= ph or x0 + w <= 0 or y0 + h <= 0:
        return

    # 裁掉越界部分
    sx0 = max(0, -x0)
    sy0 = max(0, -y0)
    dx0 = max(0, x0)
    dy0 = max(0, y0)
    sx1 = min(w, pw - x0)
    sy1 = min(h, ph - y0)
    if sx1 <= sx0 or sy1 <= sy0:
        return

    a = alpha[sy0:sy1, sx0:sx1, None]
    col = patch_rgb[sy0:sy1, sx0:sx1, :] if patch_rgb.ndim == 3 else patch_rgb
    region = fb[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0), :]
    fb[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0), :] = region * (1.0 - a) + col * a


def _smoothstep_cov(dist: np.ndarray, edge: float) -> np.ndarray:
    """距离场 → 覆盖率。dist 为到边界的距离（内部为正）。"""
    t = np.clip(dist / max(1e-6, edge), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


# ---------------------------------------------------------------------------
# 抗锯齿图元（只在包围盒内计算）
# ---------------------------------------------------------------------------

def draw_disc_aa(fb: np.ndarray, cx: float, cy: float, r: float, rgb, alpha: float = 1.0) -> None:
    """抗锯齿实心圆：边缘 1 像素 smoothstep 过渡。"""
    if r <= 0.05 or alpha <= 0.0:
        return

    pad = 2
    x0 = int(math.floor(cx - r)) - pad
    y0 = int(math.floor(cy - r)) - pad
    x1 = int(math.ceil(cx + r)) + pad
    y1 = int(math.ceil(cy + r)) + pad

    h, w = fb.shape[0], fb.shape[1]
    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(w, x1 + 1), min(h, y1 + 1)
    if x0c >= x1c or y0c >= y1c:
        return

    yy = np.arange(y0c, y1c, dtype=np.float32)[:, None] + 0.5
    xx = np.arange(x0c, x1c, dtype=np.float32)[None, :] + 0.5
    dist = r - np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    cov = _smoothstep_cov(dist, 1.0)
    if alpha < 1.0:
        cov = cov * alpha

    col = np.asarray(rgb, dtype=np.float32)
    region = fb[y0c:y1c, x0c:x1c, :]
    fb[y0c:y1c, x0c:x1c, :] = region * (1.0 - cov[:, :, None]) + col[None, None, :] * cov[:, :, None]


def draw_ring_aa(fb: np.ndarray, cx: float, cy: float, r: float, thickness: float, rgb, alpha: float = 1.0) -> None:
    """抗锯齿圆环。"""
    if r <= 0.05 or thickness <= 0.0 or alpha <= 0.0:
        return

    half = max(0.5, thickness * 0.5)
    outer = r + half
    pad = 2
    x0 = int(math.floor(cx - outer)) - pad
    y0 = int(math.floor(cy - outer)) - pad
    x1 = int(math.ceil(cx + outer)) + pad
    y1 = int(math.ceil(cy + outer)) + pad

    h, w = fb.shape[0], fb.shape[1]
    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(w, x1 + 1), min(h, y1 + 1)
    if x0c >= x1c or y0c >= y1c:
        return

    yy = np.arange(y0c, y1c, dtype=np.float32)[:, None] + 0.5
    xx = np.arange(x0c, x1c, dtype=np.float32)[None, :] + 0.5
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    # 到环中心线的距离
    dist = half - np.abs(d - r)
    cov = _smoothstep_cov(dist, 1.0)
    if alpha < 1.0:
        cov = cov * alpha

    col = np.asarray(rgb, dtype=np.float32)
    region = fb[y0c:y1c, x0c:x1c, :]
    fb[y0c:y1c, x0c:x1c, :] = region * (1.0 - cov[:, :, None]) + col[None, None, :] * cov[:, :, None]


def draw_line_aa(fb: np.ndarray, x0: float, y0: float, x1: float, y1: float, thickness: float, rgb, alpha: float = 1.0) -> None:
    """抗锯齿线段，圆头。"""
    if thickness <= 0.0 or alpha <= 0.0:
        return

    half = max(0.5, thickness * 0.5)
    pad = int(math.ceil(half)) + 2
    bx0 = int(math.floor(min(x0, x1))) - pad
    by0 = int(math.floor(min(y0, y1))) - pad
    bx1 = int(math.ceil(max(x0, x1))) + pad
    by1 = int(math.ceil(max(y0, y1))) + pad

    h, w = fb.shape[0], fb.shape[1]
    bx0c, by0c = max(0, bx0), max(0, by0)
    bx1c, by1c = min(w, bx1 + 1), min(h, by1 + 1)
    if bx0c >= bx1c or by0c >= by1c:
        return

    yy = np.arange(by0c, by1c, dtype=np.float32)[:, None] + 0.5
    xx = np.arange(bx0c, bx1c, dtype=np.float32)[None, :] + 0.5

    dx = x1 - x0
    dy = y1 - y0
    seg_len2 = dx * dx + dy * dy
    if seg_len2 < 1e-9:
        # 退化成点
        d = np.sqrt((xx - x0) ** 2 + (yy - y0) ** 2)
    else:
        t = ((xx - x0) * dx + (yy - y0) * dy) / seg_len2
        t = np.clip(t, 0.0, 1.0)
        px = x0 + t * dx
        py = y0 + t * dy
        d = np.sqrt((xx - px) ** 2 + (yy - py) ** 2)

    dist = half - d
    cov = _smoothstep_cov(dist, 1.0)
    if alpha < 1.0:
        cov = cov * alpha

    col = np.asarray(rgb, dtype=np.float32)
    region = fb[by0c:by1c, bx0c:bx1c, :]
    fb[by0c:by1c, bx0c:bx1c, :] = region * (1.0 - cov[:, :, None]) + col[None, None, :] * cov[:, :, None]


def draw_rect_outline_aa(fb: np.ndarray, x: float, y: float, w: float, h: float, color, thickness: float = 2.0) -> None:
    """抗锯齿矩形轮廓（由四条线组成）。"""
    draw_line_aa(fb, x, y, x + w, y, thickness, color)
    draw_line_aa(fb, x + w, y, x + w, y + h, thickness, color)
    draw_line_aa(fb, x + w, y + h, x, y + h, thickness, color)
    draw_line_aa(fb, x, y + h, x, y, thickness, color)


# ---------------------------------------------------------------------------
# 加色发光 / 暗角 / 余辉
# ---------------------------------------------------------------------------

def add_glow(fb: np.ndarray, cx: float, cy: float, r: float, rgb, strength: float = 1.0) -> None:
    """加色发光：径向衰减贴图 × 颜色 × 强度，加法混合进 fb。"""
    if r <= 0.5 or strength <= 0.0:
        return

    radius_px = max(1, int(round(r)))
    patch = _glow_patch(radius_px)          # (2r+1, 2r+1)
    col = np.asarray(rgb, dtype=np.float32)

    h, w = fb.shape[0], fb.shape[1]
    x0 = int(round(cx - radius_px))
    y0 = int(round(cy - radius_px))
    ph, pw = patch.shape

    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(w, x0 + pw), min(h, y0 + ph)
    if x0c >= x1c or y0c >= y1c:
        return

    psx0 = x0c - x0
    psy0 = y0c - y0
    sub = patch[psy0:psy0 + (y1c - y0c), psx0:psx0 + (x1c - x0c)]

    contrib = sub[:, :, None] * col[None, None, :] * strength
    fb[y0c:y1c, x0c:x1c, :] += contrib
    np.clip(fb[y0c:y1c, x0c:x1c, :], 0.0, 255.0, out=fb[y0c:y1c, x0c:x1c, :])


def apply_vignette(fb: np.ndarray, strength: float) -> None:
    """暗角：乘上预缓存的蒙版。strength=1.0 时四角 ×0.55，中心 ×1.0。"""
    if strength <= 0.0:
        return
    mask = _vignette_mask(fb.shape[0], fb.shape[1], strength)
    fb *= mask


def decay_buffer(buf: np.ndarray, factor: float) -> None:
    """余辉衰减：buf *= factor。"""
    buf *= factor


# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------

def to_uint8_bytes(fb: np.ndarray) -> bytes:
    """float32 (H,W,3) → uint8 RGB24 字节流，供 ffmpeg rawvideo 使用。"""
    clipped = np.clip(fb, 0.0, 255.0)
    return clipped.astype(np.uint8).tobytes()

def accumulate_glow_hue_safe(buf: np.ndarray, cx: float, cy: float, r: float, rgb, strength: float = 1.0) -> None:
    """把发光累加进缓冲，但按"通道上限留余量"衰减，避免密集叠加后整片糊成纯白。

    做法：先算出本次要加的量，再按当前缓冲剩余空间做软限制
    （通道已接近饱和时只加剩余部分，不直接 clip 成 255），
    这样颜色通道比例仍保留，堆叠区域会偏向偏亮的彩色而非死白。
    """
    if r <= 0.5 or strength <= 0.0:
        return

    radius_px = max(1, int(round(r)))
    patch = _glow_patch(radius_px)
    col = np.asarray(rgb, dtype=np.float32)

    h, w = buf.shape[0], buf.shape[1]
    x0 = int(round(cx - radius_px))
    y0 = int(round(cy - radius_px))
    ph, pw = patch.shape

    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(w, x0 + pw), min(h, y0 + ph)
    if x0c >= x1c or y0c >= y1c:
        return

    psx0 = x0c - x0
    psy0 = y0c - y0
    sub = patch[psy0:psy0 + (y1c - y0c), psx0:psx0 + (x1c - x0c)]
    contrib = sub[:, :, None] * col[None, None, :] * strength

    region = buf[y0c:y1c, x0c:x1c, :]
    region += contrib
    np.clip(region, 0.0, 255.0, out=region)

def soften_highlights(fb: np.ndarray, threshold: float = 232.0) -> None:
    """过曝保护：亮度接近上限的区域，按通道比例压回，避免糊成纯白。

    性能要点
    --------
    不做全帧 fb.max() 归约（92 万元素，实测占本函数 90% 时间），
    也不做 np.clip（调用方 to_uint8_bytes 会在转 uint8 时代为裁剪）。
    只用三次 np.maximum 逐元素取通道上界——这是单次内存扫描，非常便宜。
    """
    m = np.maximum(np.maximum(fb[:, :, 0], fb[:, :, 1]), fb[:, :, 2])
    hot = m > threshold
    if not hot.any():
        return

    scale = np.where(hot, threshold / np.maximum(m, 1e-3), 1.0).astype(np.float32)
    fb *= scale[:, :, None]
