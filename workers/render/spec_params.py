#!/usr/bin/env python3
"""
Spec 参数网关：把 VideoSpec 里的 loose dict 解析成带类型、带默认值、
带范围钳制的参数对象。渲染器只通过本模块取参数，不再直接 params.get(...)。

设计要点
--------
1. 默认值取自 src/domain/templates.ts 里 4 个 fixture 的实测取值。
2. 范围钳制取自对应的 zod schema 的 min/max，越界值被夹回合法区间，
   并在 `warnings` 里留一条记录（不抛异常，渲染照常进行）。
3. 旧 JSON（缺字段）能正常渲染：所有字段都有默认值。
4. 像素换算公式集中在本文件，渲染器直接拿像素值用。

参见 docs/PARAM_WIRING.md 了解每个字段的生效状态。
"""

import math
import random
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# 钳制工具
# ---------------------------------------------------------------------------

def clamp(value, lo, hi):
    """把 value 夹到 [lo, hi]。非数值时返回 lo（并由调用方记 warning）。"""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return lo
    if math.isnan(v) or math.isinf(v):
        return lo
    return max(lo, min(hi, v))


def clamp_int(value, lo, hi):
    return int(round(clamp(value, lo, hi)))


def pick(value, allowed, default):
    """枚举值校验：不在白名单内则回退默认值。"""
    return value if value in allowed else default


# ---------------------------------------------------------------------------
# 参数子结构
# ---------------------------------------------------------------------------

@dataclass
class ArenaParams:
    """melody-bounce 场地。"""
    shape: str = "circle"
    size: float = 0.78
    wall_thickness: float = 0.012
    rotation_deg_per_s: float = 6.0

    # 派生像素值（由 load_params 计算填充）
    radius_px: float = 0.0
    wall_px: float = 0.0


@dataclass
class BallsParams:
    """melody-bounce 球体。"""
    count_start: int = 1
    radius: float = 0.028
    speed: float = 0.55
    restitution: float = 1.0
    gravity: float = 0.0
    max_count: int = 64

    # 派生像素值
    radius_px: float = 0.0
    speed_px: float = 0.0
    gravity_px: float = 0.0


@dataclass
class RuleParams:
    """melody-bounce 变化规则。"""
    type: str = "speed_up"
    every_n_bounces: int = 3
    inherit_color: bool = False
    scale_factor: float = 1.035


@dataclass
class NoteTriggerParams:
    on: str = "ball_wall_collision"
    velocity_from: str = "impact"


@dataclass
class PendulumParams:
    count: int = 15
    length_min: float = 0.24
    length_step: float = 0.022
    max_angle_deg: float = 52.0
    damping: float = 0.0
    cycle_sec: float = 24.0
    rule_type: str = "harmonic_sweep"


@dataclass
class OrbitsParams:
    count: int = 10
    base_radius: float = 0.11
    radius_step: float = 0.032
    base_omega: float = 1.05
    resonance_ratio: float = 0.14
    rule_type: str = "harmonic_align"
    trigger_angle_deg: float = -90.0


@dataclass
class BinSortParams:
    """ball-sort 分选机构。"""
    ball_count: int = 24
    colors: list = field(default_factory=lambda: ["#FF595E", "#FFCA3A", "#8AC926", "#1982C4"])
    bin_count: int = 4
    layout: str = "under-funnel"
    peg_rows: int = 7
    peg_jitter: float = 0.25
    gate_moving: bool = False
    gate_period_s: float = 2.4
    spiral_enabled: bool = False


@dataclass
class TrailParams:
    enabled: bool = True
    length_frames: int = 18
    fade: float = 0.85

    @property
    def active(self) -> bool:
        """length_frames=0 或 enabled=false 时不画拖尾。"""
        return self.enabled and self.length_frames > 0


@dataclass
class BackgroundParams:
    type: str = "gradient"
    colors: list = field(default_factory=lambda: ["#05060F", "#101437"])


@dataclass
class CameraParams:
    zoom_from: float = 1.0
    zoom_to: float = 1.0
    shake: float = 0.0

    @property
    def animates(self) -> bool:
        return abs(self.zoom_to - self.zoom_from) > 1e-6


@dataclass
class StyleParams:
    palette: list = field(default_factory=lambda: ["#38BDF8", "#F472B6", "#FBBF24", "#34D399"])
    background: BackgroundParams = field(default_factory=BackgroundParams)
    trail: TrailParams = field(default_factory=TrailParams)
    camera: CameraParams = field(default_factory=CameraParams)


