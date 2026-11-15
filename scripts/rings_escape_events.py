#!/usr/bin/env python3
"""T10：导出 rings-escape 的事件序列（供 TS/Python 对比测试用）。

这套规则与 src/domain/simulation.ts 的 rings-escape 分支、
workers/render/render_worker.py 的 rings-escape 分支保持一致。
只做纯模拟、不渲染，方便快速对比。
"""
import json
import math
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src" / "domain"))
sys.path.insert(0, str(ROOT / "workers" / "render"))

PENTATONIC = [60, 62, 64, 67, 69, 72, 74, 76]


def load_spec():
    p = ROOT / "out" / "payloads" / "rings-escape.json"
    if p.exists():
        return json.loads(p.read_text())["spec"]
    # 兜底：直接读 TS fixture 里的关键字段
    return json.loads((ROOT / "out" / "payloads" / "rings-escape.json").read_text())["spec"]


def note_midi(notes, idx, transpose):
    if not notes:
        return PENTATONIC[idx % len(PENTATONIC)] + transpose
    return notes[idx % len(notes)]["pitch"] + transpose


def simulate(spec):
    scene = spec.get("scene") or {}
    params = scene.get("params") or {}
    rr = params.get("rings") or {}
    rb = params.get("balls") or {}
    rule = (params.get("rule") or {}).get("type", "respawn_ring")

    fps = int(spec["format"]["fps"])
    duration = float(spec["format"]["duration_sec"])
    total_frames = round(fps * duration)
    dt = 1.0 / fps
    melody = spec.get("melody") or {}
    tracks = melody.get("tracks") or []
    notes = (tracks[0].get("notes") if tracks else None) or []
    transpose = int(((spec.get("audio") or {}).get("music") or {}).get("transpose", 0))

    ring_count0 = max(3, min(10, int(rr.get("count", 6))))
    base_r = float(rr.get("base_radius", 0.16))
    step_r = float(rr.get("radius_step", 0.045))
    gap_deg = max(18.0, min(70.0, float(rr.get("gap_deg", 40))))
    rot_deg = float(rr.get("rotation_deg_per_s", 24))

    ball_count = max(1, min(8, int(rb.get("count", 1))))
    ball_r = float(rb.get("radius", 0.02))
    gravity = float(rb.get("gravity", 0.25))
    restitution = float(rb.get("restitution", 0.95))

    KINDNESS_SEC = 2.5
    ESCAPE_PULL = 1.6

    rings = []
    for i in range(ring_count0):
        d = 1 if i % 2 == 0 else -1
        rings.append({
            "idx": i,
            "radius": base_r + i * step_r,
            "angle0": i * 2.0 * math.pi / ring_count0,
            "omega": d * math.radians(rot_deg) * (1.15 ** i),
            "gap": math.radians(gap_deg),
            "alive": True,
        })
    respawned = 0

    balls = []
    for i in range(ball_count):
        ang = i / max(1, ball_count) * 2.0 * math.pi + 0.3
        r0 = base_r * 0.42
        balls.append({
            "id": i,
            "x": 0.5 + math.cos(ang) * r0,
            "y": 0.5 + math.sin(ang) * r0,
            "vx": math.cos(ang + 0.15) * 0.46,
            "vy": math.sin(ang + 0.15) * 0.46,
            "r": ball_r,
            "best": 0,
            "prevDist": r0,
        })

    events = []
    note_cursor = 0
    last_pass = 0.0

    for f in range(total_frames):
        t = round(f * dt, 4)

        if t - last_pass > KINDNESS_SEC and t > 0:
            live = sorted([r for r in rings if r["alive"]], key=lambda r: r["radius"])
            if live and balls:
                inner = live[0]
                b = balls[0]
                ball_ang = math.atan2(b["y"] - 0.5, b["x"] - 0.5)
                cur = inner["angle0"] + inner["omega"] * t
                inner["angle0"] += (ball_ang - cur) * 0.12
                inner["omega"] *= 0.97

        live_sorted = sorted([r for r in rings if r["alive"]], key=lambda r: r["radius"])

        for b in list(balls):
            b["vy"] += gravity * dt * 0.28
            b["x"] += b["vx"] * dt
            b["y"] += b["vy"] * dt

            dx = b["x"] - 0.5
            dy = b["y"] - 0.5
            dist = math.hypot(dx, dy)
            prev = b["prevDist"]

            if dist < base_r * 1.15 and dist > 1e-6:
                b["vx"] += (dx / dist) * ESCAPE_PULL * dt
                b["vy"] += (dy / dist) * ESCAPE_PULL * dt

            for li, ring in enumerate(live_sorted):
                gap_center = ring["angle0"] + ring["omega"] * t
                half = ring["gap"] / 2.0
                ang_diff = math.atan2(dy, dx) - gap_center
                while ang_diff > math.pi:
                    ang_diff -= 2 * math.pi
                while ang_diff < -math.pi:
                    ang_diff += 2 * math.pi
                in_gap = abs(ang_diff) < half

                crossed = ((prev - ring["radius"]) * (dist - ring["radius"]) <= 0
                           and prev != dist)
                band = abs(dist - ring["radius"])

                if crossed or band < b["r"] + 0.004:
                    if in_gap:
                        if ring["alive"]:
                            midi = note_midi(notes, note_cursor, transpose)
                            note_cursor += 1
                            events.append({
                                "t": t, "type": "ring_pass",
                                "x": round(b["x"], 4), "y": round(b["y"], 4),
                                "intensity": 1.0, "midi": midi,
                                "ring_index": ring["idx"],
                            })
                            last_pass = t
                            ring["alive"] = False
                            b["best"] = li + 1
                            if rule == "respawn_ring":
                                maxr = max(r["radius"] for r in rings)
                                d = 1 if respawned % 2 == 0 else -1
                                rings.append({
                                    "idx": ring_count0 + respawned,
                                    "radius": min(0.72, maxr + step_r),
                                    "angle0": (respawned * 1.7) % (2 * math.pi),
                                    "omega": d * math.radians(rot_deg) * (1.15 ** (ring_count0 + respawned)),
                                    "gap": math.radians(gap_deg),
                                    "alive": True,
                                })
                                respawned += 1
                            elif rule == "shrink_gap":
                                for r2 in rings:
                                    if r2["alive"] and r2["radius"] > ring["radius"]:
                                        r2["gap"] *= 0.85
                            elif rule == "ball_split_on_escape":
                                if len(balls) < 8:
                                    na = math.atan2(b["vy"], b["vx"]) + 0.6
                                    sp = math.hypot(b["vx"], b["vy"])
                                    balls.append({
                                        "id": len(balls),
                                        "x": b["x"], "y": b["y"],
                                        "vx": math.cos(na) * sp, "vy": math.sin(na) * sp,
                                        "r": b["r"], "best": b["best"],
                                        "prevDist": b["prevDist"],
                                    })
                    else:
                        nxn = dx / (dist or 1.0)
                        nyn = dy / (dist or 1.0)
                        vn = b["vx"] * nxn + b["vy"] * nyn
                        if ((dist < ring["radius"] and vn > 0) or
                                (dist > ring["radius"] and vn < 0)):
                            b["vx"] -= (1.0 + restitution) * vn * nxn
                            b["vy"] -= (1.0 + restitution) * vn * nyn
                            push = -1.0 if dist < ring["radius"] else 1.0
                            b["x"] = 0.5 + nxn * (ring["radius"] + push * (b["r"] + 0.004))
                            b["y"] = 0.5 + nyn * (ring["radius"] + push * (b["r"] + 0.004))
                            events.append({
                                "t": t, "type": "wall_bounce",
                                "x": round(b["x"], 4), "y": round(b["y"], 4),
                                "intensity": 0.4,
                                "midi": note_midi(notes, 0, transpose) + 12,
                            })

            b["prevDist"] = dist

    return events


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "-"
    spec = load_spec()
    events = simulate(spec)
    payload = {"count": len(events), "events": events}
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if out_path == "-":
        print(text)
    else:
        pathlib.Path(out_path).write_text(text)
        print(f"{len(events)} events → {out_path}")


if __name__ == "__main__":
    main()
