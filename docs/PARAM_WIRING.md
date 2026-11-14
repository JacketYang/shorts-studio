# Spec 参数接线表 (PARAM_WIRING)

> 对应任务 **T1：让 Spec 里写了的参数真正影响成片**
>
> 本文件记录 VideoSpec 中每个字段是否真正进入渲染，以及在哪个函数生效。
> 渲染器统一通过 `workers/render/spec_params.py` 的 `load_params()` 取参数，
> 不再直接 `params.get(...)`。

---

## 一、架构

```
payload JSON
    ↓
spec_params.load_params(spec)      ← 解析 + 默认值 + 范围钳制（本表主对象）
    ↓
spec_params.resolve_pixels(P, W, H) ← 归一化 → 像素换算
    ↓
render_worker.simulate_and_render_frames(spec, melody, proc)
    ↓
FFmpeg (rawvideo → libx264 → 加音频 loudnorm)
```

**为什么集中到 spec_params：**

- 默认值只定义一处（取自 `templates.ts` 的 4 个 fixture 实测值）
- 范围钳制只定义一处（取自各 `*ParamsSchema` 的 `.min()/.max()`）
- 旧 JSON 缺字段时自动落默认值，保证向下兼容
- 越界值夹回合法区间并记 warning，不中断渲染

### 钳制行为

| 情况 | 行为 |
|---|---|
| 字段缺失 | 用模板默认值 |
| 数值越界 | 夹到 `[min, max]`，`P.warnings` 记录一条 |
| 枚举值非法 | 回退默认值 |
| 非数值（字符串等） | 回退默认值，记 warning |

---

## 二、melody-bounce

### arena

| Spec 字段 | 生效 | 实现位置 | 换算 / 说明 |
|---|---|---|---|
| `arena.shape` | ✅ | `_load_melody_bounce` + `simulate_and_render_frames` | circle→圆环；hexagon/triangle/polygon→正多边形；ellipse 暂按圆处理（**未实现**真正椭圆） |
| `arena.size` | ✅ | `resolve_pixels` | `半径 = RENDER_W * 0.5 * size * 0.5`，范围 0.4–0.95 |
| `arena.wall_thickness` | ✅ | `resolve_pixels` | `墙宽 = wall_thickness * RENDER_W`，范围 0.004–0.05 |
| `arena.rotation_deg_per_s` | ✅ | `simulate_and_render_frames` | 多边形整体旋转角速度 |

### balls

| Spec 字段 | 生效 | 实现位置 | 换算 / 说明 |
|---|---|---|---|
| `balls.count_start` | ✅ | `_load_melody_bounce` | 初始球数，范围 1–16 |
| `balls.max_count` | ✅ | `simulate_and_render_frames` | 球数上限（**替换原来写死的 12**），范围 1–128 |
| `balls.radius` | ✅ | `resolve_pixels` | `半径 = radius * RENDER_W`（替换写死 7.5），范围 0.01–0.08 |
| `balls.speed` | ✅ | `resolve_pixels` | `初速 = speed * RENDER_W * 0.9` 像素/秒，范围 0.1–2.0 |
| `balls.restitution` | ✅ | `simulate_and_render_frames` | 碰墙反弹系数（替换写死 1.0），范围 0.7–1.15 |
| `balls.gravity` | ✅ | `resolve_pixels` | `重力 = gravity * RENDER_H * 0.32` 像素/秒²（替换写死 155），范围 -1.0–2.0；负值即向上 |

### rule

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `rule.type` = `split_on_bounce` | ✅ | `simulate_and_render_frames` | 每 `every_n_bounces` 次碰撞分裂一个球 |
| `rule.type` = `grow_on_bounce` | ✅ | 同上 | 球半径 × `scale_factor`，上限为场地半径的 45% |
| `rule.type` = `speed_up` | ✅ | 同上 | 每次碰撞速度 ×1.025 |
| `rule.type` = `shrink_wall` | ✅ | 同上 | 场地半径按碰撞次数收缩（下限 62%） |
| `rule.type` = `gravity_flip` | ✅ **T1 新增** | 同上 | 每 `every_n_bounces` 次碰撞，重力符号取反 |
| `rule.every_n_bounces` | ✅ | `_load_melody_bounce` | 分裂 / 重力翻转的触发间隔（替换写死 3），范围 1–20 |
| `rule.scale_factor` | ✅ | `_load_melody_bounce` | `grow_on_bounce` 放大系数（替换写死 1.035），范围 1.01–1.25 |
| `rule.inherit_color` | ⚠️ **未实现** | — | 已解析保存，分裂时颜色仍按调色板轮转 |

