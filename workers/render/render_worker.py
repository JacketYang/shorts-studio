#!/usr/bin/env python3
"""
Stateless Deterministic CPU Render Worker for Shorts Studio (docs 04 §3.3).
Reads a JSON payload { "spec": VideoSpec, "melody": MelodyEntry | null } and renders
a deterministic 1080x1920 30fps H.264 MP4 + synthesized event-driven audio using
pure Python stdlib + ffmpeg (no PIL/numpy/GPU/Chromium required).
"""

import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

# spec_params 与渲染器同目录；直接运行脚本时把目录加入 sys.path
_WORKER_DIR = os.path.dirname(os.path.abspath(__file__))
if _WORKER_DIR not in sys.path:
    sys.path.insert(0, _WORKER_DIR)

import numpy as np  # noqa: E402

import arc as arcmod  # noqa: E402
import fx as fxmod  # noqa: E402
import gfx  # noqa: E402
import text_layer as textmod  # noqa: E402
import theme as thememod  # noqa: E402
import spec_params  # noqa: E402
from spec_params import (  # noqa: E402
    load_params,
    resolve_pixels,
    derive_rng,
    TrailParams,
    BackgroundParams,
    CameraParams,
)





def midi_to_freq(midi: int) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def synthesize_wav(wav_path: str, duration_sec: float, events: list, sample_rate: int = 44100):
    total_samples = int(duration_sec * sample_rate)
    buf = [0.0] * total_samples

    for ev in events:
        midi = ev.get("midi")
        if midi is None:
            continue
        start_sample = int(ev["t"] * sample_rate)
        freq = midi_to_freq(int(midi))
        note_len = int(0.30 * sample_rate)
        amp = 0.28 * float(ev.get("intensity", 0.85))
        for i in range(note_len):
            idx = start_sample + i
            if idx >= total_samples:
                break
            t_local = i / sample_rate
            env = math.exp(-t_local * 10.5) * min(1.0, t_local / 0.004)
            sample = amp * env * (
                0.82 * math.sin(2.0 * math.pi * freq * t_local)
                + 0.14 * math.sin(2.0 * math.pi * freq * 2.0 * t_local)
                + 0.04 * math.sin(2.0 * math.pi * freq * 4.0 * t_local)
            )
            buf[idx] += sample

    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for s in buf:
            clamped = max(-0.92, min(0.92, s))
            frames += struct.pack("<h", int(clamped * 32767))
        wf.writeframes(bytes(frames))


def hex_to_rgb(hex_color: str, fallback=(56, 189, 248)):
    s = (hex_color or "").strip().lstrip("#")
    if len(s) != 6:
        return fallback
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except ValueError:
        return fallback


# ---------------------------------------------------------------------------
# 分辨率（T2：内部渲染尺寸可切换，输出仍由 ffmpeg 放大到成片尺寸）
# ---------------------------------------------------------------------------

RENDER_W = 720
RENDER_H = 1280
DRAFT_W = 540
DRAFT_H = 960

# 帧率无关的"相对画面宽度"比例常量
PAD_REL = 2.0          # 抗锯齿包围盒外扩（相对）

# 余辉拖尾默认衰减（spec 未给 fade 时）
DEFAULT_TRAIL_FADE = 0.86

# 球光晕与高光
GLOW_RADIUS_FACTOR = 3.2
GLOW_STRENGTH = 0.55
HIGHLIGHT_OFFSET = 0.30    # 相对球半径，偏左上
HIGHLIGHT_RADIUS = 0.25
HIGHLIGHT_ALPHA = 0.55

VIGNETTE_STRENGTH = 0.55


def set_render_size(width: int, height: int) -> None:
    """切换内部渲染尺寸（-draft 使用）。"""
    global RENDER_W, RENDER_H
    RENDER_W = int(width)
    RENDER_H = int(height)


# ---------------------------------------------------------------------------
# 背景（numpy 缓存）
# ---------------------------------------------------------------------------

def build_background(bg: BackgroundParams, w: int, h: int) -> "np.ndarray":
    """按 style.background 预生成背景缓存（float32 (H,W,3)）。

    - solid    : 纯 colors[0]
    - gradient : colors[0] → colors[1] 垂直渐变
    - grid     : 渐变底 + 间距 6% 画面宽的网格线，网格处亮度 ×1.06
    """
    colors = bg.colors or ["#05060F"]
    top = hex_to_rgb(colors[0], (7, 11, 24))

    if bg.type == "solid" or len(colors) < 2:
        fb = gfx.new_frame(h, w, top)
    else:
        bottom = hex_to_rgb(colors[1], (7, 11, 24))
        fb = gfx.fill_gradient(h, w, top, bottom)

    if bg.type == "grid":
        spacing = max(3, int(round(w * 0.06)))
        fb[:, ::spacing, :] = np.minimum(255.0, fb[:, ::spacing, :] * 1.06)
        fb[::spacing, :, :] = np.minimum(255.0, fb[::spacing, :, :] * 1.06)

    return fb


# ---------------------------------------------------------------------------
# 摄像机
# ---------------------------------------------------------------------------

def zoom_at(scale: float, x: float, y: float, cx: float = None, cy: float = None):
    """以画面中心为原点做缩放，返回缩放后的坐标。"""
    if cx is None:
        cx = RENDER_W * 0.5
    if cy is None:
        cy = RENDER_H * 0.5
    return (cx + (x - cx) * scale, cy + (y - cy) * scale)


def frame_zoom(cam: CameraParams, t: float, duration: float) -> float:
    """zoom_from → zoom_to 在整段时长内线性插值。"""
    if duration <= 0 or not cam.animates:
        return cam.zoom_from
    k = min(1.0, max(0.0, t / duration))
    return cam.zoom_from + (cam.zoom_to - cam.zoom_from) * k


def zoom_rect(scale: float, x: float, y: float) -> tuple:
    return zoom_at(scale, x, y)


# ---------------------------------------------------------------------------
# 余辉拖尾缓冲
# ---------------------------------------------------------------------------

class TrailBuffer:
    """持久余辉缓冲：每帧衰减，再把本帧发光圆加色写入。"""

    def __init__(self, h: int, w: int):
        # 注：实测 float16 反而更慢（float16↔float32 转换开销大于带宽收益），保持 float32
        self.buf = np.zeros((h, w, 3), dtype=np.float32)

    def decay(self, factor: float) -> None:
        self.buf *= factor

    def clear(self) -> None:
        self.buf.fill(0.0)

    def stamp(self, cx: float, cy: float, r: float, rgb, strength: float) -> None:
        """把发光圆写进余辉缓冲（带软饱和，避免密集叠加糊成纯白）。"""
        gfx.accumulate_glow_hue_safe(self.buf, cx, cy, r, rgb, strength)


def scale_brightness_local(rgb, factor: float):
    """按比例调整亮度（用于太阳本体比主题色略亮）。"""
    return tuple(max(0, min(255, int(c * factor))) for c in rgb)


