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
import random
import struct
import subprocess
import sys
import tempfile
import wave


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


def simulate_and_render_frames(spec: dict, melody: dict | None, proc: subprocess.Popen):
    scene = spec.get("scene", {})
    seed = int(scene.get("seed", 1))
    rng = random.Random(seed)
    fps = int(spec["format"]["fps"])
    duration = float(spec["format"]["duration_sec"])
    total_frames = max(1, int(fps * duration))
    dt = 1.0 / fps

    template_key = scene.get("template") or spec.get("template", {}).get("key", "melody-bounce")
    params = scene.get("params") or spec.get("template", {}).get("params", {})
    style = scene.get("style", {})
    bg_list = style.get("background", {}).get("colors") or []
    pal_list = style.get("palette", {}).get("colors") or ["#38BDF8", "#F472B6", "#FBBF24", "#34D399"]

    bg_rgb = hex_to_rgb(bg_list[0] if bg_list else "#070B18", (7, 11, 24))
    accent_rgbs = [hex_to_rgb(c, (56, 189, 248)) for c in pal_list] or [(56, 189, 248), (244, 114, 182), (251, 191, 36)]

    bg_template = bytes(bg_rgb) * (RENDER_W * RENDER_H)

    notes = []
    if melody and melody.get("tracks"):
        notes = [n["pitch"] for n in melody["tracks"][0]["notes"]]
    if not notes:
        notes = [60, 62, 64, 67, 69, 72]

    events = []
    note_idx = 0

    if template_key == "pendulum-wave":
        pend_cfg = params.get("pendulum", {})
        rule_cfg = params.get("rule", {})
        count = max(6, min(24, int(pend_cfg.get("count", 15))))
        len_min = float(pend_cfg.get("length_min", 0.24))
        len_step = float(pend_cfg.get("length_step", 0.022))
        max_angle = math.radians(float(pend_cfg.get("max_angle_deg", 52)))
        damping = float(pend_cfg.get("damping", 0.0))
        cycle_sec = max(8.0, float(rule_cfg.get("cycle_sec", 24.0)))
        rule_type = rule_cfg.get("type", "harmonic_sweep")

        pivot_x = RENDER_W * 0.5
        pivot_y = RENDER_H * 0.20
        prev_thetas = [0.0] * count

        for f_idx in range(total_frames):
            t = f_idx * dt
            frame = bytearray(bg_template)
            # Center resonance trigger line & top pivot bar
            draw_line(frame, pivot_x, pivot_y, pivot_x, RENDER_H * 0.84, 1, (51, 65, 85))
            draw_line(frame, RENDER_W * 0.2, pivot_y, RENDER_W * 0.8, pivot_y, 2, (148, 163, 184))

            damp_factor = math.exp(-damping * t)
            for i in range(count):
                osc_count = 12 + (i * 1.5 if rule_type == "phase_flip" else i)
                omega = (2.0 * math.pi * osc_count) / cycle_sec
                pulse_mod = (1.0 + 0.08 * math.sin(t * 2.1)) if rule_type == "gravity_pulse" else 1.0
                theta = max_angle * damp_factor * math.cos(omega * t * pulse_mod - 1.15)
                pend_len = min(0.62, len_min + i * len_step) * RENDER_H
                bx = pivot_x + math.sin(theta) * pend_len * 0.48
                by = pivot_y + math.cos(theta) * pend_len
                col = accent_rgbs[i % len(accent_rgbs)]

                if f_idx > 0 and ((prev_thetas[i] < 0 <= theta) or (prev_thetas[i] > 0 >= theta)):
                    events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.78})
                    note_idx += 1
                prev_thetas[i] = theta

                draw_line(frame, pivot_x, pivot_y, bx, by, 1, (100, 116, 139))
                draw_circle(frame, bx, by, 5.0, col)

            proc.stdin.write(frame)

    elif template_key == "orbit-sync":
        orb_cfg = params.get("orbits", {})
        rule_cfg = params.get("rule", {})
        count = max(4, min(18, int(orb_cfg.get("count", 10))))
        base_r = float(orb_cfg.get("base_radius", 0.11))
        step_r = float(orb_cfg.get("radius_step", 0.032))
        base_omega = float(orb_cfg.get("base_omega", 1.05))
        res_ratio = float(orb_cfg.get("resonance_ratio", 0.14))
        rule_type = rule_cfg.get("type", "harmonic_align")
        trig_rad = math.radians(float(rule_cfg.get("trigger_angle_deg", -90.0)))

        cx, cy = RENDER_W * 0.5, RENDER_H * 0.50
        prev_angles = [trig_rad - 0.16 - i * 0.07 for i in range(count)]

        for f_idx in range(total_frames):
            t = f_idx * dt
            frame = bytearray(bg_template)
            beam_r = RENDER_W * 0.46
            draw_line(
                frame,
                cx,
                cy,
                cx + math.cos(trig_rad) * beam_r,
                cy + math.sin(trig_rad) * beam_r,
                2,
                (226, 232, 240),
            )
            draw_circle(frame, cx, cy, 4.5, (248, 250, 252))

            for i in range(count):
                direction = -1.0 if (rule_type == "reverse_outer" and i >= count // 2) else 1.0
                omega = direction * base_omega * (1.0 + i * res_ratio)
                angle = trig_rad - 0.16 - i * 0.07 + omega * t
                ring_r = min(0.44, base_r + i * step_r) * RENDER_W
                col = accent_rgbs[i % len(accent_rgbs)]
                draw_ring(frame, cx, cy, ring_r, 1.2, (51, 65, 85))

                if f_idx > 0:
                    prev_k = math.floor((prev_angles[i] - trig_rad) / (2.0 * math.pi))
                    curr_k = math.floor((angle - trig_rad) / (2.0 * math.pi))
                    if prev_k != curr_k:
                        events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.82})
                        note_idx += 1
                prev_angles[i] = angle

                bx = cx + math.cos(angle) * ring_r
                by = cy + math.sin(angle) * ring_r
                draw_circle(frame, bx, by, 4.8, col)

            proc.stdin.write(frame)

    elif template_key == "ball-sort":
        colors_hex = params.get("balls", {}).get("colors", ["#FF595E", "#FFCA3A", "#8AC926", "#1982C4"])
        bin_rgbs = [hex_to_rgb(c) for c in colors_hex]
        num_bins = max(2, min(6, int(params.get("bins", {}).get("count", 4))))
        ball_count = max(8, min(32, int(params.get("balls", {}).get("count", 20))))

        pegs = []
        for row in range(6):
            cols = 5 if row % 2 == 0 else 4
            py = 0.34 + row * 0.068
            for col in range(cols):
                px = 0.22 + (col + (0.5 if row % 2 == 1 else 0.0)) * 0.14
                pegs.append((px, py))

        active_balls = []
        spawn_interval = max(4, total_frames // (ball_count + 4))
        bin_counts = [0] * num_bins

        for f_idx in range(total_frames):
            t = f_idx * dt
            if f_idx % spawn_interval == 0 and len(active_balls) < ball_count:
                color_idx = len(active_balls) % num_bins
                active_balls.append({
                    "x": 0.5 + rng.uniform(-0.04, 0.04),
                    "y": 0.18,
                    "vx": rng.uniform(-0.08, 0.08),
                    "vy": 0.12,
                    "cidx": color_idx,
                    "settled": False,
                })

            frame = bytearray(bg_template)
            # Draw funnel & pegs
            draw_line(frame, 0.36 * RENDER_W, 0.16 * RENDER_H, 0.45 * RENDER_W, 0.26 * RENDER_H, 2, (148, 163, 184))
            draw_line(frame, 0.64 * RENDER_W, 0.16 * RENDER_H, 0.55 * RENDER_W, 0.26 * RENDER_H, 2, (148, 163, 184))
            for px, py in pegs:
                draw_circle(frame, px * RENDER_W, py * RENDER_H, 3.0, (148, 163, 184))

            # Draw bins
            bin_w = (RENDER_W - 32) / num_bins
            for b in range(num_bins):
                bx = int(16 + b * bin_w)
                draw_rect_outline(frame, bx + 2, int(0.79 * RENDER_H), int(bin_w - 4), int(0.13 * RENDER_H), bin_rgbs[b % len(bin_rgbs)])

            for b_obj in active_balls:
                if not b_obj["settled"]:
                    b_obj["vy"] += 0.65 * dt
                    b_obj["x"] += b_obj["vx"] * dt
                    b_obj["y"] += b_obj["vy"] * dt
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

                    # Guide subtly into target bin in lower gate
                    if b_obj["y"] > 0.72:
                        target_x = (16 + (b_obj["cidx"] + 0.5) * bin_w) / RENDER_W
                        b_obj["vx"] += (target_x - b_obj["x"]) * 6.0 * dt

                    if b_obj["y"] >= 0.88:
                        b_obj["settled"] = True
                        slot = b_obj["cidx"]
                        stack_idx = bin_counts[slot]
                        bin_counts[slot] += 1
                        b_obj["x"] = (16 + (slot + 0.5) * bin_w + ((stack_idx % 3) - 1) * 7) / RENDER_W
                        b_obj["y"] = 0.90 - (stack_idx // 3) * 0.024
                        events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.95})
                        note_idx += 1

                draw_circle(frame, b_obj["x"] * RENDER_W, b_obj["y"] * RENDER_H, 5.5, bin_rgbs[b_obj["cidx"] % len(bin_rgbs)])

            proc.stdin.write(frame)
    else:
        # melody-bounce deterministic arena simulation
        arena_cfg = params.get("arena", {})
        shape = arena_cfg.get("shape", "circle")
        rot_deg_s = float(arena_cfg.get("rotation_deg_per_s", 10.0))
        rule_cfg = params.get("rule", {})
        rule_type = rule_cfg.get("type", "speed_up")

        sides = 6 if shape == "hexagon" else 3 if shape == "triangle" else 5 if shape == "polygon" else 0
        cx, cy = RENDER_W * 0.5, RENDER_H * 0.52
        arena_r = RENDER_W * 0.39

        balls = [{
            "x": cx + rng.uniform(-12, 12),
            "y": cy - 35,
            "vx": 128.0 * (1 if rng.random() > 0.5 else -1),
            "vy": 96.0,
            "r": 7.5,
            "color": accent_rgbs[0],
            "trail": [],
        }]

        bounce_count = 0
        flash_timer = 0.0

        for f_idx in range(total_frames):
            t = f_idx * dt
            angle_rad = math.radians(rot_deg_s * t)
            flash_timer = max(0.0, flash_timer - dt)

            frame = bytearray(bg_template)

            # Arena outline (circle or rotating N-gon)
            wall_color = accent_rgbs[bounce_count % len(accent_rgbs)] if flash_timer > 0 else (203, 213, 225)
            cur_r = arena_r * (max(0.62, 1.0 - bounce_count * 0.008) if rule_type == "shrink_wall" else 1.0)
            if sides == 0:
                draw_ring(frame, cx, cy, cur_r, 3.0, wall_color)
            else:
                pts = [
                    (
                        cx + cur_r * math.cos(angle_rad + 2 * math.pi * i / sides),
                        cy + cur_r * math.sin(angle_rad + 2 * math.pi * i / sides),
                    )
                    for i in range(sides)
                ]
                for i in range(sides):
                    p0 = pts[i]
                    p1 = pts[(i + 1) % sides]
                    draw_line(frame, p0[0], p0[1], p1[0], p1[1], 3, wall_color)

            # Update & draw balls
            new_balls = []
            for b in balls:
                b["vy"] += 155.0 * dt
                b["x"] += b["vx"] * dt
                b["y"] += b["vy"] * dt
                b["trail"].append((b["x"], b["y"]))
                if len(b["trail"]) > 8:
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
                        b["vx"] -= 2.0 * dot * nx
                        b["vy"] -= 2.0 * dot * ny
                        if rule_type == "speed_up":
                            b["vx"] *= 1.025
                            b["vy"] *= 1.025
                        elif rule_type == "grow_on_bounce":
                            b["r"] = min(26.0, b["r"] * 1.035)
                        elif rule_type == "split_on_bounce" and len(balls) + len(new_balls) < 12 and bounce_count % 3 == 2:
                            new_balls.append({
                                "x": b["x"],
                                "y": b["y"],
                                "vx": -b["vx"] * 0.92 + rng.uniform(-18, 18),
                                "vy": b["vy"] * 0.95,
                                "r": max(5.0, b["r"] * 0.92),
                                "color": accent_rgbs[(len(balls) + len(new_balls)) % len(accent_rgbs)],
                                "trail": [],
                            })
                        bounce_count += 1
                        flash_timer = 0.12
                        events.append({"t": t, "midi": notes[note_idx % len(notes)], "intensity": 0.9})
                        note_idx += 1

                for tidx, (tx, ty) in enumerate(b["trail"]):
                    fade = 0.25 + 0.55 * (tidx / max(1, len(b["trail"])))
                    tr_col = (int(b["color"][0] * fade), int(b["color"][1] * fade), int(b["color"][2] * fade))
                    draw_circle(frame, tx, ty, max(2.0, b["r"] * 0.55), tr_col)

                draw_circle(frame, b["x"], b["y"], b["r"], b["color"])

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