### note_trigger

| Spec 字段 | 生效 | 说明 |
|---|---|---|
| `note_trigger.on` = `ball_wall_collision` | ✅ | 碰墙发声（默认） |
| `note_trigger.on` = `ball_ball_collision` | ⚠️ **未实现** | 回落为碰墙触发 |
| `note_trigger.on` = `beat` | ⚠️ **未实现** | 回落为碰墙触发 |
| `note_trigger.velocity_from` | ⚠️ **未实现** | 音量固定 0.9 |

---

## 三、ball-sort

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `balls.count` | ✅ | `_load_ball_sort` | 球总数，范围 4–64 |
| `balls.colors` | ✅ | 同上 | 桶与球共用的颜色序列 |
| `bins.count` | ✅ | 同上 | 桶数量，范围 2–6 |
| `bins.layout` = `under-funnel` | ✅ | `simulate_and_render_frames` | 桶等距排在底部同一行 |
| `bins.layout` = `stepped` | ✅ | 同上 | 桶沿阶梯斜线错落排布 |
| `bins.layout` = `split-chute` | ⚠️ **未实现** | 同上 | 暂时按 `under-funnel` 渲染 |
| `mechanism.pegs.rows` | ✅ | 同上 | 钉子行数（替换写死 6），范围 3–12 |
| `mechanism.pegs.jitter` | ✅ | 同上 | 钉子位置抖动，随机数由 `derive_rng(seed, "pegs")` 派生，可复现 |
| `mechanism.gates[].type` = `moving` | ✅ | 同上 | 一块左右往复的挡板 |
| `mechanism.gates[].period_s` | ✅ | 同上 | 挡板往复周期，范围 0.5–10 |
| `mechanism.gates[].type` = `color-filter` | ⚠️ **未实现** | — | 已解析保存 |
| `mechanism.gates[].type` = `spinner` | ⚠️ **未实现** | — | 已解析保存 |
| `mechanism.spiral.enabled` | ⚠️ **未实现** | — | 已解析保存 |
| `goal.type` | ⚠️ **未实现** | — | 不影响渲染 |
| `goal.celebrate` | ⚠️ **未实现** | — | 无庆祝动画 |

---

## 四、pendulum-wave

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `pendulum.count` | ✅ | `_load_pendulum` | 摆球数量，范围 6–24 |
| `pendulum.length_min` | ✅ | 同上 | 最短摆长（占画面高比例），范围 0.2–0.55 |
| `pendulum.length_step` | ✅ | 同上 | 相邻摆长递增，范围 0.01–0.06 |
| `pendulum.max_angle_deg` | ✅ | 同上 | 最大摆角，范围 20–75 |
| `pendulum.damping` | ✅ | 同上 | 阻尼衰减，范围 0–0.05 |
| `rule.type` = `harmonic_sweep` | ✅ | `simulate_and_render_frames` | 默认谐波扫频 |
| `rule.type` = `phase_flip` | ✅ | 同上 | 频率步进放大 1.5 倍 |
| `rule.type` = `gravity_pulse` | ✅ | 同上 | 全局脉冲调制 |
| `rule.cycle_sec` | ✅ | `_load_pendulum` | 基础周期，范围 8–45 |
| `note_trigger.on` = `center_crossing` | ✅ **T1 接入** | `simulate_and_render_frames` | 过零点触发发声 |
| `note_trigger.on` = `peak_reversal` | ✅ **T1 接入** | 同上 | 摆至接近最大角度时触发 |
| `note_trigger.velocity_from` | ⚠️ **未实现** | — | 音量固定 0.78 |

---