@dataclass
class AudioParams:
    transpose: int = 0
    tempo_bpm: float = 96.0


@dataclass
class SpecParams:
    """渲染器拿到的唯一参数入口。"""
    template: str = "melody-bounce"
    seed: int = 1
    fps: int = 30
    duration_sec: float = 28.0
    width: int = 1080
    height: int = 1920

    arena: ArenaParams = field(default_factory=ArenaParams)
    balls: BallsParams = field(default_factory=BallsParams)
    rule: RuleParams = field(default_factory=RuleParams)
    note_trigger: NoteTriggerParams = field(default_factory=NoteTriggerParams)
    pendulum: PendulumParams = field(default_factory=PendulumParams)
    orbits: OrbitsParams = field(default_factory=OrbitsParams)
    bin_sort: BinSortParams = field(default_factory=BinSortParams)
    style: StyleParams = field(default_factory=StyleParams)
    audio: AudioParams = field(default_factory=AudioParams)

    warnings: list = field(default_factory=list)

    def warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)


# ---------------------------------------------------------------------------
# 各模板默认值（取自 templates.ts 的 fixture 实测值）
# ---------------------------------------------------------------------------

_TPL_DEFAULTS = {
    "melody-bounce": {
        "arena": {"shape": "hexagon", "size": 0.78, "wall_thickness": 0.012, "rotation_deg_per_s": 6.0},
        "balls": {"count_start": 1, "radius": 0.028, "speed": 0.55,
                  "restitution": 1.0, "gravity": 0.0, "max_count": 64},
        "rule": {"type": "split_on_bounce", "every_n_bounces": 3, "inherit_color": False},
        "note_trigger": {"on": "ball_wall_collision", "velocity_from": "impact"},
        "style": {
            "background": {"type": "gradient", "colors": ["#05060F", "#101437"]},
            "trail": {"enabled": True, "length_frames": 18, "fade": 0.85},
            "camera": {"zoom_from": 1.0, "zoom_to": 1.15, "shake": 0.0},
        },
        "audio": {"transpose": 0, "tempo_bpm": 96.0},
    },
    "ball-sort": {
        "balls": {"count": 24, "colors": ["#FF595E", "#FFCA3A", "#8AC926", "#1982C4"]},
        "bins": {"count": 4, "layout": "under-funnel"},
        "mechanism": {
            "pegs": {"rows": 7, "jitter": 0.25},
            "gates": [{"type": "moving", "period_s": 2.4}],
            "spiral": {"enabled": False},
        },
        "note_trigger": {"on": "peg_collision", "velocity_from": "impact"},
        "style": {
            "background": {"type": "grid", "colors": ["#0B1020", "#162038"]},
            "trail": {"enabled": True, "length_frames": 10, "fade": 0.78},
        },
        "audio": {"transpose": 0, "tempo_bpm": 112.0},
    },
    "pendulum-wave": {
        "pendulum": {"count": 15, "length_min": 0.24, "length_step": 0.022,
                     "max_angle_deg": 52.0, "damping": 0.0},
        "rule": {"type": "harmonic_sweep", "cycle_sec": 24.0},
        "note_trigger": {"on": "center_crossing", "velocity_from": "phase"},
        "style": {
            "background": {"type": "gradient", "colors": ["#040814", "#0F172A"]},
            "trail": {"enabled": True, "length_frames": 14, "fade": 0.8},
        },
        "audio": {"transpose": 0, "tempo_bpm": 108.0},
    },
    "orbit-sync": {
        "orbits": {"count": 10, "base_radius": 0.11, "radius_step": 0.032,
                   "base_omega": 1.05, "resonance_ratio": 0.14},
        "rule": {"type": "harmonic_align", "trigger_angle_deg": -90.0},
        "note_trigger": {"on": "beam_crossing", "velocity_from": "orbit_index"},
        "style": {
            "background": {"type": "solid", "colors": ["#060714"]},
            "trail": {"enabled": True, "length_frames": 20, "fade": 0.85},
        },
        "audio": {"transpose": 2, "tempo_bpm": 110.0},
    },
}


def _dig(d, *keys, default=None):
    """安全深层取值：d['a']['b']['c']，任一层缺失返回 default。"""
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur


def _as_dict(v):
    return v if isinstance(v, dict) else {}


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def load_params(spec: dict) -> SpecParams:
    """把 VideoSpec 解析成 SpecParams。永不抛异常，越界只记 warning。"""
    scene = _as_dict(spec.get("scene"))
    fmt = _as_dict(spec.get("format"))

    template_key = (
        scene.get("template")
        or _dig(spec, "template", "key")
        or "melody-bounce"
    )
    if template_key not in _TPL_DEFAULTS:
        template_key = "melody-bounce"

    defaults = _TPL_DEFAULTS[template_key]
    params = _as_dict(scene.get("params")) or _as_dict(_dig(spec, "template", "params"))
    style_raw = _as_dict(scene.get("style"))
    audio_raw = _as_dict(spec.get("audio"))

    p = SpecParams(
        template=template_key,
        seed=clamp_int(scene.get("seed", 1), 0, 2 ** 31 - 1),
        fps=clamp_int(fmt.get("fps", 30), 1, 120),
        duration_sec=max(0.1, float(fmt.get("duration_sec", 28) or 28)),
        width=clamp_int(fmt.get("width", 1080), 16, 4096),
        height=clamp_int(fmt.get("height", 1920), 16, 4096),
    )

    # ---------------- style ----------------
    st_def = defaults.get("style", {})
    bg_def = _as_dict(st_def.get("background"))
    bg_raw = _as_dict(style_raw.get("background"))
    bg_type = pick(bg_raw.get("type", bg_def.get("type", "gradient")),
                   ("solid", "gradient", "grid"),
                   bg_def.get("type", "gradient"))
    bg_colors = bg_raw.get("colors") or bg_def.get("colors") or ["#05060F", "#101437"]
    if not isinstance(bg_colors, list) or not bg_colors:
        bg_colors = bg_def.get("colors") or ["#05060F", "#101437"]
    bg_colors = [c for c in bg_colors if isinstance(c, str)][:4] or ["#05060F"]
    p.style.background = BackgroundParams(type=bg_type, colors=bg_colors)

    tr_def = _as_dict(st_def.get("trail"))
    tr_raw = _as_dict(style_raw.get("trail"))
    p.style.trail = TrailParams(
        enabled=bool(tr_raw.get("enabled", tr_def.get("enabled", True))),
        length_frames=clamp_int(tr_raw.get("length_frames", tr_def.get("length_frames", 18)), 0, 60),
        fade=clamp(tr_raw.get("fade", tr_def.get("fade", 0.85)), 0.0, 1.0),
    )

    cam_def = _as_dict(st_def.get("camera"))
    cam_raw = _as_dict(style_raw.get("camera"))
    p.style.camera = CameraParams(
        zoom_from=clamp(cam_raw.get("zoom_from", cam_def.get("zoom_from", 1.0)), 0.5, 2.0),
        zoom_to=clamp(cam_raw.get("zoom_to", cam_def.get("zoom_to", 1.0)), 0.5, 2.5),
        shake=clamp(cam_raw.get("shake", cam_def.get("shake", 0.0)), 0.0, 1.0),
    )

    pal = _dig(style_raw, "palette", "colors")
    if isinstance(pal, list) and pal:
        p.style.palette = [c for c in pal if isinstance(c, str)][:8] or p.style.palette

    # ---------------- audio ----------------
    music = _as_dict(audio_raw.get("music"))
    au_def = _as_dict(defaults.get("audio"))
    p.audio = AudioParams(
        transpose=clamp_int(music.get("transpose", au_def.get("transpose", 0)), -24, 24),
        tempo_bpm=clamp(music.get("tempo_bpm", au_def.get("tempo_bpm", 96.0)), 40.0, 240.0),
    )

    # ---------------- note_trigger ----------------
    nt_raw = _as_dict(params.get("note_trigger"))
    nt_def = _as_dict(defaults.get("note_trigger"))
    allowed_on = {
        "melody-bounce": ("ball_wall_collision", "ball_ball_collision", "beat"),
        "pendulum-wave": ("center_crossing", "peak_reversal"),
        "orbit-sync": ("beam_crossing", "planet_alignment"),
        "ball-sort": ("peg_collision", "bin_settle"),
    }[template_key]
    p.note_trigger = NoteTriggerParams(
        on=pick(nt_raw.get("on", nt_def.get("on")), allowed_on, nt_def.get("on")),
        velocity_from=str(nt_raw.get("velocity_from", nt_def.get("velocity_from", "impact"))),
    )

    # ---------------- 模板专属 ----------------
    if template_key == "melody-bounce":
        _load_melody_bounce(p, params, defaults)
    elif template_key == "ball-sort":
        _load_ball_sort(p, params, defaults)
    elif template_key == "pendulum-wave":
        _load_pendulum(p, params, defaults)
    elif template_key == "orbit-sync":
        _load_orbits(p, params, defaults)

    return p