def draw_ball(fb, cx: float, cy: float, r: float, rgb, z: float = 1.0,
              glow_scale: float = 1.0) -> None:
    """画一个球：光晕 + 本体 + 左上高光。glow_scale 用于球多时降低发光避免发白。"""
    # 光晕（加色，带软饱和保护）
    _glow_r = r * GLOW_RADIUS_FACTOR * (0.6 + 0.4 * glow_scale)
    gfx.accumulate_glow_hue_safe(fb, cx, cy, _glow_r, rgb, GLOW_STRENGTH * glow_scale)
    # 本体（抗锯齿实心圆）
    gfx.draw_disc_aa(fb, cx, cy, r, rgb)
    # 高光：偏左上 30% 半径，半径 25%，白色 alpha 0.55
    hx = cx - r * HIGHLIGHT_OFFSET
    hy = cy - r * HIGHLIGHT_OFFSET
    gfx.draw_disc_aa(fb, hx, hy, max(0.8, r * HIGHLIGHT_RADIUS), (255, 255, 255), HIGHLIGHT_ALPHA)



# ---------------------------------------------------------------------------
# 帧合成（预分配缓冲，避免每帧多次分配 11MB 数组）
# ---------------------------------------------------------------------------

class FrameComposer:
    """复用 float32 / uint8 缓冲，避免每帧重复分配大数组。"""

    def __init__(self, h: int, w: int):
        self.out_f = np.empty((h, w, 3), dtype=np.float32)
        self.shift_tmp = np.empty((h, w, 3), dtype=np.float32)
        self.out_u8 = np.empty((h, w, 3), dtype=np.uint8)
        self.w = w
        self.h = h

    def render(
        self,
        fb: np.ndarray,
        trail_buf: np.ndarray | None,
        shift: tuple = (0.0, 0.0),
        bg: np.ndarray | None = None,
    ) -> np.ndarray:
        """合成基础画面（含拖尾与震屏），返回 float32 帧供文字层叠加。

        T6：文字必须在过曝保护之后、转 uint8 之前叠加，
        所以拆成 render() + finish() 两步。
        """
        np.copyto(self.out_f, fb)
        if trail_buf is not None:
            self.out_f += trail_buf

        dx, dy = shift
        if abs(dx) >= 0.5 or abs(dy) >= 0.5:
            self._shift(self.out_f, int(round(dx)), int(round(dy)), bg)

        # 过曝保护：每帧只做一次，保留密集区域的色相而不是糊成死白
        gfx.soften_highlights(self.out_f)
        np.clip(self.out_f, 0.0, 255.0, out=self.out_f)
        return self.out_f

    def finish(self, frame: np.ndarray) -> bytes:
        """把已叠加文字的 float32 帧转为 uint8 RGB24 字节流。"""
        np.clip(frame, 0.0, 255.0, out=frame)
        np.copyto(self.out_u8, frame, casting="unsafe")
        return self.out_u8.tobytes()

    def compose(
        self,
        fb: np.ndarray,
        trail_buf: np.ndarray | None,
        shift: tuple = (0.0, 0.0),
        bg: np.ndarray | None = None,
    ) -> bytes:
        """无文字时的便捷路径（保留给未来复用）。"""
        return self.finish(self.render(fb, trail_buf, shift, bg))

    def _shift(self, buf: np.ndarray, dx: int, dy: int, bg: np.ndarray | None) -> None:
        """整体平移 buf，(dx, dy)；空出的边缘用背景色填充。"""
        h, w = buf.shape[0], buf.shape[1]
        sx = max(0, min(w, dx))
        sy = max(0, min(h, dy))

        np.copyto(self.shift_tmp, buf)
        tmp = self.shift_tmp
        # 先用背景铺满
        if bg is not None:
            np.copyto(buf, bg)
        else:
            buf.fill(0.0)

        if sx < w and sy < h and (w - sx) > 0 and (h - sy) > 0:
            buf[sy:h, sx:w] = tmp[0:h - sy, 0:w - sx]


def _emit_event(events: list, spec: dict, t: float, midi: int, intensity: float) -> bool:
    """T5：drop preset 的蓄力静默窗内抑制所有音频事件。

    返回 True 表示已写入。物理与事件时刻不受影响，只是"不发声"。
    """
    if arcmod.is_drop_silence(spec, t):
        return False
    events.append({"t": t, "midi": midi, "intensity": intensity})
    return True


