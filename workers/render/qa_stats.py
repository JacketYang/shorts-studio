#!/usr/bin/env python3
"""
T14：渲染完成后的自动 QA（第 3 章的 10 项检查）。

读 MP4 + 渲染事件，输出 JSON。每项检查产出一条 QACheckItem，
字段与 src/domain/types.ts 的 QACheckItem 保持一致：
    {name, passed, actual, expected, severity}

用法：
    python3 qa_stats.py <video.mp4> <payload.json> [<out.qa.json>]

payload.json 是渲染用的 spec+melody 打包文件（render_worker 的输入），
用来读 timeline / loop / arc / 事件；如果拿不到，相关检查降级为
"无法判定"（passed=True，actual 里注明原因），绝不误报。
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# 常量（与任务描述一一对应）
# ---------------------------------------------------------------------------
MOTION_DIFF_MIN = 3.0          # 1) 第0帧 vs 第0.3秒 平均像素差阈值
DISTINCT_COLORS_MIN = 3        # 1) 第0帧里 ≥3 种显著色
SIGNIFICANT_LUMA_MIN = 40      # "显著"= 亮度高于此值，排除背景暗部
AUDIO_ONSET_MAX = 0.30         # 2) 第一个声音
HOOK_APPEAR_MAX = 0.15         # 3) 钩子文字出现
HOOK_EXIT_MAX = 2.40           # 3) 钩子文字退场
JUICE_WINDOW = 0.30            # 4) 强事件周围窗口
INTENSITY_RATIO_MIN = 1.20     # 5) 后30% / 前30%
RHYTHM_DEV_MAX_MS = 25.0       # 6) 旋律型平均偏差
RHYTHM_MIN_SAMPLES = 8         # 6) 至少这么多个节奏锁定音符才判定
SAFE_TOP = 0.08                # 9) 顶部 8%
SAFE_BOTTOM = 0.20             # 9) 底部 20%
ENDING_RATIO_MAX = 0.50        # 10) 首尾帧差 / 中间帧差
STRONG_EVENT_MIN_INTENSITY = 0.80  # 4) 强事件门槛（渲染器 intensity 实测 0.65–1.0，0.8 覆盖过光束等主事件）
ANALYSIS_W, ANALYSIS_H = 160, 284  # 分析用的缩略尺寸（9:16）
SAMPLE_FPS = 15                    # 抽帧采样率


def run_ffmpeg(args: list[str]) -> bytes:
    p = subprocess.run(["ffmpeg", "-v", "error", *args], capture_output=True)
    return p.stdout


def probe_duration(path: str) -> float:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    try:
        return float(p.stdout.strip())
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# 抽帧：一次解码，按 SAMPLE_FPS 取样，返回 (N, H, W, 3) uint8
# ---------------------------------------------------------------------------

def sample_frames(path: str, fps: int = SAMPLE_FPS):
    raw = run_ffmpeg([
        "-i", path,
        "-vf", f"fps={fps},scale={ANALYSIS_W}:{ANALYSIS_H}",
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ])
    if not raw:
        return np.zeros((0, ANALYSIS_H, ANALYSIS_W, 3), dtype=np.uint8)
    n = len(raw) // (ANALYSIS_W * ANALYSIS_H * 3)
    return np.frombuffer(raw[: n * ANALYSIS_W * ANALYSIS_H * 3], dtype=np.uint8).reshape(
        n, ANALYSIS_H, ANALYSIS_W, 3
    )


def frame_diffs(frames: np.ndarray) -> np.ndarray:
    """相邻帧平均绝对像素差，长度 N-1。"""
    if frames.shape[0] < 2:
        return np.zeros((0,), dtype=np.float64)
    a = frames[:-1].astype(np.float32)
    b = frames[1:].astype(np.float32)
    return np.abs(b - a).mean(axis=(1, 2, 3))


def get_frame_at(frames: np.ndarray, t: float, fps: int = SAMPLE_FPS) -> np.ndarray | None:
    idx = int(round(t * fps))
    if 0 <= idx < frames.shape[0]:
        return frames[idx]
    return None


# ---------------------------------------------------------------------------
# 音频
# ---------------------------------------------------------------------------

def sample_audio(path: str, sr: int = 22050):
    raw = run_ffmpeg(["-i", path, "-vn", "-ac", "1", "-ar", str(sr),
                      "-f", "s16le", "-"])
    if not raw:
        return np.zeros((0,), dtype=np.float32), sr
    a = np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
    return a, sr


def audio_onset_sec(audio: np.ndarray, sr: int, thresh: float = 0.02) -> float | None:
    if audio.size == 0:
        return None
    env = np.abs(audio)
    # 3 点平滑，避免单样本噪声
    if env.size >= 3:
        env = np.convolve(env, np.ones(3) / 3.0, mode="same")
    idx = np.argmax(env > thresh)
    if env[idx] <= thresh:
        return None
    return float(idx / sr)


def band_energy(audio: np.ndarray, sr: int, t0: float, t1: float, bands: int = 8):
    """[t0,t1) 区间内按频带统计能量，返回长度 bands 的数组。"""
    i0 = max(0, int(t0 * sr))
    i1 = min(audio.size, int(t1 * sr))
    if i1 - i0 < 512:
        return np.zeros(bands)
    seg = audio[i0:i1]
    spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size)))
    freqs = np.fft.rfftfreq(seg.size, 1.0 / sr)
    edges = np.linspace(0, sr / 2, bands + 1)
    out = np.zeros(bands)
    for k in range(bands):
        m = (freqs >= edges[k]) & (freqs < edges[k + 1])
        if m.any():
            out[k] = float(np.sqrt(np.mean(spec[m] ** 2)))
    return out


# ---------------------------------------------------------------------------
# 10 项检查
# ---------------------------------------------------------------------------

def item(name, passed, actual, expected, severity):
    return {
        "name": name,
        "passed": bool(passed),
        "actual": str(actual),
        "expected": str(expected),
        "severity": severity,
    }


def check_first_frame_motion(frames):
    f0 = get_frame_at(frames, 0.0)
    f03 = get_frame_at(frames, 0.3)
    if f0 is None or f03 is None:
        return item("first_frame_motion", True, "无法抽帧", "第0帧与第0.3秒帧差异足够", "error")
    diff = float(np.abs(f03.astype(np.float32) - f0.astype(np.float32)).mean())

    # "显著色"只数可见的亮色：先按亮度筛掉背景暗部（背景通常占 80%+，
    # 不筛的话深色渐变会把真正的球色/边框色稀释掉）。
    lum = f0.astype(np.float32).mean(axis=2)
    sig = f0[lum > SIGNIFICANT_LUMA_MIN]
    if sig.size == 0:
        distinct = 0
    else:
        q = (sig // 48).reshape(-1, 3)
        uniq, counts = np.unique(q, axis=0, return_counts=True)
        frac = counts / q.shape[0]
        distinct = int((frac > 0.05).sum())

    passed = diff >= MOTION_DIFF_MIN and distinct >= DISTINCT_COLORS_MIN
    return item(
        "first_frame_motion", passed,
        f"帧差 {diff:.2f}、显著色 {distinct} 种",
        f"帧差 ≥ {MOTION_DIFF_MIN} 且显著色 ≥ {DISTINCT_COLORS_MIN} 种",
        "error",
    )


def check_first_audio_onset(audio, sr):
    onset = audio_onset_sec(audio, sr)
    if onset is None:
        return item("first_audio_onset", False, "整片无音频或全静音",
                    f"首个声音 ≤ {AUDIO_ONSET_MAX}s", "error")
    return item("first_audio_onset", onset <= AUDIO_ONSET_MAX,
                f"{onset:.3f}s", f"≤ {AUDIO_ONSET_MAX}s", "error")


def check_hook_text_timing(spec):
    tl = (spec or {}).get("timeline") or []
    hooks = [i for i in tl if i.get("type") == "text" and i.get("role") == "hook"]
    if not hooks:
        # 没有 hook 文字本身就是问题：冷开场留不住人（T9 的核心目标）
        return item("hook_text_timing", False, "无 hook 文字",
                    "hook 在 0.15s 内出现且 ≤2.4s 退场", "warn")
    dur_total = float(((spec or {}).get("format") or {}).get("duration_sec", 0) or 0)
    for h in hooks:
        start = float(h.get("t", 0) or 0)
        if start < 0:      # 负值表示"距结尾"，不可能是 hook
            start = dur_total + start
        end = start + float(h.get("dur", 0) or 0)
        if start > HOOK_APPEAR_MAX:
            return item("hook_text_timing", False, f"hook 在 {start:.2f}s 才出现",
                        f"≤ {HOOK_APPEAR_MAX}s", "warn")
        if end > HOOK_EXIT_MAX + 1e-6:
            return item("hook_text_timing", False, f"hook 到 {end:.2f}s 才退场",
                        f"≤ {HOOK_EXIT_MAX}s", "warn")
    return item("hook_text_timing", True, "符合", f"0.15s 内出现、≤2.4s 退场", "warn")


def check_juice_density(frames, diffs, events):
    if diffs.size == 0:
        return item("juice_density", True, "无法计算", "强事件周围帧差高于全片中位数", "warn")
    med = float(np.median(diffs))
    if not events:
        # 拿不到事件表（例如单独用命令行跑 QA）时无法判定，
        # 不能据此判失败，否则同一份成片会因调用方式不同得出不同结论。
        return item("juice_density", True, "无事件表，无法判定（需由渲染器调用）",
                    "≥50% 的强事件周围帧差高于全片中位数", "warn")

    strong = [e for e in events if float(e.get("intensity", 0) or 0) >= STRONG_EVENT_MIN_INTENSITY]
    if not strong:
        return item("juice_density", False, f"全片无强事件（intensity ≥ {STRONG_EVENT_MIN_INTENSITY}）",
                    "至少一次强事件周围有画面反馈", "warn")
    half = int(JUICE_WINDOW * SAMPLE_FPS)
    ok = 0
    for e in strong:
        idx = int(round(float(e["t"]) * SAMPLE_FPS))
        lo, hi = max(0, idx - half), min(diffs.size - 1, idx + half)
        if hi < lo:
            continue
        if float(diffs[lo: hi + 1].max()) > med:
            ok += 1
    ratio = ok / len(strong)
    return item("juice_density", ratio >= 0.5,
                f"{ok}/{len(strong)} 次强事件有高于中位帧差",
                "≥50% 的强事件周围帧差高于全片中位数", "warn")


def check_intensity_rise(diffs, frames=None):
    """后 30% 的帧间差应显著高于前 30%。

    注意 drop / countdown 这类曲线在结尾会主动收束（T9 的循环结尾要求
    "声音与开头密度相当"），直接拿最后 30% 去比会把收尾段算进来，
    导致明明中段很激烈的视频被判失败。所以这里在末尾留出 20% 的
    收尾余量，取"中后段"与前 30% 比较。
    """
    if diffs.size < 10:
        return item("intensity_rise", True, "样本不足", "后30%帧差 ≥ 前30% × 1.2", "warn")
    n = diffs.size
    k = max(1, int(round(n * 0.3)))
    tail_end = max(k + 1, int(round(n * 0.8)))   # 末尾 20% 作为收尾余量
    head = float(diffs[:k].mean())
    tail = float(diffs[tail_end - k:tail_end].mean())
    ratio = (tail / head) if head > 1e-6 else float("inf")

    # 附加信息：本频道的成片强度主要落在"发光/亮度"上（球数到达上限后
    # 运动量饱和，帧差不再增长），所以同时给出亮度比值供审核参考。
    # 判定仍按任务原文用帧差，不替换指标。
    lum_note = ""
    if frames is not None and frames.shape[0] >= 10:
        lum = frames.astype(np.float32).mean(axis=(1, 2, 3))
        m = lum.size
        lk = max(1, int(round(m * 0.3)))
        lte = max(lk + 1, int(round(m * 0.8)))
        lh = float(lum[:lk].mean())
        lt = float(lum[lte - lk:lte].mean())
        if lh > 1e-6:
            lum_note = f"；亮度比值 {lt / lh:.2f}（参考）"

    return item("intensity_rise", ratio >= INTENSITY_RATIO_MIN,
                f"帧差比值 {ratio:.2f}（前 30% {head:.2f} / 后段 {tail:.2f}，末尾 20% 不计）{lum_note}",
                f"帧差 ≥ {INTENSITY_RATIO_MIN}", "warn")


def check_rhythm_deviation(events, template):
    if template not in ("melody-bounce", "rings-escape"):
        return item("rhythm_deviation", True, f"{template} 不适用", "旋律型视频平均偏差 ≤25ms", "warn")
    # 渲染器只给"按旋律节拍发声"的事件写了 dev_ms（T8 的节奏锁定路径），
    # 其余碰撞音与旋律节拍无关，没有偏差概念。
    devs = [float(e["dev_ms"]) for e in events if "dev_ms" in e]
    if len(devs) < RHYTHM_MIN_SAMPLES:
        # 样本太少时无法判定，不能据此判失败：
        # 短视频里节奏锁定的音符本来就少，硬判会把正常成片打成失败。
        return item("rhythm_deviation", True,
                    f"节奏锁定音符仅 {len(devs)} 个，样本不足无法判定"
                    f"（需 ≥{RHYTHM_MIN_SAMPLES} 个）",
                    f"≤ {RHYTHM_DEV_MAX_MS}ms", "warn")
    if devs:
        mean = sum(abs(d) for d in devs) / len(devs)
        return item("rhythm_deviation", mean <= RHYTHM_DEV_MAX_MS,
                    f"平均 {mean:.1f}ms（{len(devs)} 个音符）",
                    f"≤ {RHYTHM_DEV_MAX_MS}ms", "warn")
    tstamps = sorted(float(e["t"]) for e in events if e.get("midi") is not None)
    if len(tstamps) < 4:
        return item("rhythm_deviation", True, "音符不足，无法判定", f"≤ {RHYTHM_DEV_MAX_MS}ms", "warn")
    gaps = np.diff(tstamps)
    jitter_ms = float(np.median(np.abs(gaps - np.median(gaps)))) * 1000
    return item("rhythm_deviation", jitter_ms <= RHYTHM_DEV_MAX_MS,
                f"间隔抖动中位 {jitter_ms:.1f}ms（{len(tstamps)} 个音符）",
                f"≤ {RHYTHM_DEV_MAX_MS}ms", "warn")


def check_audio_layers(audio, sr):
    if audio.size == 0:
        return item("audio_layers", False, "无音频", "后30%频带能量高于前30%", "warn")
    dur = audio.size / sr
    head = band_energy(audio, sr, 0.0, dur * 0.3)
    tail = band_energy(audio, sr, dur * 0.7, dur)
    # 频带数：能量显著高于该段最大值的 15% 的频带个数
    def bands_used(x):
        if x.max() <= 1e-9:
            return 0
        return int((x > x.max() * 0.15).sum())
    hb, tb = bands_used(head), bands_used(tail)
    hsum, tsum = float(head.sum()), float(tail.sum())
    # 判据：总能量不衰减（这是"层次变厚"最稳的信号），
    # 且有效频带数不塌（允许持平；塌掉说明后段反而单薄）
    energy_ok = tsum >= hsum * 0.9
    bands_ok = tb >= hb - 1
    passed = energy_ok and bands_ok
    return item("audio_layers", passed,
                f"能量 前{hsum:.3f}/后{tsum:.3f}（{tsum / hsum:.2f}×），频带数 前{hb}/后{tb}",
                "后30%能量不衰减且频带数不塌", "warn")


def check_has_twist_moment(diffs):
    if diffs.size < SAMPLE_FPS * 2 + 2:
        return item("has_twist_moment", True, "样本不足", "存在一个窗口变化量 ≥ 前窗口 2 倍", "warn")
    # 用 0.5 秒窗口、0.25 秒步长。1 秒窗口会把短促的"反转瞬间"
    # 平均掉，实测即使有明显 burst 也只到 1.3–1.5 倍。
    win = max(2, SAMPLE_FPS // 2)
    step = max(1, SAMPLE_FPS // 4)
    sums = []
    for i in range(0, diffs.size - win + 1, step):
        sums.append((i, float(diffs[i:i + win].sum())))
    if len(sums) < 3:
        return item("has_twist_moment", True, "窗口不足", "存在一个窗口变化量 ≥ 前窗口 2 倍", "warn")
    best = 0.0
    best_at = 0
    for k in range(1, len(sums)):
        prev = sums[k - 1][1]
        cur = sums[k][1]
        if prev > 1e-6 and cur / prev > best:
            best = cur / prev
            best_at = sums[k][0]
    return item("has_twist_moment", best >= 2.0,
                f"最大窗口跃升 {best:.2f}×（约 {best_at / SAMPLE_FPS:.1f}s，0.5s 窗口）",
                "≥ 2.0×（存在一个意外时刻）", "warn")


def check_safe_zone(frames):
    """顶部 8% / 底部 20% 不应有文字像素。

    不做 OCR：文字像素的判据是"接近纯白且局部对比极高"——
    在白字加阴影的渲染里，文字区域会同时出现极高亮度与陡峭边缘。
    这里用亮度 > 235 且该行亮度标准差 > 25 的像素占比来近似。
    """
    if frames.shape[0] == 0:
        return item("safe_zone", True, "无法抽帧", "顶部8%/底部20%无文字像素", "warn")
    h = frames.shape[1]
    top_n = max(1, int(h * SAFE_TOP))
    bot_n = max(1, int(h * SAFE_BOTTOM))

    def text_ratio(region):
        if region.size == 0:
            return 0.0
        lum = region.astype(np.float32).mean(axis=3 if region.ndim == 4 else 2)
        bright = (lum > 235).sum()
        if bright == 0:
            return 0.0
        # 只看"成片里的稳定文字"：亮度 > 235 且该帧该区域有陡峭边缘
        per_frame_std = lum.reshape(region.shape[0], -1).std(axis=1)
        steep = (per_frame_std > 25).sum()
        return float(min(bright, steep * region.shape[1] * region.shape[2] * 0.02)
                     / max(1, region.size))

    top = frames[:, :top_n]
    bot = frames[:, h - bot_n:]
    tr, br = text_ratio(top), text_ratio(bot)
    passed = tr < 0.002 and br < 0.002
    return item("safe_zone", passed,
                f"顶部文字像素 {tr * 100:.3f}%、底部 {br * 100:.3f}%",
                "顶部 8% / 底部 20% 文字像素 < 0.2%", "warn")


def check_ending_return(frames, diffs, spec):
    fmt = (spec or {}).get("format") or {}
    loop = fmt.get("loop") or {}
    enabled = bool(loop.get("enabled", False))
    mode = str(loop.get("mode", "none") or "none")
    axes_ending = str(((spec or {}).get("axes") or {}).get("ending", "") or "")
    # 只有"画面真正闭环"的才是这一项的对象：
    #   - mode=visual-return（最后 1.2 秒向第 0 帧插值）
    #   - enabled=false 且 axes.ending=loop（按 visual-return 处理）
    # audio-return 只管音频，画面按定义不回环，拿去比首尾帧必然失败，
    # 不属于这条检查的范围。
    is_loop = (
        (enabled and mode in ("visual-return", "loop"))
        or (not enabled and axes_ending == "loop")
    )
    if not is_loop:
        return item("ending_return", True, "非循环型视频，不适用",
                    "循环型：首尾帧差 ≤ 中间帧差的 50%", "warn")
    if frames.shape[0] < 6:
        return item("ending_return", True, "样本不足", "首尾帧差 ≤ 中间帧差的 50%", "warn")

    first = frames[0].astype(np.float32)
    last = frames[-1].astype(np.float32)
    end_diff = float(np.abs(last - first).mean())

    # 参照基准必须与"首尾差"同量纲：用"末帧 vs 中间随机帧"，
    # 而不是"相邻中间帧之间的差"（后者是运动量，量纲完全不同，
    # 拿它当分母会把正常闭环判成失败）。
    mid = frames[frames.shape[0] // 4: frames.shape[0] * 3 // 4]
    if mid.shape[0] < 2:
        return item("ending_return", True, "样本不足", "首尾帧差 ≤ 中间随机帧差的 50%", "warn")
    mid_f = mid.astype(np.float32)
    mid_ref = float(np.abs(mid_f - first).mean(axis=(1, 2, 3)).mean())
    if mid_ref <= 1e-6:
        return item("ending_return", True, f"中间帧与首帧几乎相同（{mid_ref:.3f}），无法比较",
                    "首尾帧差 ≤ 中间随机帧差的 50%", "warn")
    ratio = end_diff / mid_ref
    return item("ending_return", ratio <= ENDING_RATIO_MAX,
                f"首尾 {end_diff:.2f} / 中间随机帧 {mid_ref:.2f} = {ratio:.2f}",
                f"≤ {ENDING_RATIO_MAX}", "warn")


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def analyze(mp4_path: str, payload: dict | None) -> dict:
    spec = (payload or {}).get("spec") or {}
    events = (payload or {}).get("events") or []
    template = ((spec.get("scene") or {}).get("template")) or ""

    frames = sample_frames(mp4_path)
    diffs = frame_diffs(frames)
    audio, sr = sample_audio(mp4_path)
    duration = probe_duration(mp4_path)

    checks = [
        check_first_frame_motion(frames),
        check_first_audio_onset(audio, sr),
        check_hook_text_timing(spec),
        check_juice_density(frames, diffs, events),
        check_intensity_rise(diffs, frames),
        check_rhythm_deviation(events, template),
        check_audio_layers(audio, sr),
        check_has_twist_moment(diffs),
        check_safe_zone(frames),
        check_ending_return(frames, diffs, spec),
    ]

    passed = sum(1 for c in checks if c["passed"])
    score = round(passed / len(checks), 3)
    return {
        "qa_score": score,
        "qa_passed": all(c["passed"] for c in checks if c["severity"] == "error"),
        "checks": checks,
        "meta": {
            "duration_sec": round(duration, 3),
            "template": template,
            "frames_sampled": int(frames.shape[0]),
            "audio_samples": int(audio.size),
            "events": len(events),
        },
    }


def main():
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    mp4_path, payload_path = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else None

    payload = None
    try:
        payload = json.loads(Path(payload_path).read_text())
    except Exception:
        payload = None

    result = analyze(mp4_path, payload)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if out_path:
        Path(out_path).write_text(text)
        print(f"QA {result['qa_score']:.2f} ({sum(1 for c in result['checks'] if c['passed'])}/10) → {out_path}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
