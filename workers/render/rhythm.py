#!/usr/bin/env python3
"""
节奏对齐 (T8)：让 melody-bounce 的弹球撞墙时刻对上原曲节拍。

核心思路
--------
每次主球刚撞完墙、拿到新方向后，算出"沿这个方向还要走多远才撞下一次"（距离 d），
再查下一个尚未发声的音符还有多久（Δt），把速度设成 d/Δt，球就会正好在
下一个音符该响的时刻撞到墙 —— 于是"撞墙 = 发声"，旋律节奏与原曲一致。

约束
----
- 只在 |gravity| ≤ 0.05 时启用；有重力时回落到旧逻辑。
- 速度限制在 [0.55, 1.8] × balls.speed。
- 偏差 > 0.08 秒的音符丢弃，等下一次碰撞。
- 只有主球（第一个球）锁定节奏，其他球只发装饰音。
"""

import math

MAX_GRAVITY_FOR_RHYTHM = 0.05
SPEED_MIN_MULT = 0.55
SPEED_MAX_MULT = 1.8
MAX_TOLERANCE_SEC = 0.080
DECOR_INTENSITY = 0.35


# ---------------------------------------------------------------------------
# 几何：沿方向到下一次撞墙的距离
# ---------------------------------------------------------------------------

def distance_to_circle(cx, cy, radius, px, py, dx, dy):
    """射线与圆求交（解析解），返回沿 (dx,dy) 到圆周的正距离。

    球在圆内，求离开圆的交点。
    """
    # 归一化方向
    norm = math.hypot(dx, dy)
    if norm < 1e-9:
        return None
    dx, dy = dx / norm, dy / norm

    ox, oy = px - cx, py - cy
    # 方向必须大致朝外（否则永远出不去）
    if ox * dx + oy * dy <= 0:
        return None
    b = 2.0 * (ox * dx + oy * dy)
    c = ox * ox + oy * oy - radius * radius
    disc = b * b - 4.0 * c
    if disc < 0:
        return None
    sq = math.sqrt(disc)
    # 两个根，取较大的正值（离开方向）
    t1 = (-b + sq) / 2.0
    t2 = (-b - sq) / 2.0
    eps = radius * 0.02
    for t in (t1, t2):
        if t > eps:
            return t
    return None


def distance_to_polygon(cx, cy, radius, sides, angle_rad, px, py, dx, dy):
    """射线与每条边求交，取最近的**正**距离。

    球刚撞墙后被推回到 (limit) 处，因此会紧贴当前边。
    这里用 eps 把"紧贴的边"排除掉：交点到出发点的距离必须
    大于一个微小阈值，才能算作"下一次"撞墙。
    """
    norm = math.hypot(dx, dy)
    if norm < 1e-9:
        return None
    dx, dy = dx / norm, dy / norm

    verts = [
        (cx + radius * math.cos(angle_rad + 2.0 * math.pi * i / sides),
         cy + radius * math.sin(angle_rad + 2.0 * math.pi * i / sides))
        for i in range(sides)
    ]

    eps = radius * 0.02          # 紧贴判定的容差
    best = None
    for i in range(sides):
        ax, ay = verts[i]
        bx, by = verts[(i + 1) % sides]
        ex, ey = bx - ax, by - ay

        denom = dx * ey - dy * ex
        if abs(denom) < 1e-12:
            continue
        qx, qy = ax - px, ay - py
        t = (qx * ey - qy * ex) / denom
        u = (qx * dy - qy * dx) / denom
        if t > eps and -1e-9 <= u <= 1.0 + 1e-9:
            if best is None or t < best:
                best = t
    return best


def distance_to_wall(shape_sides, cx, cy, radius, angle_rad, px, py, dx, dy,
                     step_out=0.0):
    """按场地形状分派。sides==0 表示圆形。

    step_out > 0 时，先把起点沿出射方向推进 step_out 像素，
    用于"球刚撞墙、位置仍贴在墙上"的情形 —— 否则射线会立刻
    打到相邻边，得到只有几个像素的假距离。
    """
    if step_out > 0:
        n = math.hypot(dx, dy)
        if n > 1e-9:
            px = px + dx / n * step_out
            py = py + dy / n * step_out

    if shape_sides == 0:
        return distance_to_circle(cx, cy, radius, px, py, dx, dy)
    return distance_to_polygon(cx, cy, radius, shape_sides, angle_rad, px, py, dx, dy)


# ---------------------------------------------------------------------------
# 音符时间表
# ---------------------------------------------------------------------------