## 五、orbit-sync

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `orbits.count` | ✅ | `_load_orbits` | 行星数量，范围 4–18 |
| `orbits.base_radius` | ✅ | 同上 | 最内圈半径，范围 0.1–0.28 |
| `orbits.radius_step` | ✅ | 同上 | 圈距，范围 0.015–0.06 |
| `orbits.base_omega` | ✅ | 同上 | 基础角速度，范围 0.3–2.5 |
| `orbits.resonance_ratio` | ✅ | 同上 | 角速度递增比，范围 0.05–0.5 |
| `rule.type` = `harmonic_align` | ✅ | `simulate_and_render_frames` | 默认谐波对齐 |
| `rule.type` = `reverse_outer` | ✅ | 同上 | 外半圈反向旋转 |
| `rule.type` = `pulse_rings` | ✅ **T1 新增** | 同上 | 圆环半径按 `1 + 0.06·sin(t·3)` 脉动（周期 ≈2.09s） |
| `rule.trigger_angle_deg` | ✅ | `_load_orbits` | 光束角度，范围 -180–180 |
| `note_trigger.on` = `beam_crossing` | ✅ **T1 接入** | `simulate_and_render_frames` | 穿越光束触发发声 |
| `note_trigger.on` = `planet_alignment` | ⚠️ **未实现** | — | 回落为 beam_crossing |
| `note_trigger.velocity_from` | ⚠️ **未实现** | — | 音量固定 0.82 |

---

## 六、通用字段（四个模板共用）

### scene.style.trail

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `trail.enabled` | ✅ **T1 接入** | `draw_trail` / `TrailParams.active` | `false` 时不画拖尾 |
| `trail.length_frames` | ✅ **T1 接入** | `simulate_and_render_frames` | 拖尾保留帧数（替换写死 8 点），范围 0–60；`0` 等同关闭 |
| `trail.fade` | ✅ **T1 接入** | `draw_trail` | 尾部亮度衰减强度，范围 0–1 |

### scene.style.background

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `background.type` = `solid` | ✅ **T1 接入** | `build_background` | 纯 `colors[0]` |
| `background.type` = `gradient` | ✅ **T1 接入** | 同上 | `colors[0]` → `colors[1]` 垂直渐变，预生成一帧后整段复用 |
| `background.type` = `grid` | ✅ **T1 接入** | 同上 | 渐变底 + 间距 6% 画面宽的网格线，网格处亮度 ×1.06 |
| `background.colors` | ✅ **T1 接入** | 同上 | 最多取前 4 个 |

### scene.style.camera

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `camera.zoom_from` | ✅ **T1 接入** | `frame_zoom` + `zoom_at` | 起始缩放，范围 0.5–2.0 |
| `camera.zoom_to` | ✅ **T1 接入** | 同上 | 结束缩放，整段时长内线性插值；以画面中心为原点对绘制坐标缩放 |
| `camera.shake` | ⚠️ **未实现** | — | 已解析保存（`CameraParams.shake`），暂不产生抖动 |

### scene.style.palette

| Spec 字段 | 生效 | 说明 |
|---|---|---|
| `palette.colors` | ✅ | 球 / 摆球 / 行星 / 桶的配色来源，最多取 8 个 |
| `palette.family` | ⚠️ **未实现** | 纯语义标签，不影响渲染 |

### audio

| Spec 字段 | 生效 | 实现位置 | 说明 |
|---|---|---|---|
| `audio.music.transpose` | ✅ **T1 接入** | `simulate_and_render_frames` | 所有 MIDI 音高加上该半音数，范围 -24–24 |
| `audio.music.tempo_bpm` | 📦 **仅读取保存** | `AudioParams.tempo_bpm` | 按任务要求接入解析，供 T7/T8 使用；当前不改变音频时序 |
| `audio.music.melody_ref` | ✅ | 已有 | 在 `scripts/export_fixtures.ts` 中解析成 melody 对象随 payload 传入 |
| `audio.music.instrument` | ⚠️ **未实现** | — | 合成器只有一种音色（正弦+泛音） |
| `audio.music.note_mapping` | ⚠️ **未实现** | — | 一律 per_collision 语义 |
| `audio.music.wrap` | ⚠️ **未实现** | — | 一律循环取音 |
| `audio.music.reverb` | ⚠️ **未实现** | — | 无混响处理 |
| `audio.mix.target_lufs` | ✅ | `render_mp4` | 传给 ffmpeg `loudnorm=I=` |
| `audio.mix.true_peak_db` | ✅ | `render_mp4` | 传给 ffmpeg `loudnorm=TP=` |
| `audio.sfx` | ⚠️ **未实现** | — | 未合成音效层 |

