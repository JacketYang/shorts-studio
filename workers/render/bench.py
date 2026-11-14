#!/usr/bin/env python3
"""
遍历 out/payloads/*.json，调用 render_worker.render_mp4 渲染成 MP4，
打印每个 fixture 的耗时与文件大小，最后输出总耗时。

用于「改前 / 改后」对比：改了渲染逻辑后重跑本脚本，
与 out/baseline/ 里的旧产物对比耗时、体积与画面。

运行：python3 workers/render/bench.py
产物：out/videos/<name>.mp4
"""

import importlib.util
import os
import sys
import time
import traceback
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_PATH = Path(__file__).resolve().parent / "render_worker.py"
PAYLOAD_DIR = REPO_ROOT / "out" / "payloads"
VIDEO_DIR = REPO_ROOT / "out" / "videos"


def load_render_worker():
    """按文件路径加载 render_worker 模块（避免依赖 sys.path 与包结构）。"""
    spec = importlib.util.spec_from_file_location("render_worker", WORKER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {WORKER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def human_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024.0 or unit == "GB":
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} GB"


def main() -> int:
    if not PAYLOAD_DIR.is_dir():
        print(f"❌ 找不到 {PAYLOAD_DIR}", file=sys.stderr)
        print("   请先运行：npx tsx scripts/export_fixtures.ts", file=sys.stderr)
        return 1

    payloads = sorted(PAYLOAD_DIR.glob("*.json"))
    if not payloads:
        print(f"❌ {PAYLOAD_DIR} 里没有 payload JSON", file=sys.stderr)
        print("   请先运行：npx tsx scripts/export_fixtures.ts", file=sys.stderr)
        return 1

    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    worker = load_render_worker()

    print(f"渲染 {len(payloads)} 个 fixture → {VIDEO_DIR.relative_to(REPO_ROOT)}/")
    print("")

    results = []   # (name, ok, seconds, size, error)
    total_start = time.perf_counter()

    for payload_path in payloads:
        name = payload_path.stem
        out_mp4 = VIDEO_DIR / f"{name}.mp4"
        if out_mp4.exists():
            out_mp4.unlink()

        started = time.perf_counter()
        try:
            worker.render_mp4(str(payload_path), str(out_mp4))
            elapsed = time.perf_counter() - started
            size = out_mp4.stat().st_size if out_mp4.exists() else 0
            results.append((name, True, elapsed, size, None))
            print(f"  ✅ {name:<16} {elapsed:6.2f}s  {human_size(size):>9}")
        except Exception as exc:  # noqa: BLE001 - 单个失败不应中断整批
            elapsed = time.perf_counter() - started
            results.append((name, False, elapsed, 0, exc))
            print(f"  ❌ {name:<16} {elapsed:6.2f}s  失败：{exc}")
            traceback.print_exc()

    total_elapsed = time.perf_counter() - total_start

    # ---- 汇总 ----
    ok = [r for r in results if r[1]]
    failed = [r for r in results if not r[1]]

    print("")
    print("=" * 62)
    print(f"{'fixture':<18}{'耗时':>10}{'文件大小':>14}{'相对实时倍率':>14}")
    print("-" * 62)
    for name, success, seconds, size, _err in results:
        if not success:
            print(f"{name:<18}{seconds:>9.2f}s{'  —':>14}{'  —':>14}")
            continue
        # 相对实时倍率：视频时长 / 渲染耗时，越大越快
        ratio = ""
        try:
            import json

            with open(PAYLOAD_DIR / f"{name}.json", encoding="utf-8") as fh:
                spec = json.load(fh)["spec"]
            video_secs = float(spec["format"]["duration_sec"])
            if seconds > 0:
                ratio = f"{video_secs / seconds:.2f}x"
        except Exception:  # noqa: BLE001
            ratio = ""
        print(f"{name:<18}{seconds:>9.2f}s{human_size(size):>14}{ratio:>14}")
    print("-" * 62)
    print(f"{'总计':<18}{total_elapsed:>9.2f}s")
    print(f"成功 {len(ok)} 个，失败 {len(failed)} 个")
    print("=" * 62)

    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