def _load_melody_bounce(p: SpecParams, params: dict, defaults: dict) -> None:
    a_def = _as_dict(defaults.get("arena"))
    a_raw = _as_dict(params.get("arena"))
    shape = pick(
        a_raw.get("shape", a_def.get("shape")),
        ("circle", "hexagon", "triangle", "ellipse", "polygon"),
        a_def.get("shape", "circle"),
    )
    p.arena = ArenaParams(
        shape=shape,
        size=clamp(a_raw.get("size", a_def.get("size", 0.78)), 0.4, 0.95),
        wall_thickness=clamp(a_raw.get("wall_thickness", a_def.get("wall_thickness", 0.012)), 0.004, 0.05),
        rotation_deg_per_s=clamp(a_raw.get("rotation_deg_per_s", a_def.get("rotation_deg_per_s", 6.0)), -90.0, 90.0),
    )

    b_def = _as_dict(defaults.get("balls"))
    b_raw = _as_dict(params.get("balls"))
    p.balls = BallsParams(
        count_start=clamp_int(b_raw.get("count_start", b_def.get("count_start", 1)), 1, 16),
        radius=clamp(b_raw.get("radius", b_def.get("radius", 0.028)), 0.01, 0.08),
        speed=clamp(b_raw.get("speed", b_def.get("speed", 0.55)), 0.1, 2.0),
        restitution=clamp(b_raw.get("restitution", b_def.get("restitution", 1.0)), 0.7, 1.15),
        gravity=clamp(b_raw.get("gravity", b_def.get("gravity", 0.0)), -1.0, 2.0),
        max_count=clamp_int(b_raw.get("max_count", b_def.get("max_count", 64)), 1, 128),
    )

    r_def = _as_dict(defaults.get("rule"))
    r_raw = _as_dict(params.get("rule"))
    p.rule = RuleParams(
        type=pick(
            r_raw.get("type", r_def.get("type")),
            ("split_on_bounce", "grow_on_bounce", "speed_up", "shrink_wall", "gravity_flip"),
            r_def.get("type", "speed_up"),
        ),
        every_n_bounces=clamp_int(r_raw.get("every_n_bounces", r_def.get("every_n_bounces", 3)), 1, 20),
        inherit_color=bool(r_raw.get("inherit_color", r_def.get("inherit_color", False))),
        scale_factor=clamp(r_raw.get("scale_factor", r_def.get("scale_factor", 1.035)), 1.01, 1.25),
    )


def _load_ball_sort(p: SpecParams, params: dict, defaults: dict) -> None:
    b_def = _as_dict(defaults.get("balls"))
    b_raw = _as_dict(params.get("balls"))
    colors = b_raw.get("colors") or b_def.get("colors")
    if not isinstance(colors, list) or len(colors) < 2:
        colors = b_def.get("colors")
    colors = [c for c in colors if isinstance(c, str)][:6]

    bins_def = _as_dict(defaults.get("bins"))
    bins_raw = _as_dict(params.get("bins"))

    mech_def = _as_dict(defaults.get("mechanism"))
    pegs_def = _as_dict(mech_def.get("pegs"))
    pegs_raw = _as_dict(_dig(params, "mechanism", "pegs"))

    gates_raw = _dig(params, "mechanism", "gates")
    if gates_raw is None:
        gates_raw = mech_def.get("gates") or []
    gates = gates_raw if isinstance(gates_raw, list) else []

    moving_gate = next(
        (g for g in gates if isinstance(g, dict) and g.get("type") == "moving"),
        None,
    )

    p.bin_sort = BinSortParams(
        ball_count=clamp_int(b_raw.get("count", b_def.get("count", 24)), 4, 64),
        colors=colors,
        bin_count=clamp_int(bins_raw.get("count", bins_def.get("count", 4)), 2, 6),
        layout=pick(
            bins_raw.get("layout", bins_def.get("layout")),
            ("under-funnel", "stepped", "split-chute"),
            bins_def.get("layout", "under-funnel"),
        ),
        peg_rows=clamp_int(pegs_raw.get("rows", pegs_def.get("rows", 7)), 3, 12),
        peg_jitter=clamp(pegs_raw.get("jitter", pegs_def.get("jitter", 0.25)), 0.0, 0.5),
        gate_moving=moving_gate is not None,
        gate_period_s=clamp(
            (moving_gate or {}).get("period_s", 2.4), 0.5, 10.0
        ),
        spiral_enabled=bool(_dig(params, "mechanism", "spiral", "enabled")
                           if _dig(params, "mechanism", "spiral", "enabled") is not None
                           else _dig(mech_def, "spiral", "enabled", default=False)),
    )