class Schedule:
    """按需循环的音符时间表。"""

    def __init__(self, notes, tempo_bpm, transpose, wrap, duration):
        self.tempo_bpm = float(tempo_bpm)
        self.wrap = wrap
        self.duration = duration
        self.base = []
        for n in notes:
            beat = float(n.get("beat", 0.0))
            t = beat * 60.0 / self.tempo_bpm
            self.base.append({
                "t": t,
                "pitch": int(n.get("pitch", 60)) + int(transpose),
                "dur": float(n.get("dur", 1.0)) * 60.0 / self.tempo_bpm,
                "vel": float(n.get("vel", 88)),
            })
        self.base.sort(key=lambda x: x["t"])
        # 旋律总长 = 最后一个音的起始 + 它的时长
        if self.base:
            last = self.base[-1]
            self.loop_len = max(last["t"] + last["dur"], 1e-3)
        else:
            self.loop_len = 1e-3

        self._cache = []

    def at_index(self, idx):
        """第 idx 个音符（按需循环）。clamp 模式下超出返回 None。"""
        while len(self._cache) <= idx:
            i = len(self._cache)
            if not self.base:
                return None
            k = i % len(self.base)
            cycle = i // len(self.base)
            if self.wrap != "loop" and cycle > 0:
                return None
            src = self.base[k]
            self._cache.append({
                "t": src["t"] + cycle * self.loop_len,
                "pitch": src["pitch"],
                "dur": src["dur"],
                "vel": src["vel"],
            })
        return self._cache[idx]

    def count(self):
        return len(self.base)


# ---------------------------------------------------------------------------
# 速度调节器
# ---------------------------------------------------------------------------

