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

import spec_params  # noqa: E402
from spec_params import (  # noqa: E402
    load_params,
    resolve_pixels,
    derive_rng,
    TrailParams,
    BackgroundParams,
    CameraParams,
)


RENDER_W = 270
RENDER_H = 480


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


def draw_circle(buf: bytearray, cx: float, cy: float, r: float, color: tuple):
    r_int = int(math.ceil(r)) + 1
    x0 = max(0, int(cx) - r_int)
    x1 = min(RENDER_W - 1, int(cx) + r_int)
    y0 = max(0, int(cy) - r_int)
    y1 = min(RENDER_H - 1, int(cy) + r_int)
    r2 = r * r
    cr, cg, cb = color
    for py in range(y0, y1 + 1):
        dy = py - cy
        dy2 = dy * dy
        row_off = py * RENDER_W * 3
        for px in range(x0, x1 + 1):
            dx = px - cx
            if dx * dx + dy2 <= r2:
                idx = row_off + px * 3
                buf[idx] = cr
                buf[idx + 1] = cg
                buf[idx + 2] = cb


def draw_ring(buf: bytearray, cx: float, cy: float, r: float, thickness: float, color: tuple):
    r_outer = r + thickness * 0.5
    r_inner = max(0.0, r - thickness * 0.5)
    r_out2 = r_outer * r_outer
    r_in2 = r_inner * r_inner
    r_int = int(math.ceil(r_outer)) + 1
    x0 = max(0, int(cx) - r_int)
    x1 = min(RENDER_W - 1, int(cx) + r_int)
    y0 = max(0, int(cy) - r_int)
    y1 = min(RENDER_H - 1, int(cy) + r_int)
    cr, cg, cb = color
    for py in range(y0, y1 + 1):
        dy = py - cy
        dy2 = dy * dy
        row_off = py * RENDER_W * 3
        for px in range(x0, x1 + 1):
            dx = px - cx
            d2 = dx * dx + dy2
            if r_in2 <= d2 <= r_out2:
                idx = row_off + px * 3
                buf[idx] = cr
                buf[idx + 1] = cg
                buf[idx + 2] = cb