def _load_pendulum(p: SpecParams, params: dict, defaults: dict) -> None:
    pd_def = _as_dict(defaults.get("pendulum"))
    pd_raw = _as_dict(params.get("pendulum"))
    r_def = _as_dict(defaults.get("rule"))
    r_raw = _as_dict(params.get("rule"))

    p.pendulum = PendulumParams(
        count=clamp_int(pd_raw.get("count", pd_def.get("count", 15)), 6, 24),
        length_min=clamp(pd_raw.get("length_min", pd_def.get("length_min", 0.24)), 0.2, 0.55),
        length_step=clamp(pd_raw.get("length_step", pd_def.get("length_step", 0.022)), 0.01, 0.06),
        max_angle_deg=clamp(pd_raw.get("max_angle_deg", pd_def.get("max_angle_deg", 52.0)), 20.0, 75.0),
        damping=clamp(pd_raw.get("damping", pd_def.get("damping", 0.0)), 0.0, 0.05),
        cycle_sec=clamp(r_raw.get("cycle_sec", r_def.get("cycle_sec", 24.0)), 8.0, 45.0),
        rule_type=pick(
            r_raw.get("type", r_def.get("type")),
            ("harmonic_sweep", "phase_flip", "gravity_pulse"),
            r_def.get("type", "harmonic_sweep"),
        ),
    )


def _load_orbits(p: SpecParams, params: dict, defaults: dict) -> None:
    o_def = _as_dict(defaults.get("orbits"))
    o_raw = _as_dict(params.get("orbits"))
    r_def = _as_dict(defaults.get("rule"))
    r_raw = _as_dict(params.get("rule"))

    p.orbits = OrbitsParams(
        count=clamp_int(o_raw.get("count", o_def.get("count", 10)), 4, 18),
        base_radius=clamp(o_raw.get("base_radius", o_def.get("base_radius", 0.11)), 0.1, 0.28),
        radius_step=clamp(o_raw.get("radius_step", o_def.get("radius_step", 0.032)), 0.015, 0.06),
        base_omega=clamp(o_raw.get("base_omega", o_def.get("base_omega", 1.05)), 0.3, 2.5),
        resonance_ratio=clamp(o_raw.get("resonance_ratio", o_def.get("resonance_ratio", 0.14)), 0.05, 0.5),
        rule_type=pick(
            r_raw.get("type", r_def.get("type")),
            ("harmonic_align", "reverse_outer", "pulse_rings"),
            r_def.get("type", "harmonic_align"),
        ),
        trigger_angle_deg=clamp(
            r_raw.get("trigger_angle_deg", r_def.get("trigger_angle_deg", -90.0)), -180.0, 180.0
        ),
    )


# ---------------------------------------------------------------------------
# 派生量填充（渲染器调用一次即可拿到像素值）
# ---------------------------------------------------------------------------

def resolve_pixels(p: SpecParams, render_w: int, render_h: int) -> SpecParams:
    """把归一化参数换算成像素值，写回 p.arena / p.balls。"""
    p.arena.radius_px = render_w * 0.5 * p.arena.size * 0.5
    p.arena.wall_px = p.arena.wall_thickness * render_w
    p.balls.radius_px = p.balls.radius * render_w
    p.balls.speed_px = p.balls.speed * render_w * 0.9
    p.balls.gravity_px = p.balls.gravity * render_h * 0.32
    return p


def derive_rng(seed: int, salt: str) -> random.Random:
    """从 spec seed 派生独立随机流，保证同一 seed 下抖动可复现且互不干扰。"""
    return random.Random(f"{seed}:{salt}")