class RhythmLock:
    """主球速度调节器。每次撞墙后调用。"""

    def __init__(self, schedule, base_speed, shape_sides, cx, cy, radius,
                 get_angle, duration):
        self.schedule = schedule
        self.base_speed = max(1e-6, base_speed)
        self.shape_sides = shape_sides
        self.cx = cx
        self.cy = cy
        self.radius = radius
        self.get_angle = get_angle       # callable(t) -> 场地旋转角（弧度）
        self.duration = duration

        self.next_index = 0             # 下一个尚未发声的音符
        self.emitted = 0
        self.dropped = 0
        self.deviations = []            # 每个音符的偏差（秒）
        self.clamped_count = 0          # 速度被限幅的次数
        self.needed_mult_max = 0.0      # 需求速度相对 base 的最大倍数（诊断用）
        self.locked_note = None         # 已锁定但尚未到达的音符
        self.locked_hops_left = 0       # 还需几次反弹才到该音符
        self._locked_speed = None

    # -- 查询 -----------------------------------------------------------

    def peek_next(self):
        return self.schedule.at_index(self.next_index)

    def consume(self, actual_time, note=None, tolerance=MAX_TOLERANCE_SEC):
        """消费下一个音符：记录偏差并推进。

        偏差 > tolerance 时记为丢弃并返回 None。
        """
        if note is None:
            note = self.schedule.at_index(self.next_index)
        if note is None:
            return None
        dev = abs(actual_time - note["t"])
        self.next_index += 1
        if dev > tolerance:
            self.dropped += 1
            return None
        self.deviations.append(dev)
        self.emitted += 1
        return note

    def skip_past(self, t_now):
        """只丢弃"已经完全错过且无法追上"的音符。

        判据：音符时间早于 t_now，且球即使以最低速度也赶不上。
        注意 t=0 的音符在第一次撞墙前就已过期，属于正常损失（最多丢 1-2 个），
        不应把后续音符一并丢掉。
        """
        note = self.schedule.at_index(self.next_index)
        while note is not None and note["t"] < t_now - MAX_TOLERANCE_SEC:
            self.dropped += 1
            self.next_index += 1
            note = self.schedule.at_index(self.next_index)

    # -- 速度计算 -------------------------------------------------------

    def solve_speed(self, t_now, px, py, dx, dy, radius, spd_m=1.0):
        """撞墙后计算新速度（严格按任务原文的实现）。

        1. 取下一个尚未发声的音符 t_next，Δt = t_next - t_now
        2. 算沿新方向到下一次撞墙的距离 d
        3. 速度 = d / Δt，限制在 [0.55, 1.8] × 基准速度
        4. 若被限幅，音符"跟随最近一次碰撞"发声，偏差由调用方判 80ms
        """
        m = spd_m if spd_m > 1e-6 else 1.0
        lo = SPEED_MIN_MULT * self.base_speed
        hi = SPEED_MAX_MULT * self.base_speed

        note = self.schedule.at_index(self.next_index)
        if note is None:
            return None, None, None

        dt_need = note["t"] - t_now
        if dt_need <= 1e-6:
            # 音符时刻已到/已过：跟随本次碰撞发声
            self.next_index += 1
            if -dt_need <= MAX_TOLERANCE_SEC:
                self.deviations.append(-dt_need)
                self.emitted += 1
                return self.base_speed, note, dt_need
            # 过期太远：丢弃，并尝试追上下一个（不要卡在同一个音符上）
            self.dropped += 1
            return self.solve_speed(t_now, px, py, dx, dy, radius, spd_m)

        angle = self.get_angle(t_now)

        # 注意：渲染器把球心钳制在以 radius 为半径的外接圆上，
        # 而多边形的边在内切圆处。所以墙面外接圆半径 = radius / cos(π/sides)。
        # 用真实墙面求交，才能算准"到下一次撞墙"的距离。
        if self.shape_sides == 0:
            wall_r = radius
        else:
            wall_r = radius / math.cos(math.pi / self.shape_sides)

        # 球刚撞墙时位置贴在墙上，射线会立刻打在相邻边/顶点附近，
        # 得到只有几像素的假距离。自适应地沿出射方向推出一段再求交：
        # 取"距离足够长（≥ 0.3×半径）"的最小 step_out。
        dist = None
        for _so in (0.0, 0.04, 0.08, 0.12, 0.18, 0.25, 0.35, 0.5):
            d_try = distance_to_wall(self.shape_sides, self.cx, self.cy, wall_r,
                                     angle, px, py, dx, dy,
                                     step_out=radius * _so)
            if d_try is not None and d_try >= radius * 0.30:
                dist = d_try
                break
            if dist is None and d_try is not None:
                dist = d_try
        if dist is None or dist <= 1e-9:
            return None, None, None

        raw_speed = dist / (dt_need * m)
        self.needed_mult_max = max(self.needed_mult_max,
                                   raw_speed / self.base_speed if self.base_speed else 0.0)
        speed = max(lo, min(hi, raw_speed))
        clamped = abs(speed - raw_speed) > 1e-9
        if clamped:
            self.clamped_count += 1

        actual_dt = dist / (speed * m) if speed > 1e-9 else dt_need
        dev = actual_dt - dt_need

        # 无论命中还是丢弃，这个音符都算处理过 —— 推进索引，
        # 否则下一次撞墙还会拿到同一个音符，导致永久错位。
        self.next_index += 1
        if abs(dev) <= MAX_TOLERANCE_SEC:
            self.deviations.append(abs(dev))
            self.emitted += 1
        else:
            self.dropped += 1

        return speed, note, dev

    def prime_initial_velocity(self, t_now, px, py, vx, vy, radius, spd_m=1.0):
        """开局对准：让球第一次撞墙恰好落在第一个未发声的音符上。

        返回 (vx, vy) 或 None（无法对准时保持原速度）。
        """
        m = spd_m if spd_m > 1e-6 else 1.0
        lo = SPEED_MIN_MULT * self.base_speed
        hi = SPEED_MAX_MULT * self.base_speed

        # 找到第一个时间仍在前方的音符。
        # 注意不要跳过音符（跳过会让整条旋律错位一个音，听感立刻崩掉）。
        idx = self.next_index
        note = None
        for _ in range(8):
            cand = self.schedule.at_index(idx)
            if cand is None:
                break
            if cand["t"] - t_now > 1e-3:
                note = cand
                break
            idx += 1
        if note is None:
            return None

        dt_need = note["t"] - t_now
        angle = self.get_angle(t_now)
        wall_r = radius if self.shape_sides == 0 else radius / math.cos(math.pi / self.shape_sides)

        d = distance_to_wall(self.shape_sides, self.cx, self.cy, wall_r,
                             angle, px, py, vx, vy, step_out=radius * 0.06)
        if d is None or d <= 1e-9:
            return None

        raw = d / (dt_need * m)
        spd = max(lo, min(hi, raw))
        # 偏差超过容差就放弃对准（保持原速度，让物理自然走）
        if abs(d / (spd * m) - dt_need) > MAX_TOLERANCE_SEC:
            return None

        n = math.hypot(vx, vy)
        if n < 1e-9:
            return None
        # 不跳过任何音符：如果第 next_index 个音符已过期，
        # 让它在本帧跟随碰撞发声（由调用方处理），而不是丢弃。
        return (vx / n * spd, vy / n * spd)

    # -- 统计 -----------------------------------------------------------

    def stats(self):
        devs_ms = [d * 1000.0 for d in self.deviations]
        total = self.emitted + self.dropped
        return {
            "total_notes": total,
            "emitted": self.emitted,
            "dropped": self.dropped,
            "drop_pct": (self.dropped / total * 100.0) if total else 0.0,
            "mean_dev_ms": (sum(devs_ms) / len(devs_ms)) if devs_ms else 0.0,
            "max_dev_ms": max(devs_ms) if devs_ms else 0.0,
            "clamped": self.clamped_count,
            "needed_mult_max": self.needed_mult_max,
        }

    def format_stats(self):
        s = self.stats()
        return (
            f"总音符数 {s['total_notes']}  被丢弃 {s['dropped']} "
            f"({s['drop_pct']:.1f}%)  平均偏差 {s['mean_dev_ms']:.1f}ms  "
            f"最大偏差 {s['max_dev_ms']:.1f}ms"
            f"  速度限幅 {s['clamped']} 次"
            + (f"  需求上限 {s['needed_mult_max']:.2f}×（允许 1.8×）"
               if s['needed_mult_max'] > SPEED_MAX_MULT else "")
        )


def gravity_allows_rhythm(gravity) -> bool:
    return abs(gravity) <= MAX_GRAVITY_FOR_RHYTHM


# ---------------------------------------------------------------------------
# 装饰音
# ---------------------------------------------------------------------------

def decor_pitch(note):
    """主旋律当前音的高八度，用于非主球碰撞的装饰音。"""
    if note is None:
        return None
    return int(note["pitch"]) + 12