def simulate_and_render_frames(spec: dict, melody: dict | None, proc: subprocess.Popen):
    """渲染所有帧并把 RGB24 数据写进 ffmpeg 的 stdin，返回音频事件列表。

    T2：内部改为 numpy float32 帧缓冲 + 抗锯齿 + 加色发光 + 余辉拖尾。
    物理逻辑与参数含义与 T1 完全一致，只替换绘图底层。
    """
    P = resolve_pixels(load_params(spec), RENDER_W, RENDER_H)
    for w in P.warnings:
        print(f"[render] warning: {w}", file=sys.stderr)

    W, H = RENDER_W, RENDER_H
    fps = P.fps
    duration = P.duration_sec
    total_frames = max(1, int(fps * duration))
    dt = 1.0 / fps

    # T4：统一视觉主题（渐变背景 + bokeh 光斑 + 配色 + 墙体/文字色）
    theme_rng = derive_rng(P.seed, "theme")
    theme = thememod.get_theme(spec, W, H, theme_rng)

    accent_rgbs = list(theme.palette)
    if not accent_rgbs:
        accent_rgbs = [(56, 189, 248), (244, 114, 182), (251, 191, 36)]

    # T6：文字层（在最终合成阶段叠加，不写入 trail_buffer）
    text_layer = textmod.TextLayer(spec, W, H, accent_rgbs, duration)
    # HUD 统计：各模板在循环里更新
    hud_stats = {"balls": 0, "notes": 0, "bounces": 0, "bins_filled": 0}

    # 背景缓存：整段只生成一次（渐变 + 光斑）
    bg_cache = theme.build_background()

    # 旋律音高 + transpose（半音）
    notes = []
    if melody and melody.get("tracks"):
        notes = [int(n["pitch"]) + P.audio.transpose for n in melody["tracks"][0]["notes"]]
    if not notes:
        notes = [60, 62, 64, 67, 69, 72]
        notes = [n + P.audio.transpose for n in notes]

    trail_cfg = P.style.trail
    trail_fade = trail_cfg.fade if trail_cfg.fade > 0 else DEFAULT_TRAIL_FADE
    trail_on = trail_cfg.enabled and trail_cfg.length_frames > 0
    trail_buf = TrailBuffer(H, W)

    cam = P.style.camera

    # T3：视觉反馈系统（粒子/涟漪/闪光/震屏）。level=0 时全为空操作。
    fx_cfg = fxmod.parse_fx(P.style.fx)
    # T5：粒子数量倍率 0.6 + 0.8*I 在 spawn 时通过 fx_sys.particle_scale 生效
    fx_sys_particle_scale = 1.0
    fx_rng = derive_rng(P.seed, "fx")
    fx_sys = fxmod.FxSystem(fx_cfg, fx_rng, W, H)

    # T5：强度曲线。I(t) 只影响强度类参数，不改物理/随机序列。
    arc_cfg = arcmod.parse_arc(spec)
    _fired_beats: dict = {}
    _fired_burst = False

    composer = FrameComposer(H, W)
    work_frame = np.empty((H, W, 3), dtype=np.float32)
    events = []
    note_idx = 0

    # 线宽/半径的"相对画面宽度"比例（分辨率无关）
    def rel(v: float) -> float:
        return v * W

    # =====================================================================
    # pendulum-wave
    # =====================================================================
    if P.template == "pendulum-wave":
        pd = P.pendulum
        count = pd.count
        max_angle = math.radians(pd.max_angle_deg)
        damping = pd.damping
        cycle_sec = pd.cycle_sec
        rule_type = pd.rule_type

        pivot_x = W * 0.5
        pivot_y = H * 0.20
        prev_thetas = [0.0] * count
        bob_r = rel(0.013)
        # T4：中线闪光记录 (y, t0, color)
        _flash_ys: list = []
        _last_flash_t = -1e9
        FLASH_LIFE = 0.12
        # T4：长拖尾光幕（fade 0.92），独立于 spec.trail
        ghost_buf = np.zeros((H, W, 3), dtype=np.float32)
        GHOST_FADE = 0.92

        for f_idx in range(total_frames):
            t = f_idx * dt
            # T5：强度曲线
            _I = arcmod.intensity_of(arc_cfg, t)
            _hp = arcmod.hook_peek_factor(spec, t)
            _eff_I = min(1.0, _I + 0.25 * _hp)
            fx_sys.particle_scale = arcmod.particle_mult(_eff_I) * (1.0 + 0.5 * _hp)
            # T5：drop 蓄力段画面同样安静下来（抑制新粒子与涟漪）
            fx_sys.silenced = arcmod.is_drop_silence(spec, t)
            z = frame_zoom(cam, t, duration) * arcmod.zoom_mult(_eff_I) * (1.0 + 0.08 * _hp)
            np.copyto(work_frame, bg_cache)
            # T5：背景亮度倍率 0.9 + 0.2*I（hook_peek 期间 +15%）
            work_frame *= arcmod.bg_brightness_mult(_eff_I) * (1.0 + 0.15 * _hp)
            fb = work_frame

            if trail_on:
                trail_buf.decay(trail_fade)
            else:
                trail_buf.clear()

            # T4：光幕缓冲衰减
            ghost_buf *= GHOST_FADE

            # 中枢参考线与顶部枢轴横杆
            p0 = zoom_at(z, pivot_x, pivot_y)
            p1 = zoom_at(z, pivot_x, H * 0.84)
            gfx.draw_line_aa(fb, p0[0], p0[1], p1[0], p1[1], 1.0, (51, 65, 85))
            b0 = zoom_at(z, W * 0.2, pivot_y)
            b1 = zoom_at(z, W * 0.8, pivot_y)
            gfx.draw_line_aa(fb, b0[0], b0[1], b1[0], b1[1], 2.0, (148, 163, 184))

            damp_factor = math.exp(-damping * t)
            for i in range(count):
                osc_count = 12 + (i * 1.5 if rule_type == "phase_flip" else i)
                omega = (2.0 * math.pi * osc_count) / cycle_sec
                pulse_mod = (1.0 + 0.08 * math.sin(t * 2.1)) if rule_type == "gravity_pulse" else 1.0
                theta = max_angle * damp_factor * math.cos(omega * t * pulse_mod - 1.15)
                pend_len = min(0.62, pd.length_min + i * pd.length_step) * H
                raw_x = pivot_x + math.sin(theta) * pend_len * 0.48
                raw_y = pivot_y + math.cos(theta) * pend_len
                # T4：摆球颜色沿序号做调色板渐变（不是循环取色）
                col = thememod.palette_gradient(accent_rgbs, i / max(1, count - 1))
                sx, sy = zoom_at(z, raw_x, raw_y)
                sx_pre, sy_pre = sx, sy

                if f_idx > 0:
                    if P.note_trigger.on == "peak_reversal":
                        prev_abs = abs(prev_thetas[i])
                        trigger = (
                            abs(theta) > prev_abs
                            and f_idx > 1
                            and abs(theta) > max_angle * 0.55 * damp_factor
                        )
                    else:
                        trigger = (prev_thetas[i] < 0 <= theta) or (prev_thetas[i] > 0 >= theta)
                    if trigger:
                        _emit_event(events, spec, t, notes[note_idx % len(notes)], 0.78)
                        note_idx += 1
                        hud_stats["notes"] = note_idx
                        # T3: 过中线 0.5；本帧所有摆同时过零视为"全体对齐" 1.0
                        fx_sys.spawn(t, sx_pre, sy_pre, 0.5, col, palette=accent_rgbs)
                        # T4：中线对应位置出现短促垂直闪光线
                        _fl = max(0.0, 1.0 - (t - _last_flash_t) / 0.12)
                        if _fl <= 0.0:
                            _last_flash_t = t
                            _flash_ys.append((sy_pre, t, col))
                prev_thetas[i] = theta

                l0 = zoom_at(z, pivot_x, pivot_y)
                l1 = zoom_at(z, raw_x, raw_y)
                # T4：摆线透明度 0.35
                gfx.draw_line_aa(fb, l0[0], l0[1], l1[0], l1[1], 1.0, theme.ui_color, 0.35)

                sr = bob_r * z
                if trail_on:
                    trail_buf.stamp(sx, sy, sr * GLOW_RADIUS_FACTOR, col, GLOW_STRENGTH)
                # T4：写入"光幕"缓冲，形成长拖尾
                gfx.accumulate_glow_hue_safe(ghost_buf, sx, sy, sr * 2.6, col, 0.55)
                draw_ball(fb, sx, sy, sr * fx_sys.pop_scale(("pend", i), t), col, z)

            # T4：中线闪光（短促垂直光线）
            _flash_ys = [f for f in _flash_ys if t - f[1] < FLASH_LIFE]
            for _fy, _ft, _fc in _flash_ys:
                _fk = 1.0 - (t - _ft) / FLASH_LIFE
                _fx0, _fy0 = zoom_at(z, pivot_x, _fy - rel(0.05) * _fk)
                _fx1, _fy1 = zoom_at(z, pivot_x, _fy + rel(0.05) * _fk)
                gfx.draw_line_aa(fb, _fx0, _fy0, _fx1, _fy1,
                                 max(1.0, rel(0.004)), _fc, 0.85 * _fk)

            # T5：arc 特殊事件
            # countdown：每段开头 0.15 秒内的节拍点 → 全屏闪光 + tick 音频事件
            for _bp in arcmod.beat_points(spec):
                if _bp <= t < _bp + 0.15 and not _fired_beats.get(round(_bp, 3)):
                    _fired_beats[round(_bp, 3)] = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    _emit_event(events, spec, t, notes[note_idx % len(notes)], 1.0)
                    note_idx += 1

            # drop：u=0.40 爆发一次 —— 闪光 + 震屏 + 粒子大爆发
            if arc_cfg.preset == "drop" and not _fired_burst:
                if arcmod.is_drop_burst(spec, t):
                    _fired_burst = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    fxmod.celebrate_bin(fx_sys, t, W * 0.5, H * 0.5,
                                        accent_rgbs[0], accent_rgbs, 30)

            # T3 视觉反馈：推进生命周期 → 叠加各层效果
            fx_sys.update(t, dt)
            fx_sys.apply_background_flash(fb)
            fx_sys.draw_ripples(fb, t)
            fx_sys.draw_particles(fb, t)
            gfx.apply_vignette(fb, fx_cfg.vignette)
            _dx, _dy = fx_sys.shake_offset(t)
            # T4：叠加光幕拖尾
            _comp = trail_buf.buf if trail_on else None
            if _comp is None:
                _comp = ghost_buf
            else:
                _comp = _comp + ghost_buf
            _out = composer.render(fb, _comp, shift=(_dx, _dy), bg=bg_cache)
            # T6：文字在最后一步叠加，不进入 trail_buffer
            text_layer.draw(_out, t, hud_stats)
            proc.stdin.write(composer.finish(_out))

    # =====================================================================
    # orbit-sync
    # =====================================================================
    elif P.template == "orbit-sync":
        ob = P.orbits
        count = ob.count
        base_r = ob.base_radius
        step_r = ob.radius_step
        base_omega = ob.base_omega
        res_ratio = ob.resonance_ratio
        rule_type = ob.rule_type
        trig_rad = math.radians(ob.trigger_angle_deg)

        cx, cy = W * 0.5, H * 0.50
        prev_angles = [trig_rad - 0.16 - i * 0.07 for i in range(count)]
        planet_r = rel(0.012)

        for f_idx in range(total_frames):
            t = f_idx * dt
            # T5：强度曲线
            _I = arcmod.intensity_of(arc_cfg, t)
            _hp = arcmod.hook_peek_factor(spec, t)
            _eff_I = min(1.0, _I + 0.25 * _hp)
            fx_sys.particle_scale = arcmod.particle_mult(_eff_I) * (1.0 + 0.5 * _hp)
            # T5：drop 蓄力段画面同样安静下来（抑制新粒子与涟漪）
            fx_sys.silenced = arcmod.is_drop_silence(spec, t)
            z = frame_zoom(cam, t, duration) * arcmod.zoom_mult(_eff_I) * (1.0 + 0.08 * _hp)
            np.copyto(work_frame, bg_cache)
            # T5：背景亮度倍率 0.9 + 0.2*I（hook_peek 期间 +15%）
            work_frame *= arcmod.bg_brightness_mult(_eff_I) * (1.0 + 0.15 * _hp)
            fb = work_frame

            if trail_on:
                trail_buf.decay(trail_fade)
            else:
                trail_buf.clear()

            beam_r = W * 0.46
            # T4：中心"太阳"呼吸 ±8%（以 3Hz 节拍为参考）
            _sun_breath = 1.0 + 0.08 * math.sin(t * 2.0 * math.pi * 3.0)
            scx, scy = zoom_at(z, cx, cy)
            bex, bey = zoom_at(z, cx + math.cos(trig_rad) * beam_r, cy + math.sin(trig_rad) * beam_r)
            gfx.draw_line_aa(fb, scx, scy, bex, bey, 2.0, (226, 232, 240))
            # T4：太阳外发光 + 呼吸本体
            gfx.add_glow(fb, scx, scy, rel(0.045) * z * _sun_breath, theme.ui_color, 0.55)
            gfx.draw_disc_aa(fb, scx, scy, rel(0.012) * z * _sun_breath,
                             scale_brightness_local(theme.ui_color, 1.15))

            pulse = (1.0 + 0.06 * math.sin(t * 3.0)) if rule_type == "pulse_rings" else 1.0

            for i in range(count):
                direction = -1.0 if (rule_type == "reverse_outer" and i >= count // 2) else 1.0
                omega = direction * base_omega * (1.0 + i * res_ratio)
                angle = trig_rad - 0.16 - i * 0.07 + omega * t
                ring_r = min(0.44, base_r + i * step_r) * W * pulse
                col = accent_rgbs[i % len(accent_rgbs)]
                # T4：轨道环透明度 0.18 的细环
                gfx.draw_ring_aa(fb, scx, scy, ring_r * z, max(1.0, rel(0.004)),
                                 theme.ui_color, 0.18)

                if f_idx > 0:
                    prev_k = math.floor((prev_angles[i] - trig_rad) / (2.0 * math.pi))
                    curr_k = math.floor((angle - trig_rad) / (2.0 * math.pi))
                    if prev_k != curr_k:
                        _emit_event(events, spec, t, notes[note_idx % len(notes)], 0.82)
                        note_idx += 1
                        hud_stats["notes"] = note_idx
                        # T3: 过光束 0.6
                        fx_sys.spawn(t, ox_pre, oy_pre, 0.6, col, palette=accent_rgbs)
                        # T4：光束在该位置爆一个闪光点
                        _bvx = cx + math.cos(trig_rad) * ring_r
                        _bvy = cy + math.sin(trig_rad) * ring_r
                        _bsx, _bsy = zoom_at(z, _bvx, _bvy)
                        gfx.add_glow(fb, _bsx, _bsy, rel(0.030) * z, col, 0.9)
                prev_angles[i] = angle

                raw_x = cx + math.cos(angle) * ring_r
                raw_y = cy + math.sin(angle) * ring_r
                sx, sy = zoom_at(z, raw_x, raw_y)
                ox_pre, oy_pre = sx, sy
                sr = planet_r * z

                # T4：行星各自拖尾弧线（沿最近若干个历史角度）
                for _tk in range(1, 7):
                    _ta = angle - omega * dt * _tk * 1.6
                    _trx = cx + math.cos(_ta) * ring_r
                    _try_ = cy + math.sin(_ta) * ring_r
                    _tsx, _tsy = zoom_at(z, _trx, _try_)
                    _tk_fade = 0.42 * (1.0 - _tk / 7.0)
                    gfx.draw_disc_aa(fb, _tsx, _tsy, max(0.8, sr * (0.85 - 0.09 * _tk)),
                                     col, _tk_fade)

                if trail_on:
                    trail_buf.stamp(sx, sy, sr * GLOW_RADIUS_FACTOR, col, GLOW_STRENGTH)
                draw_ball(fb, sx, sy, sr * fx_sys.pop_scale(("planet", i), t), col, z)

            # T5：arc 特殊事件
            # countdown：每段开头 0.15 秒内的节拍点 → 全屏闪光 + tick 音频事件
            for _bp in arcmod.beat_points(spec):
                if _bp <= t < _bp + 0.15 and not _fired_beats.get(round(_bp, 3)):
                    _fired_beats[round(_bp, 3)] = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    _emit_event(events, spec, t, notes[note_idx % len(notes)], 1.0)
                    note_idx += 1

            # drop：u=0.40 爆发一次 —— 闪光 + 震屏 + 粒子大爆发
            if arc_cfg.preset == "drop" and not _fired_burst:
                if arcmod.is_drop_burst(spec, t):
                    _fired_burst = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    fxmod.celebrate_bin(fx_sys, t, W * 0.5, H * 0.5,
                                        accent_rgbs[0], accent_rgbs, 30)

            # T3 视觉反馈：推进生命周期 → 叠加各层效果
            fx_sys.update(t, dt)
            fx_sys.apply_background_flash(fb)
            fx_sys.draw_ripples(fb, t)
            fx_sys.draw_particles(fb, t)
            gfx.apply_vignette(fb, fx_cfg.vignette)
            _dx, _dy = fx_sys.shake_offset(t)
            _out = composer.render(fb, trail_buf.buf if trail_on else None,
                                   shift=(_dx, _dy), bg=bg_cache)
            # T6：文字在最后一步叠加，不进入 trail_buffer
            text_layer.draw(_out, t, hud_stats)
            proc.stdin.write(composer.finish(_out))

    # =====================================================================
    # ball-sort
    # =====================================================================
    elif P.template == "ball-sort":
        bs = P.bin_sort
        bin_rgbs = [hex_to_rgb(c) for c in bs.colors]
        num_bins = bs.bin_count
        ball_count = bs.ball_count

        peg_rng = derive_rng(P.seed, "pegs")
        pegs = []
        for row in range(bs.peg_rows):
            cols = 5 if row % 2 == 0 else 4
            py = 0.34 + row * (0.40 / max(1, bs.peg_rows))
            for col in range(cols):
                px = 0.22 + (col + (0.5 if row % 2 == 1 else 0.0)) * 0.14
                if bs.peg_jitter > 0:
                    px += peg_rng.uniform(-bs.peg_jitter, bs.peg_jitter) * 0.02
                    py += peg_rng.uniform(-bs.peg_jitter, bs.peg_jitter) * 0.02
                pegs.append((px, py))

        bin_w = (W - rel(0.12)) / num_bins
        bin_left = rel(0.06)
        bin_positions = []
        for b in range(num_bins):
            bx = bin_left + b * bin_w
            if bs.layout == "stepped":
                by = 0.755 * H + b * (0.055 * H / max(1, num_bins - 1))
            else:
                by = 0.79 * H
            bin_positions.append((bx, by))

        moving_gate = bs.gate_moving
        gate_period = bs.gate_period_s

        active_balls = []
        spawn_interval = max(4, total_frames // (ball_count + 4))
        bin_counts = [0] * num_bins
        # T4：钉子受击记录 {peg_index: t_hit}，亮度 1.0 后 0.3s 衰减到 0.45
        peg_hits: dict = {}
        PEG_BASE = 0.45
        PEG_DECAY = 0.30
        BIN_FULL = max(1, ball_count // num_bins)
        ball_r = rel(0.020)
        peg_r = rel(0.011)
        bin_h = 0.13 * H

        for f_idx in range(total_frames):
            t = f_idx * dt
            # T5：强度曲线
            _I = arcmod.intensity_of(arc_cfg, t)
            _hp = arcmod.hook_peek_factor(spec, t)
            _eff_I = min(1.0, _I + 0.25 * _hp)
            fx_sys.particle_scale = arcmod.particle_mult(_eff_I) * (1.0 + 0.5 * _hp)
            # T5：drop 蓄力段画面同样安静下来（抑制新粒子与涟漪）
            fx_sys.silenced = arcmod.is_drop_silence(spec, t)
            z = frame_zoom(cam, t, duration) * arcmod.zoom_mult(_eff_I) * (1.0 + 0.08 * _hp)
            np.copyto(work_frame, bg_cache)
            # T5：背景亮度倍率 0.9 + 0.2*I（hook_peek 期间 +15%）
            work_frame *= arcmod.bg_brightness_mult(_eff_I) * (1.0 + 0.15 * _hp)
            fb = work_frame

            if trail_on:
                trail_buf.decay(trail_fade)
            else:
                trail_buf.clear()

            if f_idx % spawn_interval == 0 and len(active_balls) < ball_count:
                color_idx = len(active_balls) % num_bins
                active_balls.append({
                    "x": 0.5 + peg_rng.uniform(-0.04, 0.04),
                    "y": 0.18,
                    "vx": peg_rng.uniform(-0.08, 0.08),
                    "vy": 0.12,
                    "cidx": color_idx,
                    "settled": False,
                })

            # 漏斗
            fl0 = zoom_at(z, 0.36 * W, 0.16 * H)
            fl1 = zoom_at(z, 0.45 * W, 0.26 * H)
            fr0 = zoom_at(z, 0.64 * W, 0.16 * H)
            fr1 = zoom_at(z, 0.55 * W, 0.26 * H)
            gfx.draw_line_aa(fb, fl0[0], fl0[1], fl1[0], fl1[1], rel(0.006), (148, 163, 184))
            gfx.draw_line_aa(fb, fr0[0], fr0[1], fr1[0], fr1[1], rel(0.006), (148, 163, 184))

            for _pi, (px, py) in enumerate(pegs):
                sx, sy = zoom_at(z, px * W, py * H)
                # T4：默认亮度 0.45；受击后跳到 1.0，0.3s 内衰减回 0.45
                _hit = peg_hits.get(_pi)
                if _hit is not None:
                    _age = t - _hit
                    if _age >= PEG_DECAY:
                        _b = PEG_BASE
                        peg_hits.pop(_pi, None)
                    else:
                        _k = 1.0 - _age / PEG_DECAY
                        _b = PEG_BASE + (1.0 - PEG_BASE) * _k
                        gfx.add_glow(fb, sx, sy, peg_r * z * 4.0, theme.ui_color, 0.5 * _k)
                else:
                    _b = PEG_BASE
                _pcol = tuple(min(255, int(c * _b)) for c in theme.ui_color)
                gfx.draw_disc_aa(fb, sx, sy, peg_r * z, _pcol)

            # 桶：半透明玻璃感（填充 α0.12 + 亮边线），堆积越高发光越强
            for _bi in range(num_bins):
                bx, by = bin_positions[_bi]
                _bcolor = bin_rgbs[_bi % len(bin_rgbs)]
                _fill_ratio = min(1.0, bin_counts[_bi] / BIN_FULL)
                o0 = zoom_at(z, bx + rel(0.006), by)
                _bw = (bin_w - rel(0.012)) * z
                _bh = bin_h * z

                # 玻璃填充
                x0 = int(max(0, o0[0]))
                y0 = int(max(0, o0[1]))
                x1 = int(min(W, o0[0] + _bw))
                y1 = int(min(H, o0[1] + _bh))
                if x1 > x0 and y1 > y0:
                    region = fb[y0:y1, x0:x1, :]
                    region += (np.asarray(_bcolor, dtype=np.float32)[None, None, :] - region) * 0.12

                # 装满程度越高的桶，发光越强
                if _fill_ratio > 0.01:
                    gfx.add_glow(fb, o0[0] + _bw * 0.5, o0[1] + _bh * 0.5,
                                 max(_bw, _bh) * 0.55, _bcolor, 0.35 * _fill_ratio)

                gfx.draw_rect_outline_aa(fb, o0[0], o0[1], _bw, _bh, _bcolor,
                                         max(1.0, rel(0.005)))

            # 移动挡板
            gate_x_norm = None
            if moving_gate:
                phase = (t % gate_period) / gate_period
                gate_x_norm = 0.30 + 0.40 * (0.5 - 0.5 * math.cos(phase * 2.0 * math.pi))
                g0 = zoom_at(z, gate_x_norm * W, 0.60 * H)
                g1 = zoom_at(z, gate_x_norm * W, 0.66 * H)
                gfx.draw_line_aa(fb, g0[0], g0[1], g1[0], g1[1], rel(0.010), (226, 232, 240))

            for b_obj in active_balls:
                if not b_obj["settled"]:
                    b_obj["vy"] += 0.65 * dt
                    b_obj["x"] += b_obj["vx"] * dt
                    b_obj["y"] += b_obj["vy"] * dt

                    if moving_gate and 0.595 < b_obj["y"] < 0.665:
                        if abs(b_obj["x"] - gate_x_norm) < 0.035:
                            b_obj["vx"] += (0.6 if b_obj["x"] > gate_x_norm else -0.6) * 0.12
                            b_obj["vy"] = max(b_obj["vy"], 0.02)

                    if b_obj["x"] < 0.12:
                        b_obj["x"] = 0.12
                        b_obj["vx"] = abs(b_obj["vx"]) * 0.85
                    elif b_obj["x"] > 0.88:
                        b_obj["x"] = 0.88
                        b_obj["vx"] = -abs(b_obj["vx"]) * 0.85

                    for _pi, (px, py) in enumerate(pegs):
                        dx, dy = b_obj["x"] - px, b_obj["y"] - py
                        d = math.hypot(dx, dy)
                        if 0 < d < 0.03:
                            peg_hits[_pi] = t
                            nx, ny = dx / d, dy / d
                            b_obj["x"] = px + nx * 0.031
                            b_obj["y"] = py + ny * 0.031
                            dot = b_obj["vx"] * nx + b_obj["vy"] * ny
                            if dot < 0:
                                b_obj["vx"] -= 1.65 * dot * nx
                                b_obj["vy"] -= 1.65 * dot * ny
                                _emit_event(events, spec, t, notes[note_idx % len(notes)], 0.65)
                                note_idx += 1
                                hud_stats["notes"] = note_idx
                                # T3: 钉子碰撞 0.4
                                px_s, py_s = zoom_at(z, px * W, py * H)
                                fx_sys.spawn(t, px_s, py_s, 0.4,
                                             bin_rgbs[b_obj["cidx"] % len(bin_rgbs)],
                                             palette=bin_rgbs)

                    if b_obj["y"] > 0.72:
                        target_x = (bin_left + (b_obj["cidx"] + 0.5) * bin_w) / W
                        b_obj["vx"] += (target_x - b_obj["x"]) * 6.0 * dt

                    settle_y = bin_positions[b_obj["cidx"]][1] / H + 0.09
                    if b_obj["y"] >= settle_y:
                        b_obj["settled"] = True
                        slot = b_obj["cidx"]
                        stack_idx = bin_counts[slot]
                        bin_counts[slot] += 1
                        b_obj["x"] = (bin_left + (slot + 0.5) * bin_w + ((stack_idx % 3) - 1) * rel(0.026)) / W
                        b_obj["y"] = settle_y + 0.01 - (stack_idx // 3) * 0.024
                        _emit_event(events, spec, t, notes[note_idx % len(notes)], 0.95)
                        note_idx += 1
                        hud_stats["notes"] = note_idx
                        # T3: 入桶 0.9；整桶满（该桶第 5 个）额外 1.0
                        bx_s, by_s = zoom_at(z, b_obj["x"] * W, b_obj["y"] * H)
                        _bcol = bin_rgbs[b_obj["cidx"] % len(bin_rgbs)]
                        fx_sys.spawn(t, bx_s, by_s, 0.9, _bcol, palette=bin_rgbs,
                                     ball_key=("bin", b_obj["cidx"]))
                        # T4：整桶庆祝——该桶达到 球数/桶数 时触发一次
                        if bin_counts[slot] == BIN_FULL:
                            fxmod.celebrate_bin(fx_sys, t, bx_s, by_s, _bcol, bin_rgbs, 30)

                sx, sy = zoom_at(z, b_obj["x"] * W, b_obj["y"] * H)
                sr = ball_r * z
                col = bin_rgbs[b_obj["cidx"] % len(bin_rgbs)]

                # T4：飞行中保留速度方向的 3 点拉伸（速度越快越长）
                if not b_obj["settled"]:
                    _spd = math.hypot(b_obj["vx"], b_obj["vy"])
                    _stretch = min(3.2, 1.0 + _spd * 6.0)
                    for _si in (1, 2):
                        _k = _si / 3.0
                        _tx = b_obj["x"] - b_obj["vx"] * dt * _k * _stretch
                        _ty = b_obj["y"] - b_obj["vy"] * dt * _k * _stretch
                        _tsx, _tsy = zoom_at(z, _tx * W, _ty * H)
                        gfx.draw_disc_aa(fb, _tsx, _tsy, sr * (1.0 - 0.22 * _k), col, 0.55 - 0.15 * _k)

                if trail_on:
                    trail_buf.stamp(sx, sy, sr * GLOW_RADIUS_FACTOR, col, GLOW_STRENGTH)
                draw_ball(fb, sx, sy, sr * fx_sys.pop_scale(("bin", b_obj["cidx"]), t), col, z)

            # T5：arc 特殊事件
            # countdown：每段开头 0.15 秒内的节拍点 → 全屏闪光 + tick 音频事件
            for _bp in arcmod.beat_points(spec):
                if _bp <= t < _bp + 0.15 and not _fired_beats.get(round(_bp, 3)):
                    _fired_beats[round(_bp, 3)] = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    _emit_event(events, spec, t, notes[note_idx % len(notes)], 1.0)
                    note_idx += 1

            # drop：u=0.40 爆发一次 —— 闪光 + 震屏 + 粒子大爆发
            if arc_cfg.preset == "drop" and not _fired_burst:
                if arcmod.is_drop_burst(spec, t):
                    _fired_burst = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    fxmod.celebrate_bin(fx_sys, t, W * 0.5, H * 0.5,
                                        accent_rgbs[0], accent_rgbs, 30)

            # T3 视觉反馈：推进生命周期 → 叠加各层效果
            fx_sys.update(t, dt)
            fx_sys.apply_background_flash(fb)
            fx_sys.draw_ripples(fb, t)
            fx_sys.draw_particles(fb, t)
            gfx.apply_vignette(fb, fx_cfg.vignette)
            _dx, _dy = fx_sys.shake_offset(t)
            # T6：HUD 统计
            hud_stats["balls"] = sum(bin_counts)
            hud_stats["bins_filled"] = sum(1 for c in bin_counts if c >= BIN_FULL)
            _out = composer.render(fb, trail_buf.buf if trail_on else None,
                                   shift=(_dx, _dy), bg=bg_cache)
            # T6：文字在最后一步叠加，不进入 trail_buffer
            text_layer.draw(_out, t, hud_stats)
            proc.stdin.write(composer.finish(_out))

    # =====================================================================
    # melody-bounce（默认分支）
    # =====================================================================
    else:
        ar = P.arena
        bl = P.balls
        rl = P.rule

        shape = ar.shape
        sides = 6 if shape == "hexagon" else 3 if shape == "triangle" else 5 if shape == "polygon" else 0
        cx, cy = W * 0.5, H * 0.52
        arena_r = ar.radius_px
        wall_px = max(1.0, ar.wall_px)

        gravity_y = bl.gravity_px
        restitution = bl.restitution
        speed_px = bl.speed_px
        max_count = bl.max_count

        init_rng = derive_rng(P.seed, "balls")

        # T4：球碰撞后颜色切换到调色板下一个（0.08s 渐变）
        color_cycler = thememod.ColorCycler(accent_rgbs)
        # T4：新球出生时的"生成闪光环"，记录 (x, y, t0, color)
        spawn_rings: list = []
        SPAWN_RING_LIFE = 0.30

        balls = []
        for _ in range(bl.count_start):
            balls.append({
                "x": cx + init_rng.uniform(-rel(0.045), rel(0.045)),
                "y": cy - rel(0.13),
                "vx": speed_px * (1 if init_rng.random() > 0.5 else -1),
                "vy": speed_px * 0.75,
                "r": bl.radius_px,
                "color": accent_rgbs[len(balls) % len(accent_rgbs)],
                "trail": [],
            })

        bounce_count = 0
        flash_timer = 0.0
        gravity_sign = 1.0

        for f_idx in range(total_frames):
            t = f_idx * dt
            # T5：强度曲线
            _I = arcmod.intensity_of(arc_cfg, t)
            _hp = arcmod.hook_peek_factor(spec, t)
            _eff_I = min(1.0, _I + 0.25 * _hp)     # hook_peek 期间按高潮态呈现
            fx_sys.particle_scale = arcmod.particle_mult(_eff_I) * (1.0 + 0.5 * _hp)
            # T5：drop 蓄力段画面同样安静下来（抑制新粒子与涟漪）
            fx_sys.silenced = arcmod.is_drop_silence(spec, t)

            z = frame_zoom(cam, t, duration) * arcmod.zoom_mult(_eff_I) * (1.0 + 0.08 * _hp)
            angle_rad = math.radians(ar.rotation_deg_per_s * t * arcmod.rotation_mult(_I))
            flash_timer = max(0.0, flash_timer - dt)

            np.copyto(work_frame, bg_cache)
            # T5：背景亮度倍率 0.9 + 0.2*I（hook_peek 期间 +15%）
            work_frame *= arcmod.bg_brightness_mult(_eff_I) * (1.0 + 0.15 * _hp)
            fb = work_frame

            if trail_on:
                trail_buf.decay(trail_fade)
            else:
                trail_buf.clear()

            # T4：墙体默认色取主题色（调色板第一色 85% 亮度），不再是写死灰色
            wall_color = accent_rgbs[bounce_count % len(accent_rgbs)] if flash_timer > 0 else theme.ui_color
            cur_r = arena_r * (max(0.62, 1.0 - bounce_count * 0.008) if rl.type == "shrink_wall" else 1.0)
            scx, scy = zoom_at(z, cx, cy)

            # T4：场地内部极淡同心圆（α0.05），随球数增长缓慢向内脉动
            _nball = len(balls)
            _pulse = 1.0 - 0.06 * (0.5 + 0.5 * math.sin(t * 1.2)) * min(1.0, _nball / 16.0)
            for _k in (0.35, 0.52, 0.70, 0.88):
                gfx.draw_ring_aa(fb, scx, scy, cur_r * z * _k * _pulse,
                                 max(0.8, wall_px * 0.5), theme.ui_color, 0.05)
            if sides == 0:
                # T3 墙体点亮：按 24 段分别绘制，命中的段加亮并加粗
                for _seg in range(fxmod.WALL_SEGMENTS):
                    _a0 = 2 * math.pi * _seg / fxmod.WALL_SEGMENTS
                    _a1 = 2 * math.pi * (_seg + 1) / fxmod.WALL_SEGMENTS
                    _boost = fx_sys.wall_boost(_seg, t)
                    if _boost is None:
                        continue
                    _bright, _bcol = _boost
                    _col = tuple(min(255, int(c * (0.45 + 0.55 * _bright))) for c in _bcol)
                    _t0 = zoom_at(z, cx + cur_r * math.cos(_a0), cy + cur_r * math.sin(_a0))
                    _t1 = zoom_at(z, cx + cur_r * math.cos(_a1), cy + cur_r * math.sin(_a1))
                    gfx.draw_line_aa(fb, _t0[0], _t0[1], _t1[0], _t1[1], wall_px * 3, _col)
                # T4 霓虹边框：外发光 + 细亮线
                gfx.add_glow(fb, scx, scy, cur_r * z + wall_px * z * 1.6, wall_color,
                             0.30 * arcmod.wall_glow_mult(_eff_I))
                gfx.draw_ring_aa(fb, scx, scy, cur_r * z, max(1.0, wall_px * z * 0.55), wall_color)
            else:
                pts = [
                    zoom_at(z,
                            cx + cur_r * math.cos(angle_rad + 2 * math.pi * i / sides),
                            cy + cur_r * math.sin(angle_rad + 2 * math.pi * i / sides))
                    for i in range(sides)
                ]
                for i in range(sides):
                    p0 = pts[i]
                    p1 = pts[(i + 1) % sides]
                    # T3 墙体点亮：命中的边加亮并加粗
                    _boost = fx_sys.wall_boost(i, t)
                    if _boost is not None:
                        _bright, _bcol = _boost
                        _col = tuple(min(255, int(c * (0.45 + 0.55 * _bright))) for c in _bcol)
                        gfx.draw_line_aa(fb, p0[0], p0[1], p1[0], p1[1], wall_px * 3, _col)
                    # T4 霓虹边框：先铺一层加色发光，再压一条细亮线
                    gfx.draw_line_aa(fb, p0[0], p0[1], p1[0], p1[1], wall_px * 2.4, wall_color, 0.22)
                    gfx.draw_line_aa(fb, p0[0], p0[1], p1[0], p1[1], max(1.0, wall_px * 0.55), wall_color)

            new_balls = []
            for b in balls:
                _spd_m = arcmod.speed_mult(_eff_I)
                if arcmod.is_drop_silence(spec, t):
                    _spd_m *= 0.4          # T5：drop 蓄力段球速降到 0.4 倍
                b["vy"] += gravity_y * gravity_sign * dt * _spd_m
                b["x"] += b["vx"] * dt * _spd_m
                b["y"] += b["vy"] * dt * _spd_m

                dx, dy = b["x"] - cx, b["y"] - cy
                dist = math.hypot(dx, dy)
                limit = cur_r - b["r"] - rel(0.007)
                if dist >= limit and dist > 0:
                    nx, ny = dx / dist, dy / dist
                    b["x"] = cx + nx * limit
                    b["y"] = cy + ny * limit
                    dot = b["vx"] * nx + b["vy"] * ny
                    if dot > 0:
                        b["vx"] -= (1.0 + restitution) * dot * nx
                        b["vy"] -= (1.0 + restitution) * dot * ny

                        if rl.type == "speed_up":
                            b["vx"] *= 1.025
                            b["vy"] *= 1.025
                        elif rl.type == "grow_on_bounce":
                            b["r"] = min(cur_r * 0.45, b["r"] * rl.scale_factor)
                        elif rl.type == "split_on_bounce":
                            # T5：I 越高分裂越频繁
                            _eni = max(1, round(rl.every_n_bounces
                                                * arcmod.split_interval_mult(_eff_I)))
                            if (bounce_count % _eni == 0
                                    and len(balls) + len(new_balls) < max_count):
                                _nb = {
                                    "x": b["x"],
                                    "y": b["y"],
                                    "vx": -b["vx"] * 0.92 + init_rng.uniform(-rel(0.065), rel(0.065)),
                                    "vy": b["vy"] * 0.95,
                                    "r": max(rel(0.011), b["r"] * 0.92),
                                    "color": accent_rgbs[(len(balls) + len(new_balls)) % len(accent_rgbs)],
                                    "trail": [],
                                }
                                new_balls.append(_nb)
                                # T4：生成闪光环
                                spawn_rings.append((_nb["x"], _nb["y"], t, _nb["color"]))
                        elif rl.type == "gravity_flip":
                            if bounce_count % rl.every_n_bounces == 0:
                                gravity_sign *= -1.0

                        bounce_count += 1
                        flash_timer = 0.12
                        # T4：碰撞切换颜色（0.08s 渐变过渡）
                        color_cycler.advance(t)
                        _emit_event(events, spec, t, notes[note_idx % len(notes)], 0.9)
                        note_idx += 1
                        hud_stats["notes"] = note_idx

                        # T3: 碰墙 0.6，分裂 1.0，每第 8 次碰撞额外 +0.2
                        _fx_i = 0.6
                        if rl.type == "split_on_bounce" and (
                                (bounce_count - 1) % rl.every_n_bounces == 0):
                            _fx_i = 1.0
                        if bounce_count % 8 == 0:
                            _fx_i = min(1.0, _fx_i + 0.2)
                        # 撞墙点：球心到墙的交点
                        _wx = cx + (b["x"] - cx) / max(1e-6, dist) * cur_r
                        _wy = cy + (b["y"] - cy) / max(1e-6, dist) * cur_r
                        _wsx, _wsy = zoom_at(z, _wx, _wy)
                        # 墙段：多边形按边，圆形按 24 段
                        if sides > 0:
                            _ang = math.atan2(_wy - cy, _wx - cx) - angle_rad
                            _seg = int(round((_ang % (2 * math.pi)) / (2 * math.pi) * sides)) % sides
                        else:
                            _ang = math.atan2(_wy - cy, _wx - cx)
                            _seg = int(round((_ang % (2 * math.pi)) / (2 * math.pi) * fxmod.WALL_SEGMENTS)) % fxmod.WALL_SEGMENTS
                        fx_sys.spawn(t, _wsx, _wsy, _fx_i, b["color"],
                                     palette=accent_rgbs, wall_seg=_seg, ball_key=("ball", id(b)))

                sbx, sby = zoom_at(z, b["x"], b["y"])
                sr = b["r"] * z

                # T4：球色跟随颜色循环；球数 >12 时发光降到 0.7 倍避免发白
                _bcol = color_cycler.current(t) if b.get("use_cycle", True) else b["color"]
                _n = len(balls)
                if _n > 48:
                    _glow_k = 0.32
                elif _n > 30:
                    _glow_k = 0.45
                elif _n > 12:
                    _glow_k = 0.7
                else:
                    _glow_k = 1.0

                if trail_on:
                    trail_buf.stamp(sbx, sby, sr * GLOW_RADIUS_FACTOR, _bcol,
                                    GLOW_STRENGTH * _glow_k)
                draw_ball(fb, sbx, sby, sr * fx_sys.pop_scale(("ball", id(b)), t),
                          _bcol, z, glow_scale=_glow_k)

            # T4：生成闪光环（新球出生时）
            spawn_rings = [r for r in spawn_rings if t - r[2] < SPAWN_RING_LIFE]
            for _rx, _ry, _rt, _rc in spawn_rings:
                _rk = (t - _rt) / SPAWN_RING_LIFE
                _rr = (rel(0.012) + rel(0.055) * _rk) * z
                _rsx, _rsy = zoom_at(z, _rx, _ry)
                gfx.draw_ring_aa(fb, _rsx, _rsy, _rr, max(0.8, 2.2 * (1.0 - _rk)), _rc,
                                 0.85 * (1.0 - _rk))

            balls.extend(new_balls)
            # T6：HUD 统计
            hud_stats["balls"] = len(balls)
            hud_stats["bounces"] = bounce_count
            # T5：arc 特殊事件
            # countdown：每段开头 0.15 秒内的节拍点 → 全屏闪光 + tick 音频事件
            for _bp in arcmod.beat_points(spec):
                if _bp <= t < _bp + 0.15 and not _fired_beats.get(round(_bp, 3)):
                    _fired_beats[round(_bp, 3)] = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    _emit_event(events, spec, t, notes[note_idx % len(notes)], 1.0)
                    note_idx += 1

            # drop：u=0.40 爆发一次 —— 闪光 + 震屏 + 粒子大爆发
            if arc_cfg.preset == "drop" and not _fired_burst:
                if arcmod.is_drop_burst(spec, t):
                    _fired_burst = True
                    fx_sys.spawn(t, W * 0.5, H * 0.5, 1.0,
                                 accent_rgbs[0], palette=accent_rgbs)
                    fxmod.celebrate_bin(fx_sys, t, W * 0.5, H * 0.5,
                                        accent_rgbs[0], accent_rgbs, 30)

            # T3 视觉反馈：推进生命周期 → 叠加各层效果
            fx_sys.update(t, dt)
            fx_sys.apply_background_flash(fb)
            fx_sys.draw_ripples(fb, t)
            fx_sys.draw_particles(fb, t)
            gfx.apply_vignette(fb, fx_cfg.vignette)
            _dx, _dy = fx_sys.shake_offset(t)
            _out = composer.render(fb, trail_buf.buf if trail_on else None,
                                   shift=(_dx, _dy), bg=bg_cache)
            # T6：文字在最后一步叠加，不进入 trail_buffer
            text_layer.draw(_out, t, hud_stats)
            proc.stdin.write(composer.finish(_out))

    return events


def render_mp4(payload_path: str, output_mp4: str):
    with open(payload_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    spec = payload["spec"]
    melody = payload.get("melody")
    fps = int(spec["format"]["fps"])
    duration = float(spec["format"]["duration_sec"])
    width = int(spec["format"]["width"])
    height = int(spec["format"]["height"])

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_mp4 = os.path.join(tmpdir, "video_only.mp4")
        wav_path = os.path.join(tmpdir, "audio.wav")

        # T6：文字改由 text_layer 在帧缓冲上叠加，ffmpeg 只做 lanczos 放大。
        # 不再把 publish.title 画进视频（原 y=1660 的标题已移除）。
        vf = f"scale={width}:{height}:flags=lanczos"

        v_cmd = [
            "ffmpeg",
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", f"{RENDER_W}x{RENDER_H}",
            "-r", str(fps),
            "-i", "pipe:0",
            "-vf", vf,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            raw_mp4,
        ]

        proc = subprocess.Popen(v_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        events = simulate_and_render_frames(spec, melody, proc)
        proc.stdin.close()
        v_err = proc.stderr.read()
        proc.stderr.close()
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg video render failed: {v_err.decode('utf-8', errors='ignore')[:400]}")

        synthesize_wav(wav_path, duration, events)

        mux_cmd = [
            "ffmpeg",
            "-y",
            "-i", raw_mp4,
            "-i", wav_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-af", "loudnorm=I=-14:TP=-1:LRA=7",
            "-shortest",
            output_mp4,
        ]
        subprocess.run(mux_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main(argv: list) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = {a for a in argv[1:] if a.startswith("--")}

    if "--draft" in flags:
        set_render_size(DRAFT_W, DRAFT_H)

    if len(args) < 2:
        print(
            "Usage: render_worker.py [--draft] <spec_payload.json> <output.mp4>",
            file=sys.stderr,
        )
        return 1

    render_mp4(args[0], args[1])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