def draw_line(buf: bytearray, x0: float, y0: float, x1: float, y1: float, thickness: int, color: tuple):
    steps = max(1, int(max(abs(x1 - x0), abs(y1 - y0))))
    cr, cg, cb = color
    half = max(0, thickness // 2)
    for s in range(steps + 1):
        t = s / steps
        px = int(x0 + (x1 - x0) * t)
        py = int(y0 + (y1 - y0) * t)
        for oy in range(-half, half + 1):
            yy = py + oy
            if yy < 0 or yy >= RENDER_H:
                continue
            row_off = yy * RENDER_W * 3
            for ox in range(-half, half + 1):
                xx = px + ox
                if 0 <= xx < RENDER_W:
                    idx = row_off + xx * 3
                    buf[idx] = cr
                    buf[idx + 1] = cg
                    buf[idx + 2] = cb


def draw_rect_outline(buf: bytearray, x: int, y: int, w: int, h: int, color: tuple):
    draw_line(buf, x, y, x + w, y, 2, color)
    draw_line(buf, x + w, y, x + w, y + h, 2, color)
    draw_line(buf, x + w, y + h, x, y + h, 2, color)
    draw_line(buf, x, y + h, x, y, 2, color)


# ---------------------------------------------------------------------------
# 背景缓存 / 摄像机变换
# ---------------------------------------------------------------------------

def build_background(bg: BackgroundParams) -> bytearray:
    """按 style.background 预生成一帧背景，整段渲染复用同一份 bytes。

    - solid    : 纯 colors[0]
    - gradient : colors[0] → colors[1] 垂直渐变
    - grid     : colors[0] 打底 + colors[1] 垂直渐变，再叠加间距 6% 画面宽的网格，
                 网格线亮度抬高 6%
    """
    canvas = bytearray(RENDER_W * RENDER_H * 3)
    colors = bg.colors or ["#05060F"]

    if bg.type == "solid" or len(colors) < 2:
        c = hex_to_rgb(colors[0], (7, 11, 24))
        base = bytes(c) * (RENDER_W * RENDER_H)
        canvas[:] = base
    else:
        top = hex_to_rgb(colors[0], (7, 11, 24))
        bottom = hex_to_rgb(colors[1], (7, 11, 24))
        for y in range(RENDER_H):
            k = y / max(1, RENDER_H - 1)
            r = int(top[0] + (bottom[0] - top[0]) * k)
            g = int(top[1] + (bottom[1] - top[1]) * k)
            b = int(top[2] + (bottom[2] - top[2]) * k)
            row = bytes((r, g, b)) * RENDER_W
            canvas[y * RENDER_W * 3:(y + 1) * RENDER_W * 3] = row

    if bg.type == "grid":
        # 网格线：间距 6% 画面宽，亮度 +6%
        spacing = max(4, int(round(RENDER_W * 0.06)))
        for x in range(0, RENDER_W, spacing):
            for y in range(RENDER_H):
                idx = (y * RENDER_W + x) * 3
                for ch in range(3):
                    canvas[idx + ch] = min(255, int(canvas[idx + ch] * 1.06))
        for y in range(0, RENDER_H, spacing):
            row_off = y * RENDER_W * 3
            for x in range(RENDER_W):
                idx = row_off + x * 3
                for ch in range(3):
                    canvas[idx + ch] = min(255, int(canvas[idx + ch] * 1.06))

    return canvas


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


def draw_trail(buf: bytearray, points: list, radius: float, color: tuple, trail: TrailParams):
    """按 trail.length_frames / fade 绘制拖尾。enabled=false 或 length=0 时跳过。"""
    if not trail.active or not points:
        return
    n = len(points)
    for i, (tx, ty) in enumerate(points):
        # 越靠尾端越暗；fade 控制整体衰减强度
        k = (i + 1) / n
        brightness = (1.0 - trail.fade) + trail.fade * k
        tr_col = (
            int(color[0] * brightness),
            int(color[1] * brightness),
            int(color[2] * brightness),
        )
        draw_circle(buf, tx, ty, max(1.0, radius * 0.55), tr_col)


def simulate_and_render_frames(spec: dict, melody: dict | None, proc: subprocess.Popen):
    """渲染所有帧并把 RGB24 数据写进 ffmpeg 的 stdin，返回音频事件列表。

    所有可调参数一律经 spec_params.load_params() 获取，不再直接读 params 字典。
    """
    P = resolve_pixels(load_params(spec), RENDER_W, RENDER_H)
    for w in P.warnings:
        print(f"[render] warning: {w}", file=sys.stderr)

    fps = P.fps
    duration = P.duration_sec
    total_frames = max(1, int(fps * duration))
    dt = 1.0 / fps

    accent_rgbs = [hex_to_rgb(c, (56, 189, 248)) for c in P.style.palette]
    if not accent_rgbs:
        accent_rgbs = [(56, 189, 248), (244, 114, 182), (251, 191, 36)]

    # 背景只生成一次，整段复用
    bg_template = bytes(build_background(P.style.background))

    # 旋律音高 + transpose（半音）
    notes = []
    if melody and melody.get("tracks"):
        notes = [int(n["pitch"]) + P.audio.transpose for n in melody["tracks"][0]["notes"]]
    if not notes:
        notes = [60, 62, 64, 67, 69, 72]
        notes = [n + P.audio.transpose for n in notes]

    trail = P.style.trail
    cam = P.style.camera
    events = []
    note_idx = 0

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

        pivot_x = RENDER_W * 0.5
        pivot_y = RENDER_H * 0.20
        prev_thetas = [0.0] * count
        bob_trails = [[] for _ in range(count)]

        for f_idx in range(total_frames):
            t = f_idx * dt
            z = frame_zoom(cam, t, duration)
            frame = bytearray(bg_template)

            # 中枢参考线与顶部枢轴横杆
            px0, py0 = zoom_at(z, pivot_x, pivot_y)
            px1, py1 = zoom_at(z, pivot_x, RENDER_H * 0.84)
            draw_line(frame, px0, py0, px1, py1, 1, (51, 65, 85))
            bx0, by0 = zoom_at(z, RENDER_W * 0.2, pivot_y)
            bx1, by1 = zoom_at(z, RENDER_W * 0.8, pivot_y)
            draw_line(frame, bx0, by0, bx1, by1, 2, (148, 163, 184))

            damp_factor = math.exp(-damping * t)
            for i in range(count):
                osc_count = 12 + (i * 1.5 if rule_type == "phase_flip" else i)
                omega = (2.0 * math.pi * osc_count) / cycle_sec
                pulse_mod = (1.0 + 0.08 * math.sin(t * 2.1)) if rule_type == "gravity_pulse" else 1.0
                theta = max_angle * damp_factor * math.cos(omega * t * pulse_mod - 1.15)
                pend_len = min(0.62, pd.length_min + i * pd.length_step) * RENDER_H
                raw_x = pivot_x + math.sin(theta) * pend_len * 0.48
                raw_y = pivot_y + math.cos(theta) * pend_len
                col = accent_rgbs[i % len(accent_rgbs)]

                # note_trigger.on: center_crossing | peak_reversal
                if f_idx > 0:
                    crossed = (prev_thetas[i] < 0 <= theta) or (prev_thetas[i] > 0 >= theta)
                    if P.note_trigger.on == "peak_reversal":
                        prev_abs = abs(prev_thetas[i])
                        trigger = abs(theta) > prev_abs and f_idx > 1 and abs(theta) > max_angle * 0.55 * damp_factor
                    else:
                        trigger = crossed
                    if trigger:
                        events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.78})
                        note_idx += 1
                prev_thetas[i] = theta

                lx0, ly0 = zoom_at(z, pivot_x, pivot_y)
                lx1, ly1 = zoom_at(z, raw_x, raw_y)
                draw_line(frame, lx0, ly0, lx1, ly1, 1, (100, 116, 139))

                if trail.active:
                    bob_trails[i].append((raw_x, raw_y))
                    while len(bob_trails[i]) > trail.length_frames:
                        bob_trails[i].pop(0)
                    draw_trail(frame, [zoom_at(z, tx, ty) for tx, ty in bob_trails[i]],
                               5.0 * z, col, trail)

                sx, sy = zoom_at(z, raw_x, raw_y)
                draw_circle(frame, sx, sy, 5.0 * z, col)

            proc.stdin.write(frame)

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

        cx, cy = RENDER_W * 0.5, RENDER_H * 0.50
        prev_angles = [trig_rad - 0.16 - i * 0.07 for i in range(count)]
        planet_trails = [[] for _ in range(count)]

        for f_idx in range(total_frames):
            t = f_idx * dt
            z = frame_zoom(cam, t, duration)
            frame = bytearray(bg_template)
            beam_r = RENDER_W * 0.46

            scx, scy = zoom_at(z, cx, cy)
            bex, bey = zoom_at(z, cx + math.cos(trig_rad) * beam_r, cy + math.sin(trig_rad) * beam_r)
            draw_line(frame, scx, scy, bex, bey, 2, (226, 232, 240))
            draw_circle(frame, scx, scy, 4.5 * z, (248, 250, 252))

            # pulse_rings: 圆环半径按 1+0.06*sin(t*3) 脉动
            pulse = (1.0 + 0.06 * math.sin(t * 3.0)) if rule_type == "pulse_rings" else 1.0

            for i in range(count):
                direction = -1.0 if (rule_type == "reverse_outer" and i >= count // 2) else 1.0
                omega = direction * base_omega * (1.0 + i * res_ratio)
                angle = trig_rad - 0.16 - i * 0.07 + omega * t
                ring_r = min(0.44, base_r + i * step_r) * RENDER_W * pulse
                col = accent_rgbs[i % len(accent_rgbs)]
                draw_ring(frame, scx, scy, ring_r * z, 1.2 * z, (51, 65, 85))

                if f_idx > 0:
                    prev_k = math.floor((prev_angles[i] - trig_rad) / (2.0 * math.pi))
                    curr_k = math.floor((angle - trig_rad) / (2.0 * math.pi))
                    if prev_k != curr_k:
                        events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.82})
                        note_idx += 1
                prev_angles[i] = angle

                raw_x = cx + math.cos(angle) * ring_r
                raw_y = cy + math.sin(angle) * ring_r

                if trail.active:
                    planet_trails[i].append((raw_x, raw_y))
                    while len(planet_trails[i]) > trail.length_frames:
                        planet_trails[i].pop(0)
                    draw_trail(frame, [zoom_at(z, tx, ty) for tx, ty in planet_trails[i]],
                               4.8 * z, col, trail)

                sx, sy = zoom_at(z, raw_x, raw_y)
                draw_circle(frame, sx, sy, 4.8 * z, col)

            proc.stdin.write(frame)

    # =====================================================================
    # ball-sort
    # =====================================================================
    elif P.template == "ball-sort":
        bs = P.bin_sort
        bin_rgbs = [hex_to_rgb(c) for c in bs.colors]
        num_bins = bs.bin_count
        ball_count = bs.ball_count

        # 钉子：rows 行，jitter 由 seed 派生
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

        # 桶布局
        bin_w = (RENDER_W - 32) / num_bins
        bin_positions = []
        for b in range(num_bins):
            if bs.layout == "stepped":
                bx = 16 + b * bin_w
                by = 0.755 * RENDER_H + b * (0.055 * RENDER_H / max(1, num_bins - 1))
            else:
                # under-funnel / split-chute（暂用 under-funnel）
                bx = 16 + b * bin_w
                by = 0.79 * RENDER_H
            bin_positions.append((bx, by))

        moving_gate = bs.gate_moving
        gate_period = bs.gate_period_s

        active_balls = []
        spawn_interval = max(4, total_frames // (ball_count + 4))
        bin_counts = [0] * num_bins

        for f_idx in range(total_frames):
            t = f_idx * dt
            z = frame_zoom(cam, t, duration)

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

            frame = bytearray(bg_template)

            # 漏斗
            fl0 = zoom_at(z, 0.36 * RENDER_W, 0.16 * RENDER_H)
            fl1 = zoom_at(z, 0.45 * RENDER_W, 0.26 * RENDER_H)
            fr0 = zoom_at(z, 0.64 * RENDER_W, 0.16 * RENDER_H)
            fr1 = zoom_at(z, 0.55 * RENDER_W, 0.26 * RENDER_H)
            draw_line(frame, fl0[0], fl0[1], fl1[0], fl1[1], 2, (148, 163, 184))
            draw_line(frame, fr0[0], fr0[1], fr1[0], fr1[1], 2, (148, 163, 184))

            for px, py in pegs:
                sx, sy = zoom_at(z, px * RENDER_W, py * RENDER_H)
                draw_circle(frame, sx, sy, 3.0 * z, (148, 163, 184))

            # 桶
            for b in range(num_bins):
                bx, by = bin_positions[b]
                ox, oy = zoom_at(z, bx + 2, by)
                draw_rect_outline(
                    frame, int(ox), int(oy),
                    int((bin_w - 4) * z), int(0.13 * RENDER_H * z),
                    bin_rgbs[b % len(bin_rgbs)],
                )

            # 移动挡板：在画面中段左右往复，周期 period_s
            gate_x_norm = None
            if moving_gate:
                phase = (t % gate_period) / gate_period
                gate_x_norm = 0.30 + 0.40 * (0.5 - 0.5 * math.cos(phase * 2.0 * math.pi))
                gx0 = zoom_at(z, gate_x_norm * RENDER_W, 0.60 * RENDER_H)
                gx1 = zoom_at(z, gate_x_norm * RENDER_W, 0.66 * RENDER_H)
                draw_line(frame, gx0[0], gx0[1], gx1[0], gx1[1], 3, (226, 232, 240))

            for b_obj in active_balls:
                if not b_obj["settled"]:
                    b_obj["vy"] += 0.65 * dt
                    b_obj["x"] += b_obj["vx"] * dt
                    b_obj["y"] += b_obj["vy"] * dt

                    # 挡板碰撞：撞上时横向弹开
                    if moving_gate and b_obj["y"] > 0.595 and b_obj["y"] < 0.665:
                        if abs(b_obj["x"] - gate_x_norm) < 0.035:
                            b_obj["vx"] += (0.6 if b_obj["x"] > gate_x_norm else -0.6) * 0.12
                            b_obj["vy"] = max(b_obj["vy"], 0.02)

                    if b_obj["x"] < 0.12:
                        b_obj["x"] = 0.12
                        b_obj["vx"] = abs(b_obj["vx"]) * 0.85
                    elif b_obj["x"] > 0.88:
                        b_obj["x"] = 0.88
                        b_obj["vx"] = -abs(b_obj["vx"]) * 0.85

                    for px, py in pegs:
                        dx, dy = b_obj["x"] - px, b_obj["y"] - py
                        d = math.hypot(dx, dy)
                        if 0 < d < 0.03:
                            nx, ny = dx / d, dy / d
                            b_obj["x"] = px + nx * 0.031
                            b_obj["y"] = py + ny * 0.031
                            dot = b_obj["vx"] * nx + b_obj["vy"] * ny
                            if dot < 0:
                                b_obj["vx"] -= 1.65 * dot * nx
                                b_obj["vy"] -= 1.65 * dot * ny
                                events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.65})
                                note_idx += 1

                    # 下层引导入目标桶
                    if b_obj["y"] > 0.72:
                        target_x = (16 + (b_obj["cidx"] + 0.5) * bin_w) / RENDER_W
                        b_obj["vx"] += (target_x - b_obj["x"]) * 6.0 * dt

                    settle_y = bin_positions[b_obj["cidx"]][1] / RENDER_H + 0.09
                    if b_obj["y"] >= settle_y:
                        b_obj["settled"] = True
                        slot = b_obj["cidx"]
                        stack_idx = bin_counts[slot]
                        bin_counts[slot] += 1
                        b_obj["x"] = (16 + (slot + 0.5) * bin_w + ((stack_idx % 3) - 1) * 7) / RENDER_W
                        b_obj["y"] = settle_y + 0.01 - (stack_idx // 3) * 0.024
                        events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.95})
                        note_idx += 1

                sx, sy = zoom_at(z, b_obj["x"] * RENDER_W, b_obj["y"] * RENDER_H)
                draw_circle(frame, sx, sy, 5.5 * z, bin_rgbs[b_obj["cidx"] % len(bin_rgbs)])

            proc.stdin.write(frame)

    # =====================================================================
    # melody-bounce（默认分支）
    # =====================================================================
    else:
        ar = P.arena
        bl = P.balls
        rl = P.rule

        shape = ar.shape
        sides = 6 if shape == "hexagon" else 3 if shape == "triangle" else 5 if shape == "polygon" else 0
        cx, cy = RENDER_W * 0.5, RENDER_H * 0.52
        arena_r = ar.radius_px
        wall_px = max(1.0, ar.wall_px)

        gravity_y = bl.gravity_px
        restitution = bl.restitution
        speed_px = bl.speed_px
        max_count = bl.max_count

        init_rng = derive_rng(P.seed, "balls")

        balls = []
        for _ in range(bl.count_start):
            balls.append({
                "x": cx + init_rng.uniform(-12, 12),
                "y": cy - 35,
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
            z = frame_zoom(cam, t, duration)
            angle_rad = math.radians(ar.rotation_deg_per_s * t)
            flash_timer = max(0.0, flash_timer - dt)

            frame = bytearray(bg_template)

            # 场地轮廓
            wall_color = accent_rgbs[bounce_count % len(accent_rgbs)] if flash_timer > 0 else (203, 213, 225)
            cur_r = arena_r * (max(0.62, 1.0 - bounce_count * 0.008) if rl.type == "shrink_wall" else 1.0)
            scx, scy = zoom_at(z, cx, cy)
            if sides == 0:
                draw_ring(frame, scx, scy, cur_r * z, wall_px * z, wall_color)
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
                    draw_line(frame, p0[0], p0[1], p1[0], p1[1], max(1, int(wall_px)), wall_color)

            new_balls = []
            for b in balls:
                b["vy"] += gravity_y * gravity_sign * dt
                b["x"] += b["vx"] * dt
                b["y"] += b["vy"] * dt

                b["trail"].append((b["x"], b["y"]))
                while len(b["trail"]) > max(1, trail.length_frames):
                    b["trail"].pop(0)

                dx, dy = b["x"] - cx, b["y"] - cy
                dist = math.hypot(dx, dy)
                limit = cur_r - b["r"] - 2
                if dist >= limit and dist > 0:
                    nx, ny = dx / dist, dy / dist
                    b["x"] = cx + nx * limit
                    b["y"] = cy + ny * limit
                    dot = b["vx"] * nx + b["vy"] * ny
                    if dot > 0:
                        # 反弹：法向分量按 restitution 反射
                        b["vx"] -= (1.0 + restitution) * dot * nx
                        b["vy"] -= (1.0 + restitution) * dot * ny

                        if rl.type == "speed_up":
                            b["vx"] *= 1.025
                            b["vy"] *= 1.025
                        elif rl.type == "grow_on_bounce":
                            b["r"] = min(cur_r * 0.45, b["r"] * rl.scale_factor)
                        elif rl.type == "split_on_bounce":
                            if (bounce_count % rl.every_n_bounces == 0
                                    and len(balls) + len(new_balls) < max_count):
                                new_balls.append({
                                    "x": b["x"],
                                    "y": b["y"],
                                    "vx": -b["vx"] * 0.92 + init_rng.uniform(-18, 18),
                                    "vy": b["vy"] * 0.95,
                                    "r": max(3.0, b["r"] * 0.92),
                                    "color": accent_rgbs[(len(balls) + len(new_balls)) % len(accent_rgbs)],
                                    "trail": [],
                                })
                        elif rl.type == "gravity_flip":
                            if bounce_count % rl.every_n_bounces == 0:
                                gravity_sign *= -1.0

                        bounce_count += 1
                        flash_timer = 0.12
                        events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.9})
                        note_idx += 1

                if trail.active:
                    scaled = [zoom_at(z, tx, ty) for tx, ty in b["trail"]]
                    draw_trail(frame, scaled, b["r"] * z, b["color"], trail)

                sbx, sby = zoom_at(z, b["x"], b["y"])
                draw_circle(frame, sbx, sby, b["r"] * z, b["color"])

            balls.extend(new_balls)
            proc.stdin.write(frame)

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

    hook_text = spec["concept"]["hook_line"].replace("'", "").replace(":", " ").replace("%", "")
    title_text = spec["publish"]["title"][:44].replace("'", "").replace(":", " ").replace("%", "")

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_mp4 = os.path.join(tmpdir, "video_only.mp4")
        wav_path = os.path.join(tmpdir, "audio.wav")

        vf = (
            f"scale={width}:{height}:flags=bicubic,"
            f"drawtext=text='{hook_text}':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=220,"
            f"drawtext=text='{title_text}':fontcolor=#94A3B8:fontsize=28:x=(w-text_w)/2:y=1660"
        )

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


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: render_worker.py <spec_payload.json> <output.mp4>", file=sys.stderr)
        sys.exit(1)
    render_mp4(sys.argv[1], sys.argv[2])