### 其他

| Spec 字段 | 生效 | 说明 |
|---|---|---|
| `format.fps` | ✅ | 帧率 |
| `format.duration_sec` | ✅ | 总时长 |
| `format.width/height` | ✅ | 输出分辨率（内部固定 270×480 渲染后放大） |
| `scene.seed` | ✅ | 所有随机流的根种子 |
| `concept.hook_line` | ✅ | 烧录为顶部文字 |
| `publish.title` | ✅ | 烧录为底部文字（**硬截断 44 字符，超出无省略号**） |
| `timeline[]` | ⚠️ **未实现** | 文字位置 / event / sfx 时间轴尚未驱动渲染 |
| `axes.*` | ⚠️ **未实现** | 纯元数据，不参与渲染 |

---

## 七、范围钳制表

越界值会被夹回下列区间，不中断渲染。

| 字段 | 范围 | 来源 |
|---|---|---|
| `arena.size` | 0.4 – 0.95 | `MelodyBounceParamsSchema` |
| `arena.wall_thickness` | 0.004 – 0.05 | 同上 |
| `arena.rotation_deg_per_s` | -90 – 90 | 同上 |
| `balls.count_start` | 1 – 16（整数） | 同上 |
| `balls.radius` | 0.01 – 0.08 | 同上 |
| `balls.speed` | 0.1 – 2.0 | 同上 |
| `balls.restitution` | 0.7 – 1.15 | 同上 |
| `balls.gravity` | -1.0 – 2.0 | 同上 |
| `balls.max_count` | 1 – 128（整数） | 同上 |
| `rule.every_n_bounces` | 1 – 20（整数） | 同上 |
| `rule.scale_factor` | 1.01 – 1.25 | 同上 |
| `bins.count` | 2 – 6（整数） | `BallSortParamsSchema` |
| `mechanism.pegs.rows` | 3 – 12（整数） | 同上 |
| `mechanism.pegs.jitter` | 0 – 0.5 | 同上 |
| `mechanism.gates[].period_s` | 0.5 – 10 | 同上 |
| `pendulum.count` | 6 – 24（整数） | `PendulumWaveParamsSchema` |
| `rule.cycle_sec` | 8 – 45 | 同上 |
| `orbits.count` | 4 – 18（整数） | `OrbitSyncParamsSchema` |
| `rule.trigger_angle_deg` | -180 – 180 | 同上 |
| `trail.length_frames` | 0 – 60（整数） | `videospec.ts` |
| `trail.fade` | 0 – 1 | 同上 |
| `camera.zoom_from` | 0.5 – 2.0 | 同上 |
| `camera.zoom_to` | 0.5 – 2.5 | 同上 |
| `audio.music.transpose` | -24 – 24（整数） | 同上 |
| `audio.music.tempo_bpm` | 40 – 240 | 同上 |

---

## 八、故意未做的事（T1 约束）

本任务只做「接线」，**不改变任何画风**：

- ❌ 未改配色、线宽、形状生成逻辑
- ❌ 未引入 numpy / Pillow（留待 T2）
- ❌ 未改 TypeScript 侧代码
- ❌ 未做抗锯齿、超采样、后期处理

像素换算公式集中写在 `spec_params.resolve_pixels()`：

```
场地半径 = RENDER_W * 0.5 * size * 0.5
墙线粗细 = wall_thickness * RENDER_W
球半径   = radius * RENDER_W
初速度   = speed * RENDER_W * 0.9
重力     = gravity * RENDER_H * 0.32
```

---

## 九、验证方法

```bash
# 1. 语法检查
python3 -m py_compile workers/render/render_worker.py workers/render/spec_params.py

# 2. 4 个 fixture 全部渲染
npx tsx scripts/export_fixtures.ts
python3 workers/render/bench.py

# 3. 验证参数真的生效：改 payload 里 balls.speed / gravity 再渲染对比
```

验收实测结果见提交说明。
