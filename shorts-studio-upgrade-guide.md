# Shorts Studio「视频太平淡」治理方案 + 小模型改造 Prompt 手册

> 适用仓库:`JacketYang/shorts-studio`　|　数据来源:你的 YouTube Studio 导出表(共 27,669 次观看)
> 读法:第 1–4 章是**诊断与方案**(你读),第 5–7 章是**可以直接复制给小模型的 Prompt**(模型读)。本文不含代码,只有诊断、参数和指令。

---

## 0. 一句话结论

**你的视频不是"创意不够",而是"成片渲染器没有把 JSON 里写的东西画出来"。**

JSON(Spec)里已经定义了拖尾、镜头缩放、渐变背景、乐器、混响、音效、结尾类型……但负责出 MP4 的 `workers/render/render_worker.py` 几乎全部**忽略**这些字段:

- 画面:270×480 的小图用 bicubic 硬拉伸到 1080×1920(糊),圆无抗锯齿,背景是单色,没有发光、粒子、震屏、镜头。
- 声音:纯正弦波 + 2 个泛音,单声道,没有伴奏、没有节奏、没有混响。
- 旋律:只读了旋律的"音高序列",**丢掉了每个音的节拍和时值**,所以弹球碰哪响哪,节奏全乱,观众认不出曲子。
- 文字:钩子文字整个视频一直挂着,不动;标题文字画在 Shorts 底部 UI 会遮住的位置。
- 叙事:没有"铺垫 → 升级 → 高潮 → 收尾"的曲线,视频从头到尾强度一样。

所以:**无论你(或我)怎么改 JSON,成片都差不多。** 这就是"所有视频都平淡"的根因。要解决,必须改渲染器,而不是继续改选题和标题。

---

## 1. 数据说明了什么(来自你的表格)

### 1.1 关键数字

| 指标 | 数值 | 解读 |
|---|---|---|
| 总观看 | 27,669 | 约 2 周 |
| 平均观看时长 | 21 秒 | 视频本身只有 13–45 秒 |
| 平均观看百分比 | 80.4% | **被短时长和循环抬高,不是好信号** |
| 继续观看(Stayed to watch) | **43.85%** | **真正的瓶颈**:56% 的人在头 1–2 秒划走。经验上 70% 以上才容易被继续推荐(经验值,非官方) |
| 订阅 | 18(总 0.65‰) | 转化极低 |
| 点赞 | 198(约 7‰) | 偏低 |
| 分享 | 15(约 0.5‰) | **几乎没有人愿意转发** |
| 评论 | 4 | 几乎没有互动 |
| 单条观看 | 850–1,900 | 近 27 条有效视频里,绝大多数都卡在 850–1,900 这一档:**每条都只过了第一波测试池,没有一条"出圈"** |

### 1.2 发现的规律

1. **"平淡"在数据里的样子 = 划走率高 + 分享≈0 + 播放全部扎堆。** 内容本身并不差(完播百分比高),但没有任何一条让人"哇"到想转发。
2. **继续观看最高的几条,都有"明确的承诺 / 升级 / 熟悉感":**
   - `16 Balls, 4 Bins: Sorted in 10 Seconds` → 61.8%(时间承诺)
   - `The Same Melody 5 Times, Each Faster` → 57.4%(升级结构)
   - `14 Orbits… 75 Seconds`(80 秒长视频)→ 54.7%,且**点赞率 17‰ 全场最高**
   - `A Ball Plays Für Elise` → 54.2%(熟悉旋律)
3. **继续观看最低的,是"讲解型"和"换皮重复型":**
   - Quick Sort 24.4%、Shell Sort 24.9%、Bubble Sort 33.1%、Moon 8.3%、Slides 11.7%
   - Spiral Machine 33.5%、1 Moving Gate 32.1%、4 Gates 35.5%(同一个球桶视频的换皮版)
4. **订阅主要来自"认得出旋律/有惊喜知识点"的视频:** Canon in D(4)、π 碰撞(3+)、Ode to Joy(2+1)。**球桶排序系列 9 条,占全部播放 37%,却只带来 5 个订阅,点赞率 5.3‰(其余视频 7.8‰)。** 这个系列在重复消耗你的流量。
5. **标题已经很规整,但标题不是瓶颈**:缩略图点击率在 Shorts 里意义有限,真正决定推荐的是"头 2 秒留不留人"和"看完后有没有动作"。
6. **频道里还有十几条与主题无关的旧中文视频(2018–2019、工程课程、消防等)**,会稀释频道定位。建议你自己决定是否设为私享/不公开(这是运营决策,不属于代码改动)。

> ⚠ 样本量小(单条 1–2k 播放),以上是"假设",本文第 8 章给了验证实验。

---

## 2. 源码审计:为什么画面和声音都平淡

下表每一条都已对照源码确认。"证据位置"方便你/小模型直接定位。

### 2.1 渲染器问题(最重要)

| 编号 | 问题 | 证据位置 | 后果 |
|---|---|---|---|
| R1 | **JSON 字段大面积不生效**。melody-bounce 只读了 `arena.shape / rotation_deg_per_s / rule.type`;不读 `size / wall_thickness / balls.* / every_n_bounces / scale_factor / note_trigger`,`gravity_flip` 规则未实现;ball-sort 只读 `balls.count / balls.colors / bins.count`,不读 `layout / pegs / gates / spiral / goal.celebrate`;`orbit-sync` 的 `pulse_rings` 未实现 | `render_worker.py` 各模板分支 | 改 JSON 不改画面,所有视频长得一样 |
| R2 | **样式字段全被忽略**:`style.trail`、`style.camera`、`background.type/渐变第二色`、`palette.family` | 渲染器只取 `background.colors[0]`;拖尾长度写死 8 | 没有镜头、没有渐变、拖尾不可调 |
| R3 | **时间线与音频字段被忽略**:`timeline` 的 event/sfx/text 时间、`audio.music.instrument / tempo_bpm / transpose / reverb / note_mapping`、`audio.sfx`、`format.loop`、`concept.ending` | 渲染器只用了 hook_line 与 publish.title | 没有音效、没有结尾、没有循环处理 |
| R4 | **分辨率低**:内部 `RENDER_W=270, RENDER_H=480`,再 bicubic 放大 4 倍到 1080×1920 | 文件顶部常量 + ffmpeg `scale` | 整个画面发糊、边缘毛刺 |
| R5 | **没有抗锯齿、没有发光**:画圆/线是"像素是否在半径内就涂色" | `draw_circle / draw_ring / draw_line` | 像 90 年代像素画,没有"高级感" |
| R6 | **没有打击感(Juice)**:碰撞只有墙颜色闪 0.12 秒 | melody-bounce 分支 `flash_timer` | 碰撞没有反馈,看着"空" |
| R7 | **旋律节奏丢失**:`notes = [n["pitch"] ...]`,只取音高;`beat`、`dur`、`tempo_bpm` 全没用,按碰撞顺序依次弹 | 渲染器顶部旋律处理 | 曲子认不出来(而"认出旋律"正是你订阅转化最高的内容) |
| R8 | **声音单薄**:正弦 + 2/4 倍泛音,衰减 0.3 秒,单声道;无低音、无打击、无混响、无声像;ball-sort 每碰一次钉子就响一个音,旋律被打碎 | `synthesize_wav` | 听感像"手机提示音" |
| R9 | **文字问题**:钩子文字全程不消失、无动画;标题文字画在 y=1660(底部 86%,会被 Shorts 的标题/账号遮住);ffmpeg 默认字体不支持 emoji(会变方框);无描边阴影 | `drawtext` 两行 | 钩子没有"冲击",且文字不好读 |
| R10 | **没有叙事曲线**:模拟线性跑完,强度恒定;`ending: loop/reveal/cut` 不起作用 | 全部分支 | 没有高潮,没有收尾,没有"想再看一遍"的冲动 |
| R11 | **预览 ≠ 成片**:浏览器预览用 `src/domain/simulation.ts` + `SimulationPlayer.tsx`,成片用 Python 另写了一套物理 | 两套独立实现 | 你在工作台里看到的和最终 MP4 不一致,没法调参 |
| R12 | **渲染超时 60 秒**(`server.ts` 约第 105 行),升级画质后必须放宽 | `execFileAsync(... timeout: 60_000)` | 升级后会被杀进程 |

### 2.2 内容与 JSON 层问题

| 编号 | 问题 | 后果 |
|---|---|---|
| C1 | 默认 `specgen_system`(`src/server/store.ts` 约第 70 行)要求"钩子 ≤6 词、0.2 秒出效果",但渲染器**无法兑现**;LLM 只能在"保守参数"里选值,没有"强度下限" | 输出的 JSON 参数都很温和(旋转 6°/s、速度 0.55……) |
| C2 | 没有"惊喜/反转(twist)"这个必填项,每条视频是"一直在做同一件事" | 无记忆点,不可分享 |
| C3 | 球桶排序 9 条/10 天,标题骨架几乎相同 | 观众疲劳 + 平台判定"重复内容"风险 |
| C4 | 奖励函数(`src/domain/analytics.ts`)与轴(`axes`)里没有"画面特效等级 / 叙事曲线"这些维度 | 系统无法学到"哪种画面效果更好" |

---

## 3. 「不平淡」的可验收标准

改完后,每条视频应能通过下面 10 项检查(满分 10,**≥ 8 才允许进入审核**):

| # | 检查项 | 标准 |
|---|---|---|
| 1 | 首帧不空 | t=0 画面里已有运动物体,且 ≥3 种颜色 |
| 2 | 头部声音 | 第一个音/音效在 **0.3 秒内**响起 |
| 3 | 钩子文字 | 0.15 秒内弹出(有缩放动画),字高 ≥ 画面高度 5%,有描边,≤ 6 个词,2.2 秒内退场 |
| 4 | 打击感 | 每次强事件都有 闪光 + 涟漪 + 粒子 + 小球弹跳放大 中至少 3 项 |
| 5 | 强度曲线 | 视频后 30% 的"画面强度"明显高于前 30%(粒子数/速度/缩放/声部数至少 2 项更高) |
| 6 | 旋律可识别 | 旋律型视频的音符节奏与原曲节拍吻合(用"节奏锁定",见 T8) |
| 7 | 有变化的声部 | 至少 3 层声音(主旋律 + 低音 + 节奏/氛围),并随强度逐层加入 |
| 8 | 有反转/高潮 | 视频内至少出现 1 次"明显不同的瞬间"(静音再爆发、规则突变、数量暴增等) |
| 9 | 安全区 | 重要文字不在顶部 10% 和底部 20%;右侧 12% 不放关键信息 |
| 10 | 结尾 | 最后 1–2 秒有收束(收光/回到起始状态/揭晓字幕),循环型视频首尾可无缝衔接 |

---

## 4. 改造路线图

**原则:先让渲染器"诚实"(JSON 生效),再让它"好看"、"好听",最后让内容"有戏"。**

| 阶段 | 任务 | 目的 | 难度(对小模型) | 预估改动量 |
|---|---|---|---|---|
| P0 | T0 基线与对比脚本 | 有"改前/改后"对照,能量化耗时 | ★ | 1 个新脚本 |
| P0 | T1 JSON 参数接线 | 让 JSON 真正影响成片(R1–R3) | ★★ | 只改 Python |
| P0 | T2 渲染管线升级 | 解决糊、锯齿、无渐变、无拖尾(R2/R4/R5/R12) | ★★★ | 重写绘图层 |
| P0 | T3 打击感系统 | 碰撞反馈(R6) | ★★ | 新增模块 |
| P1 | T4 视觉风格包 | 小球/场地/背景/各模板的"高级感" | ★★ | 各模板分支 |
| P1 | T5 叙事曲线 Arc | 铺垫→升级→高潮→收尾(R10) | ★★★ | schema + 渲染 |
| P1 | T6 文字与 HUD | 钩子动画、计数器、字幕、安全区(R9) | ★★ | 文字层 |
| P1 | T7 音频引擎 v2 | 乐器、伴奏、混响、声像(R8) | ★★★ | 重写音频 |
| P1 | T8 节奏锁定 | 旋律节奏正确、认得出曲子(R7) | ★★★ | melody-bounce |
| P1 | T9 冷开场与循环结尾 | 压低 1–2 秒划走率(R10) | ★★ | 时间线 |
| P2 | T10 新模板 rings-escape | 内容差异化 | ★★★ | 新模板 |
| P2 | T11 预览对齐 | 解决 R11 | ★★ | 前端 |
| P1 | T12 SpecGen 提示词与 Schema | 让 LLM 写出"有戏"的 JSON(C1–C3) | ★★ | schema + prompt |
| P2 | T13 奖励与实验维度 | 让系统学会选画面方案(C4) | ★★ | analytics/bandit |
| P2 | T14 自动平淡检测 | 把第 3 章标准变成 QA 检查 | ★★ | QA |

**依赖关系:** T0 → T1 → T2 → (T3, T4, T6, T7 可并行,但建议顺序做)→ T5 → T8 → T9;T12 在 T5 之后做(因为要引用 Arc/FX 字段)。

**强烈建议:** 每个任务单独一次对话、单独一个 git commit。小模型一次性给太多任务会出现"改一半、乱重构"。

---

## 5. 给小模型的使用说明

### 5.1 使用方式

1. 每次新开对话,先粘贴 **5.2 通用前置 Prompt**。
2. 再粘贴**一个**任务 Prompt(T0、T1……)。
3. 让它先输出"计划(≤10 行)"再改文件。
4. 它改完后,你运行该任务 Prompt 末尾"验收"里列的命令,通过再提交。
5. 不通过就把报错原文贴回去,让它只修这个问题。

### 5.2 通用前置 Prompt(每次都先贴)

```text
你是一名资深 Python / TypeScript 工程师,正在修改开源仓库 shorts-studio(一个 YouTube Shorts 自动化工作台)。
仓库里有两条互相独立的"画面实现":
 (a) 浏览器预览:src/domain/simulation.ts + src/components/SimulationPlayer.tsx
 (b) 服务端成片渲染:workers/render/render_worker.py(Python + ffmpeg),由 server.ts 约第 104 行调用。
我们当前要改进的是 (b),除非任务明确说要改 (a)。

【工作规则,必须全部遵守】
1. 只完成我给你的这一个任务,不要顺手重构、改名、格式化无关代码,不要改任务清单之外的文件。
2. 先阅读任务指定的文件(完整读),再用不超过 10 行写出你的修改计划,然后再动手。
3. 向后兼容:所有新增的 Spec 字段都必须是可选的,并有默认值;没有这些字段的旧 JSON 必须仍能渲染成功。
4. 确定性:同一份 Spec(含 seed)渲染两次,输出 MP4 的画面必须逐帧一致。随机数只允许使用以 spec.scene.seed 派生的 random.Random 或 numpy.random.default_rng(seed),禁止使用时间、系统随机数、全局随机数。
5. 依赖限制:Python 端只允许使用标准库 + numpy + Pillow + 命令行 ffmpeg;禁止联网、禁止 GPU、禁止 Chromium。如需新增依赖,要同步更新 workers/render/Dockerfile 与 .github/workflows/render.yml 的安装步骤。
6. 函数要小:单个函数不超过 60 行;新增模块放在 workers/render/ 下新文件里,不要把 render_worker.py 越写越长。
7. 性能预算:渲染一个 30 秒、30fps 的视频,在普通 2 核机器上不超过 120 秒。需要时提供 --draft 参数(降低内部分辨率到 540×960)用于调试。
8. 不要写占位符、TODO 或"此处省略"。所有代码必须是完整可运行的。
9. 不要修改测试以"让测试通过";如果必须修改测试,说明原因。
10. 完成后用中文输出:① 改了哪些文件 ② 每个文件做了什么(每个 1–2 句)③ 我该运行哪些命令验证 ④ 有哪些没做完或有风险的地方。

【背景】这个频道发布"物理模拟 + 旋律"的 Shorts,当前问题是所有视频画面和声音都"平淡":画面发糊、没有特效、声音单薄、没有强度变化。我们要让每条视频更有冲击力,但不改变"确定性渲染"的原则。
```

---

## 6. 任务 Prompt(逐个复制)

> 每个 Prompt 都已写成"拿来就能用"的完整形式。方括号里的 `【数值】` 是我定好的参数,不要让小模型自己"发挥"。

---

### T0　基线与对比脚本(P0)

```text
【任务 T0:建立"改前/改后"对比基线】

目标:新增一个脚本,把仓库里 4 个内置 fixture(melody-bounce、ball-sort、pendulum-wave、orbit-sync)各渲染成 MP4,并打印每个的渲染耗时,方便我们后续对比。

允许改动/新增的文件:
- 新增 scripts/export_fixtures.ts(用 tsx 运行,把 src/domain/templates.ts 里导出的 4 个 FIXTURE_* 常量,以及 melody-bounce 所需的旋律(从 src/domain/melodies.ts 的 INITIAL_MELODIES 里按 spec.audio.music.melody_ref.id 查找),写成 4 个 payload JSON 到 out/payloads/ 目录,格式为 { "spec": ..., "melody": ... }。)
- 新增 workers/render/bench.py:遍历 out/payloads/*.json,调用 render_worker.py 的 render_mp4,输出到 out/videos/<名字>.mp4,打印每个文件的耗时秒数和文件大小,并在最后打印总耗时。
- 新增 out/ 到 .gitignore。

步骤:
1. 先读 src/domain/templates.ts 里 FIXTURE_ 开头的 4 个导出名,以及 INITIAL_MELODIES 的导出方式。
2. 写 scripts/export_fixtures.ts。如果某个 fixture 没有使用旋律库,则 melody 写 null。
3. 写 bench.py,用 time.perf_counter 计时,render_mp4 抛异常时打印异常并继续下一个。
4. 在 package.json 的 scripts 里新增 "fixtures:export": "tsx scripts/export_fixtures.ts"(这是唯一允许对 package.json 的改动)。

验收:
- 运行 npx tsx scripts/export_fixtures.ts 后,out/payloads 下有 4 个 JSON。
- 运行 python3 workers/render/bench.py 后,out/videos 下有 4 个 mp4,终端打印 4 行耗时。
- 把这 4 个 mp4 复制到 out/baseline/ 保存起来(这是"改前"版本,后面每个任务都要对比)。
```

---

### T1　JSON 参数接线(P0,最关键的一步)

```text
【任务 T1:让 Spec 里写了的参数真正影响成片】

背景:render_worker.py 目前忽略了 Spec 里大量字段,导致无论怎么改 JSON,成片都差不多。本任务只做"接线":让已有字段生效,不改变画风(画风升级在后续任务做)。

允许改动的文件:workers/render/render_worker.py;新增 workers/render/spec_params.py;新增 docs/PARAM_WIRING.md。

步骤:
1. 完整阅读 render_worker.py,以及 src/domain/templates.ts 里 4 个模板的 zod 参数 schema(MelodyBounceParamsSchema、BallSortParamsSchema、PendulumWaveParamsSchema、OrbitSyncParamsSchema)和 src/domain/videospec.ts 里 scene.style / timeline / audio 的 schema。
2. 新建 spec_params.py:提供函数 load_params(spec) 返回一个"参数对象",里面包含所有字段及默认值(默认值取自 templates.ts 的 fixture 里的取值)。对每个字段做范围钳制(范围取自 zod schema 的 min/max)。渲染器以后只通过它取参数,不再直接 params.get(...)。
3. 在 render_worker.py 的 melody-bounce 分支接入以下字段(目前全部写死):
   - arena.size:场地半径 = RENDER_W * 0.5 * size * 0.5(size 范围 0.4–0.95)
   - arena.wall_thickness:墙线粗细 = wall_thickness * RENDER_W
   - balls.count_start:初始球数;balls.max_count:球数上限(替换写死的 12)
   - balls.radius:半径 = radius * RENDER_W(替换写死的 7.5)
   - balls.speed:初速度 = speed * RENDER_W * 0.9 像素/秒
   - balls.restitution:碰墙反弹系数(替换写死的 1.0)
   - balls.gravity:重力 = gravity * RENDER_H * 0.32 像素/秒²(替换写死的 155)
   - rule.every_n_bounces:分裂/变化的触发间隔(替换写死的 3)
   - rule.scale_factor:grow_on_bounce 的放大系数(替换写死的 1.035)
   - rule.type 新增 gravity_flip:每 every_n_bounces 次碰撞,重力方向取反
4. ball-sort 分支接入:bins.layout(under-funnel / stepped / split-chute 三种桶的位置布局,先实现 under-funnel 和 stepped,split-chute 暂用 under-funnel 并在 PARAM_WIRING.md 里标注"未实现")、mechanism.pegs.rows(钉子行数,替换写死的 6 行)、mechanism.pegs.jitter(钉子位置抖动,使用 seed 派生的随机数)、mechanism.gates 里的 moving 类型(一块来回移动的挡板,周期 period_s)。
5. pendulum-wave 与 orbit-sync:接入 note_trigger.on;orbit-sync 的 rule.type 新增 pulse_rings(圆环半径按 1+0.06*sin(t*3) 脉动)。
6. 通用:
   - audio.music.transpose:所有 midi 加上 transpose 半音
   - audio.music.tempo_bpm 暂时只读取并保存,供 T7/T8 使用
   - scene.style.trail:enabled/length_frames/fade 控制拖尾(替换写死的 8 点,length_frames=0 或 enabled=false 时不画拖尾,fade 控制尾部亮度衰减)
   - scene.style.background:type=gradient 时用 colors[0]→colors[1] 垂直渐变(预先生成一帧背景缓存复用);type=grid 时在背景上叠加间距 6% 画面宽的淡网格线(亮度 +6%);type=solid 用 colors[0]
   - scene.style.camera:zoom_from→zoom_to 在整个时长内线性缩放(以画面中心为原点,对绘制坐标做缩放),shake 暂时只读取不使用
7. 写 docs/PARAM_WIRING.md:一张表,列出每个 Spec 字段 → 是否已生效 → 在哪个函数里生效;未实现的明确写"未实现"。

禁止:不要改变任何绘制风格(颜色、线宽、形状),不要引入 numpy/Pillow(下个任务再做),不要修改 TypeScript 文件。

验收:
- python3 -m py_compile workers/render/render_worker.py workers/render/spec_params.py 通过。
- 手动把 fixture 里的 balls.speed 从 0.55 改成 1.2、balls.gravity 改成 0.8,重新渲染,画面里的球速度/下落明显变化(以前不会变)。
- 把 style.trail.enabled 设为 false,拖尾消失。
- 运行 python3 workers/render/bench.py 4 个 fixture 仍全部成功,且旧 JSON(不含任何新字段)能渲染。
```

---

### T2　渲染管线升级(P0)

```text
【任务 T2:升级绘图层——更高分辨率、抗锯齿、发光、真实拖尾】

背景:当前渲染器内部画面是 270×480,再硬拉伸 4 倍,所以发糊;图形没有抗锯齿;背景是纯色。本任务只替换"绘图底层",不改变各模板的物理逻辑与参数含义。

允许改动的文件:workers/render/render_worker.py;新增 workers/render/gfx.py;workers/render/Dockerfile(安装 numpy、Pillow);.github/workflows/render.yml(同样安装);server.ts(只允许把渲染超时 60_000 改为 240_000)。

【技术方案,必须照此实现】
1. 帧缓冲:使用 numpy float32 数组,形状 (H, W, 3),取值 0–255。
   默认内部分辨率 720×1280;--draft 参数时为 540×960。输出到 ffmpeg 前转 uint8。
   ffmpeg 放大到成片尺寸时使用 scale=1080:1920:flags=lanczos(不要再用 bicubic)。
   所有以"像素"为单位的参数,一律改写成"相对于画面宽度 W 的比例"(例如球半径=0.028*W),这样分辨率可切换而画面一致。
2. gfx.py 提供以下函数(全部基于 numpy,只在图形的包围盒内计算,不要全屏循环):
   - fill_gradient(top_rgb, bottom_rgb) → 生成背景缓存(只生成一次)
   - draw_disc_aa(fb, cx, cy, r, rgb, alpha=1.0):抗锯齿实心圆,边缘用 1 像素宽的平滑过渡(距离场 smoothstep)
   - draw_ring_aa(fb, cx, cy, r, thickness, rgb, alpha=1.0):抗锯齿圆环
   - draw_line_aa(fb, x0, y0, x1, y1, thickness, rgb, alpha=1.0):抗锯齿线段(圆头)
   - add_glow(fb, cx, cy, r, rgb, strength):加色发光——使用预先缓存的"径向衰减贴图"(按半径取整缓存),用加法混合叠加到 fb 上,最后整体 clip 到 255
   - apply_vignette(fb, strength):使用预先缓存的暗角蒙版相乘,四角亮度 ×0.55,中心 ×1.0
   - decay_buffer(fb, factor):fb *= factor,用于"余辉拖尾"
3. 拖尾实现方式改为"余辉缓冲":
   - 维护一个持久的 trail_buffer(float32,同尺寸)。
   - 每帧:trail_buffer *= trail.fade(取 spec.scene.style.trail.fade,默认 0.86);把本帧所有球的发光圆加色画进 trail_buffer;
   - 合成:最终帧 = 背景 + trail_buffer + 本帧清晰层(球本体、墙线)。
   - 如果 trail.enabled 为 false,则 trail_buffer 每帧清零。
4. 改写四个模板的绘制调用:把 draw_circle/draw_ring/draw_line 全部替换为 gfx.py 的对应函数;球本体用 draw_disc_aa,外加 add_glow(半径 = 球半径 × 3.2,强度 0.55);球上再叠一个小高光(偏左上 30% 半径处,半径 25%,白色 alpha 0.55)。
5. 文字暂时仍用 ffmpeg drawtext(T6 再改),但字号、位置需按新的输出尺寸保持原样。
6. 删除旧的 draw_circle / draw_ring / draw_line / draw_rect_outline(确认没有其他引用后)。

禁止:不要改物理逻辑、不要改音频、不要改 Spec schema。

验收:
- python3 workers/render/bench.py 全部成功。
- 抽取一帧(ffmpeg -i x.mp4 -vf "select=eq(n\,60)" -vframes 1 frame.png),放大看:圆边缘平滑,球有柔和光晕,背景是渐变(当 spec 配了渐变时)。
- 同一个 payload 连续渲染两次,两个 mp4 的 ffmpeg -f framemd5 输出逐帧一致(确定性)。
- 30 秒视频渲染耗时 ≤ 120 秒;如果超了,按顺序优化:① 只对包围盒做 numpy 运算 ② 发光贴图缓存 ③ 粒子/球数上限 ④ 把 trail_buffer 用 float16。
```

---

### T3　打击感系统 Juice(P0)

```text
【任务 T3:为每一次碰撞/掉落添加视觉反馈】

前提:T2 已完成(渲染器使用 numpy 帧缓冲和 gfx.py)。

允许改动的文件:新增 workers/render/fx.py;改 workers/render/render_worker.py 的四个模板分支(只在"产生事件"的位置调用 fx,不改物理);workers/render/spec_params.py(读取新字段);src/domain/videospec.ts(给 scene.style 增加可选字段 fx,否则 zod 会把未知字段丢掉!);src/domain/types.ts(同步类型)。

【Spec 新增可选字段】scene.style.fx = { level: 0|1|2|3(默认 2), flash: 0–1, ripple: 0–1, particles: 0–1, shake: 0–1, pop: 0–1, vignette: 0–1 }
 - level 是总开关预设,具体字段缺省时按 level 预设取值;显式写了的字段覆盖预设。
 - level=0 表示完全关闭(等同旧效果);1 轻;2 标准(默认);3 强烈。
 - 预设倍率表:
     level 0:全部 0
     level 1:flash 0.4, ripple 0.5, particles 0.4, shake 0.0, pop 0.5, vignette 0.3
     level 2:flash 0.7, ripple 0.8, particles 0.7, shake 0.5, pop 0.8, vignette 0.5
     level 3:flash 1.0, ripple 1.0, particles 1.0, shake 1.0, pop 1.0, vignette 0.7

【fx.py 需要实现的效果,每个事件携带 intensity i∈[0.3,1.0] 与位置 (x,y) 与颜色】
 1. 背景闪光:背景亮度 +(0.06+0.10*i)*flash,指数衰减,时间常数 0.10 秒。
 2. 涟漪环:从碰撞点扩散,半径 0 → 0.12*W,持续 0.45 秒,线宽 3px→1px,透明度 0.8→0,颜色=触发球的颜色,强度乘 ripple。
 3. 粒子:数量 round((6+10*i)*particles);初速度 0.12W–0.36W 每秒,方向随机(使用 seed 派生的 rng);寿命 0.35–0.6 秒;大小 3px→0.5px;受轻微重力(0.3*W/秒²);颜色取球色与调色板随机混合;任意时刻存活粒子上限 60(超出时丢弃最早的)。粒子用 add_glow 绘制。
 4. 小球弹跳放大(pop):事件球半径倍率 1+0.35*i*pop → 1.0,0.12 秒内 ease-out 回落。
 5. 墙体点亮:最近的一段墙(圆形场地按角度分 24 段,多边形按边)亮度从 1.0 → 0.25,0.25 秒衰减,线宽 3 倍,颜色=球色。
 6. 震屏:只对 i≥0.8 的强事件触发;位移幅度 = shake * i * 0.006 * W;频率 30Hz;0.14 秒衰减。通过对最终帧整体平移实现(平移后空出的边缘用背景色填充)。
 7. 暗角:全程固定,强度 vignette(调用 gfx.apply_vignette)。
 8. 事件强度来源:melody-bounce 的碰墙=0.6,分裂=1.0,每第 8 次碰撞额外+0.2;ball-sort 的钉子=0.4,入桶=0.9,整桶满=1.0;pendulum-wave 过中线=0.5,全体对齐=1.0;orbit-sync 过光束=0.6。

禁止:不要改变物理结果与音频事件时间;所有粒子必须由 seed 派生的 rng 产生,保证可复现。

验收:
- python3 -m py_compile 全部通过;npm run lint(tsc --noEmit)通过;npm test 通过。
- 渲染 melody-bounce,逐帧观看:每次碰墙有明显的闪光/涟漪/粒子;level 设 0 时与 T2 后的画面一致;level 设 3 时明显更夸张。
- 渲染两次逐帧 md5 一致。
- 粒子最多同时 60 个(在代码里有断言或上限处理)。
```

---

### T4　视觉风格包(P1)

```text
【任务 T4:让四个模板"好看"——统一的视觉设计规范】

前提:T2、T3 已完成。

允许改动的文件:workers/render/render_worker.py 的各模板分支;新增 workers/render/theme.py。

【theme.py】提供 get_theme(spec) 返回主题对象,包含:
 - 背景:渐变(来自 spec.background.colors;只有一种颜色时,第二色=第一色向黑色混合 55%);慢速漂浮背景光斑 bokeh:12 个,半径 0.04W–0.12W,透明度 0.05–0.10,按 seed 生成位置,以 0.01W/秒速度漂移(循环包裹),使用加色混合。
 - 颜色循环:球每发生一次碰撞,颜色切换到调色板下一个颜色(melody-bounce),用 0.08 秒颜色渐变过渡。
 - 文字/墙体默认颜色:调色板第一色的 85% 亮度版本,而不是写死的灰色(203,213,225)。

【各模板视觉要求】
1. melody-bounce:
   - 场地边框改为霓虹线:一条细亮线 + 外发光;墙线粗细 = wall_thickness 参数。
   - 场地内部画极淡的同心圆(透明度 0.05),随球数增长缓慢向内脉动。
   - 球数变多时(分裂规则),每个新球出生时有一个"生成闪光环"。
   - 球数超过 12 个后,自动降低每个球的发光强度(×0.7)避免画面发白。
2. ball-sort:
   - 钉子:默认亮度 0.45;被球击中后亮度跳到 1.0 并 0.3 秒衰减,同时给钉子加色发光。
   - 桶:画成半透明玻璃感矩形(淡色填充 alpha 0.12 + 亮边线),桶里的球堆叠高度越高,桶的发光越强;桶装满(达到球数/桶数)时触发一次"整桶庆祝":涟漪 + 30 个粒子(遵守粒子上限 60 的总量约束,庆祝时可临时放宽到 90)。
   - 球在飞行中保留速度方向的 3 点拉伸(速度越快越长)。
3. pendulum-wave:
   - 摆球颜色沿摆的序号做调色板渐变(不是循环取色),摆线透明度 0.35。
   - 所有摆球画长拖尾(拖尾 fade 使用 0.92),形成摆动的"光幕"。
   - 过中线时,中线对应位置出现一个短促的垂直闪光线。
4. orbit-sync:
   - 轨道环:透明度 0.18 的细环;行星各自有拖尾弧线;行星过光束时,光束在该位置爆一个闪光点。
   - 中心"太阳":半径随背景节拍呼吸 ±8%。

禁止:不要改变物理、事件时间、参数含义。

验收:
- 四个 fixture 都能渲染;抽取第 10 秒的一帧,肉眼可见:渐变背景 + 光斑、霓虹边框、球的光晕、拖尾。
- 画面不过曝:任何一帧里亮度 >240 的像素占比不超过 6%(请写一个小脚本统计抽样帧并打印结果)。
```

---

### T5　叙事曲线 Arc(P1)

```text
【任务 T5:为每条视频增加"强度曲线",让视频有铺垫、升级、高潮和收尾】

前提:T1–T4 已完成。

允许改动的文件:src/domain/videospec.ts(新增可选字段)、src/domain/types.ts(同步类型)、src/domain/templates.ts(给 4 个 fixture 各加上 arc 字段)、新增 workers/render/arc.py、workers/render/render_worker.py(各模板读取强度 I(t))、workers/render/spec_params.py。

【Spec 新增可选字段】scene.arc = { preset: "ramp"|"tease-then-build"|"wave"|"countdown"|"drop"(默认 "ramp"), climax_at: 0.5–0.95(默认 0.85), hook_peek: boolean(默认 true) }
 注意:videospec.ts 里 scene 是 zod 对象,不加字段就会被丢弃,务必同步修改 zod 和 JSON Schema(videospec.ts 里手写的 jsonSchema 部分也要加)。

【arc.py】提供 intensity(spec, t) 返回 I∈[0,1],令 u = t / duration_sec:
 - ramp:I = 0.25 + 0.75 * u^1.6
 - tease-then-build:u<0.05 时 I=0.9(预告);0.05≤u<0.15 时 I 从 0.9 线性降到 0.2;之后从 0.2 起,按 u 的 1.4 次方升到 1.0,在 u=climax_at 处到达 1.0;之后保持 1.0 到结束前 8%,最后 8% 降到 0.5
 - wave:三个正弦波叠加的起伏,前两个波峰 0.6,第三个波峰 1.0,波谷不低于 0.2;最后一个波峰位置=climax_at
 - countdown:把时长平均分为 5 段,每段 I 依次为 0.25、0.4、0.55、0.75、1.0;每段开头 0.15 秒有一个"节拍点"(给 fx 一个强度 1.0 的全屏闪光事件,并给音频一个 tick 事件)
 - drop:u<0.35 时 I=0.3(稀疏);0.35≤u<0.40 时静默蓄力(I=0.1,并且这段时间所有音频事件被抑制,画面球速降到 0.4 倍);u=0.40 时"爆发"(I=1.0,触发一次强度 1.0 的闪光+震屏+粒子大爆发);0.40–0.90 保持 1.0;最后 10% 降到 0.4
 所有 preset 在时间轴末尾 3% 内必须平滑过渡,避免硬切。

【I(t) 对画面的作用,统一用以下映射】
 - 球速度倍率 = 0.8 + 0.6*I
 - 镜头额外缩放 = 1 + 0.06*I(叠加在 camera.zoom_from→zoom_to 之上)
 - 粒子数量倍率 = 0.6 + 0.8*I
 - 场地旋转速度倍率 = 1 + 0.8*I
 - 背景亮度倍率 = 0.9 + 0.2*I
 - 墙体发光强度倍率 = 0.7 + 0.6*I
 - 球数规则(melody-bounce 的 split / ball-sort 的投球速率):I 越高,触发越频繁——split 的 every_n_bounces 实际取值 = max(1, round(every_n_bounces * (1.4 - 0.8*I)))
 - 暴露接口 intensity() 给 T7 音频使用(声部随 I 增减),本任务只需把它写成纯函数并有单元自检。

【hook_peek】当 hook_peek=true:视频前 0.5 秒,将画面按"高潮状态"的外观呈现(亮度 +15%、粒子密度×1.5、镜头缩放 1.08),0.5 秒时用 0.2 秒的"倒带"过渡(画面轻微模糊+色差,亮度回落)进入铺垫段,I 从此处按 preset 继续。目的:让头 2 秒就让观众看到"精彩预告"。

禁止:不要改变事件的物理/确定性;arc 只能影响"强度类参数",不能改变球的初始位置和 seed 派生的随机序列。

验收:
- npm run lint、npm test 通过(旧 fixture 不含 arc 也能通过校验;新增的 fixture 含 arc 也通过)。
- 为 arc.py 写一个 python3 -c 可运行的自检脚本 workers/render/test_arc.py:对 5 个 preset,检查 I 始终在 [0,1],末尾 3% 平滑,climax_at 附近达到最大值。
- 渲染 drop preset:能在 35%–40% 处看到/听到明显的"静默—爆发"。
- 渲染 ramp preset:最后 30% 的画面明显比前 30% 更热闹(粒子/速度/缩放)。
```

---

### T6　文字与 HUD(P1)

```text
【任务 T6:重做文字层——钩子动画、实时计数器、中途字幕、安全区】

前提:T2 已完成。

允许改动的文件:新增 workers/render/text_layer.py;新增 workers/render/fonts/(放入一个 OFL 授权的粗体无衬线字体文件,推荐 Montserrat-Bold.ttf 或 Inter-Bold.ttf,并在目录里放一个 LICENSE 文本);workers/render/render_worker.py(移除 ffmpeg drawtext,改为在帧缓冲上叠加文字);src/domain/videospec.ts + types.ts(新增可选字段);Dockerfile(字体安装无需改,因为随仓库携带)。

【规则】
1. 用 Pillow 的 ImageFont + ImageDraw 在帧上绘制文字;每个文字块预渲染成 RGBA 小贴图并缓存(只在文字内容/字号变化时重新生成),再用 alpha 混合贴到帧缓冲上。
2. 严格读取 spec.timeline 里 type="text" 的项:t(开始秒,负数表示从视频末尾倒数)、dur(持续秒)、role(hook / caption / end_card)、position(top-safe / center / bottom-safe)、style(字符串,先只支持 bold-white-shadow 与 small-white)。
3. 安全区:top-safe 文字垂直中心位于画面高度 16%;center 为 50%;bottom-safe 为 74%(绝对不要超过 78%)。右侧 12% 不放文字。文字宽度超过 86% 画面宽时自动换行(最多 2 行)或缩小字号(最低 70%)。
4. 样式:字高 hook=画面高度 5.4%,caption=3.4%,end_card=3.8%;白色填充 + 黑色描边(描边宽=字高 12%)+ 向下 4px 的柔和阴影。
5. 动画:
   - hook 出现:0.15 秒内从 70% 放大到 100%,并带 10% 的"过冲"回弹(先到 108% 再回 100%);消失:0.2 秒淡出并上移 2% 画面高度。
   - caption / end_card:0.2 秒淡入淡出。
   - 总规则:同一时刻最多出现 1 个 hook + 1 个 caption。
6. 钩子文字的自动"退场":如果 hook 的 dur 大于 2.2 秒,按 2.2 秒处理(超出部分忽略)。
7. 去掉原来画在 y=1660 的发布标题,不再把 publish.title 画到视频里。
8. emoji:Pillow 加载的字体不支持彩色 emoji;文字里的 emoji 一律在绘制前过滤掉(用正则移除常见 emoji 区间)。
9. 新增可选字段 scene.hud = { counter: "none"|"balls"|"notes"|"bounces"|"bins_filled"(默认 "none"), label?: string, position: "top-safe"|"bottom-safe"(默认 "bottom-safe") }:
   - 当 counter 不是 none 时,在画面上显示一个实时数字,例如 "BALLS 17"、"NOTES 42"。数字每次变化时有 0.12 秒的"数字跳动"效果(缩放 1.0→1.25→1.0),字高 4.2%,颜色用调色板第一色。
   - 数据来源:渲染器内部本来就知道球数、音符序号、碰撞数、已入桶数,直接读取即可。
10. 新增可选字段 scene.captions_auto: boolean(默认 false)。为 true 时,在 30%、60%、85% 时间点自动叠加 caption(文案从下面三条里循环取,允许 spec.concept 之外不再引入新字段):"Wait for it..."、"Faster now..."、"Here it comes!"。这三条文案由代码内置。

禁止:不要把文字画进物理模拟的帧缓冲(trail_buffer);文字必须在最后合成阶段叠加,避免拖尾把字糊掉。

验收:
- 渲染 melody-bounce:t=0.15 秒前文字已有放大动画;2.2 秒内文字消失;画面底部 20% 内没有文字。
- 开启 hud.counter="balls" 的 fixture,数字随球数增加而跳动。
- python3 workers/render/bench.py 全部成功;npm run lint 与 npm test 通过。
```

---

### T7　音频引擎 v2(P1)

```text
【任务 T7:重写音频合成——更好听、有层次、会随强度变化】

前提:T1(transpose/tempo 已接线)、T5(arc.intensity 可用)已完成。

允许改动的文件:新增 workers/render/audio.py;workers/render/render_worker.py(把 synthesize_wav 替换为 audio.render_audio);Dockerfile/workflow 已含 numpy(T2),无需新增依赖。

【总体要求】全部用 numpy 向量化生成(不要再用 Python 逐采样 for 循环),采样率 44100,立体声(2 声道),输出 WAV 后仍走原来的 ffmpeg loudnorm(I=-14)混流。

【乐器库】instrument 字符串到合成器的映射(未知名字回落到 marimba):
 - marimba:基频正弦 + 4 倍频(比基频衰减快 2.5 倍,幅度 0.35)+ 10 倍频(衰减更快,幅度 0.08)+ 开头 6 毫秒的噪声"敲击声";音符总长 0.55 秒;主衰减时间常数 0.18 秒
 - kalimba:基频 + 5.4 倍频(幅度 0.22,衰减 0.12 秒)+ 轻微的 0.02 秒起音;总长 0.7 秒
 - pluck:Karplus-Strong 弹拨弦(延迟线长度=采样率/频率,衰减系数 0.996,初始噪声由 seed 派生),总长 0.9 秒
 - bell:2 算子调频合成,调制比 3.5,调制深度从 3 指数衰减到 0.2,总长 1.4 秒
 - synth:两个失谐锯齿波(±6 音分)+ 低通滤波(截止频率随音符时长从 4000Hz 降到 900Hz),总长 0.5 秒
 每个音符受 events 里 intensity 控制音量(线性映射 0.35→1.0),并按事件位置 x 做声像:pan = (x/W - 0.5) * 1.2,限制在 [-0.7, 0.7],使用等功率声像。

【声部层次(随 arc 的 I(t) 逐层加入)】
 层 1 主旋律:始终存在(事件驱动,来自物理事件)
 层 2 低音:I ≥ 0.35 时加入;每小节(按 tempo_bpm 与 4/4)第一拍弹旋律当前所在调的主音,低八度,正弦波,时长 0.9 拍,音量 0.5
 层 3 节奏:I ≥ 0.6 时加入;每个八分音符一个极短的"嗒"(高通噪声 30 毫秒,音量 0.12,重拍音量 0.2);每小节第 1、3 拍加入柔和的底鼓(正弦 110Hz→45Hz 下滑,80 毫秒)
 层 4 增厚:I ≥ 0.85 时加入;主旋律每个音再叠加高八度、音量 0.4 的副本
 层的进出用 0.25 秒淡入淡出,不要硬切。
 当 spec.audio.mode == "none" 时输出静音;当 scene.arc 不存在时,按默认 ramp 曲线取 I。

【音效 SFX】读取 spec.audio.sfx 与 spec.timeline 中 type="sfx" 项,支持这些内置音色名:soft-pop(60 毫秒下滑正弦 800→300Hz)、whoosh(0.4 秒带通噪声,中心频率 500→3000Hz 上扫)、riser(2 秒噪声+上升正弦,音量线性渐强)、impact(120 毫秒低频正弦 70Hz + 噪声爆破)、tick(15 毫秒方波 2kHz)。未知名字忽略。
 额外自动音效(由渲染器生成,不需要 Spec 声明):arc 为 drop 时,爆发点前 1 秒自动加 riser,爆发点加 impact;arc 为 countdown 时,每段开头加 tick。hook_peek 的"倒带"过渡处加一个 whoosh。

【混响】根据 audio.music.reverb(0–1)在最终混音上叠加混响:用 numpy 生成一个 1.2 秒的指数衰减噪声脉冲响应(由 seed 派生),与干声卷积(用 FFT 卷积),湿声比例 = reverb * 0.35,并对湿声做 200Hz 高通。

【其他】
 - 首个音符/音效必须在 0.3 秒内出现:如果物理事件的首个声音晚于 0.3 秒,就在 0.05 秒处自动补一个 soft-pop。
 - 总削波保护:最终混音用软削波(tanh)而不是硬 clip。

禁止:不要修改物理事件产生的时间;不要用任何联网素材或预录音频文件。

验收:
- python3 -m py_compile 通过;写一个 workers/render/test_audio.py,检查:输出为 2 声道、长度=duration、无 NaN、峰值 ≤ 0.98。
- 用 ffmpeg -i x.mp4 -af volumedetect -f null - 检查音量不过小(mean_volume 在 -22dB 到 -12dB 之间)。
- 听感对比 baseline:有明显的低音/节奏层逐步加入,旋律音色更像真实乐器,有空间感。
```

---

### T8　节奏锁定:让旋律"认得出来"(P1,影响订阅转化)

```text
【任务 T8:melody-bounce 的音符节奏必须与原曲节拍对齐】

背景:现在旋律只取了音高序列,弹球碰撞到哪就弹下一个音,节奏全乱,观众认不出曲子。你的数据里"认得出旋律"的视频订阅转化最高,所以这是最值钱的一项。

前提:T1、T7 已完成。

允许改动的文件:新增 workers/render/rhythm.py;workers/render/render_worker.py(只改 melody-bounce 分支和旋律读取处)。

【步骤】
1. 旋律读取:不再只取 pitch。读取 melody.tracks[0].notes 的 beat(起始拍)、pitch(音高)、dur(时长,拍)、vel(力度)。用 spec.audio.music.tempo_bpm(没有则用 melody.tempo_bpm)把拍换算成秒:note_time = beat * 60 / tempo_bpm。音符时间表 schedule = [(note_time, pitch+transpose, dur秒, vel)],按需循环(wrap=loop 时,到末尾后从头再来,时间累加一个旋律总长;wrap=clamp 时结束后不再发声)。
2. rhythm.py 实现"速度调节器":
   - 前提:该模式只在 gravity 接近 0(|gravity| ≤ 0.05)时启用;有重力时回落到旧逻辑(并在日志中打印提示)。
   - 每次小球撞墙反弹之后,计算"沿新方向到下一次撞墙的距离 d"(圆形场地:射线与圆求交,解析求解;多边形场地:对每条边做射线-线段求交取最近;注意场地在旋转,用当前帧的旋转角度近似即可)。
   - 取下一个尚未发声的音符时间 t_next,计算还需要的时间 Δt = t_next - t_now。
   - 把该球速度大小设置为 d / Δt,但限制在 [0.55, 1.8] 倍基准速度(balls.speed)之间。
   - 如果计算出的速度超出范围:说明这一拍对于这个球太近或太远——此时允许"让球慢慢穿越"(用上限/下限速度),并让这个音符"跟随最近一次碰撞"发声(此时发声时间相对原曲偏差 ≤ 80 毫秒才算可接受;超过 80 毫秒则丢弃这次碰撞对应的音,等下一次碰撞)。
   - 多个球同时存在(分裂规则)时:只有"主球"(第一个球)参与节奏锁定,其他球的碰撞只触发装饰音(旋律里当前音的高八度,intensity 0.35)和视觉特效,不推进旋律。
3. 事件里每个声音事件带上 dur(时长)与 vel,T7 的乐器按 dur 控制音符长度(上限为乐器自身的总长)。
4. 在渲染结束时,打印:总音符数、被丢弃音符数、平均偏差毫秒、最大偏差毫秒,用于验收。

【验收】
- 对 Canon in D、Ode to Joy、Für Elise 三首渲染:平均偏差 ≤ 25 毫秒,最大偏差 ≤ 80 毫秒,被丢弃音符 ≤ 总数 5%。
- 人耳测试:关掉画面只听声音,能识别出原曲。
- 有重力的 spec 仍可渲染(回落旧逻辑);npm run lint 与 npm test 不受影响。
- 同一 payload 渲染两次结果一致。
```

---

### T9　冷开场与循环结尾(P1)

```text
【任务 T9:压低头 2 秒划走率,并让视频值得被反复看】

前提:T5、T6、T7 已完成。

允许改动的文件:workers/render/render_worker.py、workers/render/arc.py、workers/render/audio.py。

【冷开场规则(强制,对所有视频生效,不需要 Spec 字段)】
 1. 第 0 帧不能是空场景:melody-bounce 第 0 帧已有球处于运动中并且已带拖尾(做法:把模拟"预热"0.4 秒但不输出这 0.4 秒的帧);ball-sort 第 0 帧上方已有 3 个以上球在下落;pendulum-wave 第 0 帧各摆已分开不同相位;orbit-sync 第 0 帧各行星已有拖尾。
 2. 第一个音在 0.3 秒内(T7 已保证)。
 3. 钩子文字在 0.15 秒内出现(T6 已保证)。
 4. 头 1.5 秒内不允许出现"安静且静止"的画面:如果一帧与上一帧的平均像素差小于阈值,就报警日志(用于 QA)。

【循环结尾】读取 format.loop.enabled 与 mode:
 - mode = "visual-return":最后 1.2 秒内,把各物体状态向"第 0 帧状态"做插值(位置、颜色、背景),使最后一帧与第一帧画面接近;最后一帧的粒子/闪光清零。
 - mode = "audio-return":最后一个音符的尾音在视频结束前 0.3 秒内淡出;最后 1 秒的声部层逐步退到只剩主旋律,使结尾与开头的声音密度相当;不要出现硬切的尾音。
 - mode = "none" 或 enabled=false:使用 ending 字段(concept 之外的 axes.ending):
     * "reveal":最后 2 秒强度升到 1.0、画面中心出现一行 end_card 文字(沿用 timeline 里的 end_card),末尾 0.3 秒闪白过渡
     * "cut":在高潮最高点直接结束,但声音要在结束前 0.08 秒淡出避免爆音
     * "loop":按 visual-return 处理
 - 无论哪种,音频末尾都要保证没有爆音(最后 30 毫秒淡出到 0)。

验收:
- 抽第 0 帧和第 0.3 秒帧:都有运动物体;
- visual-return 的视频,对比最后一帧与第一帧(取像素均方差),应小于其与中间随机帧的差的 50%;
- 所有视频尾部无爆音(用 ffmpeg astats 检查最后 50 毫秒的峰值不突变)。
```

---

### T10　新模板 rings-escape(P2)

```text
【任务 T10:新增一个对观众更有"赌注感"的模板 rings-escape】

背景:现在 4 个模板都是"看着它自己跑"。rings-escape 自带悬念:小球要从多层旋转圆环的缺口逃出去,观众会猜"能不能逃出"。这是该品类的主流机制,所以必须带一个新规则才有差异化。

允许改动的文件:src/domain/templates.ts(新增 RingsEscapeParamsSchema、模板定义、fixture)、src/domain/videospec.ts(把模板 key 加入允许列表;JSON Schema 同步)、src/domain/simulation.ts(新增该模板的确定性模拟与快照)、src/components/SimulationPlayer.tsx(新增该模板的预览绘制)、workers/render/render_worker.py(新增分支)、src/domain/templates.test.ts 之类的测试(如果不存在就新增 src/domain/rings-escape.test.ts)。

【模板定义】
 - key:rings-escape,version 1.0.0,status beta。
 - 参数:
   rings.count(整数 3–10,默认 6)
   rings.base_radius(0.12–0.25,默认 0.16)
   rings.radius_step(0.03–0.07,默认 0.045)
   rings.gap_deg(缺口角度,18–70,默认 40)
   rings.rotation_deg_per_s(每圈的基础转速,-90–90,默认 24;相邻圈方向交替,速度差 ×1.15 递增)
   balls.count(1–8,默认 1);balls.radius(0.012–0.03);balls.gravity(0–1.0,默认 0.25);balls.restitution(0.8–1.1)
   rule.type:"respawn_ring"(圆环被球穿过缺口后消失,同时在最外层再生成一个新环)| "shrink_gap"(每穿过一环,后面各环缺口缩小 15%)| "ball_split_on_escape"(每逃出一环,球分裂为 2 个)
   note_trigger.on:"ring_pass"(球穿过缺口发声,升调)
 - 事件类型:ring_pass(强度 1.0,触发 pop+粒子+震屏+音高上行)、wall_bounce(强度 0.4)
 - 旋律映射:每次 ring_pass 推进旋律一个音(使用 T8 节奏锁定逻辑不可用时,按旧逻辑推进);碰撞(弹跳)只触发装饰音。
 - 结尾:所有环被逃出后,画面中心出现 reveal 文字,并触发一次最大强度的爆发。
 - 保证"可逃出":模拟中如果球 6 秒内一直没有穿过缺口,则缓慢把当前最内层环的转速降为 0 并把缺口转向球所在方向(这是"温柔的作弊",不要让观众察觉)。

要求:TS 端与 Python 端需要各自实现同一套规则,并使用相同 seed 得到相同事件序列(事件时间误差 ≤ 1 帧)。写一个对比测试:导出 TS 的事件列表与 Python 的事件列表,断言事件数量一致、前 20 个事件的类型一致。

验收:npm test、npm run lint 通过;工作台"模板库"里能看到该模板;渲染 30 秒视频,能看到球一层一层逃出、每一层都有明显的声光反馈。
```

---

### T11　预览与成片对齐(P2)

```text
【任务 T11:让浏览器预览接近成片效果(不追求逐像素一致)】

允许改动的文件:src/components/SimulationPlayer.tsx、src/domain/simulation.ts(如需,为 fx/arc 暴露强度函数)、src/components/StudioView.tsx(提示文案)。

要求:
1. 在 SimulationPlayer 的 drawFrame 里实现简化版的:渐变背景(已有)、球的发光(用 ctx.shadowBlur 与 shadowColor=球色,blur=球半径×2.5)、拖尾(用半透明黑色矩形覆盖上一帧,而不是每帧清屏;透明度=1-trail.fade)、碰撞涟漪与最多 30 个粒子、暗角(径向渐变叠加)、钩子文字的弹出缩放动画(与 T6 的参数一致)。
2. 读取 scene.style.fx.level 与 scene.arc,用与 T5 相同的曲线公式调整球速倍率(只影响显示的粒子/缩放/亮度,不要改动 simulation.ts 里决定 sim_hash 的任何物理量)。
3. 在预览播放器旁边加一行小字:"预览为近似效果,最终画面以渲染出的 MP4 为准。"
4. 如果渲染记录里已有对应 MP4(RenderRecord 存在),在预览区增加一个切换按钮"看成片",用 <video> 标签播放该 MP4 (查看 server.ts 里提供 MP4 的路由名,不要自己发明路径)。

禁止:不要改变 runDeterministicSimulation 的输出(sim_hash 必须保持不变);现有测试 src/domain/simulation.test.ts 必须全部通过。

验收:npm test、npm run lint、npm run build 通过;预览里能看到发光、拖尾、粒子、暗角。
```

---

### T12　SpecGen 提示词与 Schema(P1,让 LLM 产出"有戏"的 JSON)

```text
【任务 T12:升级 AI 生成 Spec 的系统提示词与校验,强制写入"强度下限"和"反转(twist)"】

前提:T3(fx)、T5(arc)、T6(hud/captions_auto)已完成。

允许改动的文件:src/server/store.ts(DEFAULT_AI_CONFIG.prompts.specgen_system、next_episode 两处默认提示词)、src/server/gemini.ts(生成 Spec 的 prompt 与 responseSchema:增加 fx / arc / hud 字段)、src/domain/videospec.ts(新增 concept.twist 字符串可选字段,长度 ≥ 12;新增校验警告码 W106:"未设置 scene.arc"、W107:"fx.level < 2"、W108:"duration 与 arc 不匹配")、src/domain/templates.ts(更新 4 个 fixture,补全 fx / arc / hud)、src/domain/novelty.ts(把 arc.preset 与 fx.level 作为"非结构性差异"忽略,不要因此放过重复的 mechanic+music 组合)、对应测试。

步骤:
1. 把 store.ts 里的 specgen_system 完整替换为下面"新版提示词"(原样复制,不要改写)。
2. gemini.ts 里给模型的 responseSchema 增加 scene.style.fx、scene.arc、scene.hud、concept.twist,并设为必填(fx.level 限定 2 或 3;arc.preset 必填)。
3. 同步 next_episode 的提示词:续集必须"在上一集的基础上把强度升一级",且 twist 必须与上一集不同。
4. 更新测试:src/server/store.test.ts 里对 specgen_system 长度的断言保持有效。

【新版 specgen_system 提示词(原样写入)】

你是一个 YouTube Shorts 频道的创意总监,频道发布"代码渲染的物理 + 旋律模拟"短视频。你的目标不是"生成一个能渲染的 JSON",而是写出"头 2 秒留得住人、中间有升级、结尾有高潮、观众想转发"的视频规格。

频道的真实数据告诉我们:
- 平均只有约 44% 的观众没有在头几秒划走,分享几乎为 0。所以每条视频必须有"强钩子"和"值得转发的瞬间"。
- 继续观看最高的视频具备:明确的数字承诺(例如"10 秒内完成")、逐步升级的结构(同一旋律越来越快)、观众熟悉的旋律。
- 最差的视频是:讲解型、对同一机制换皮重复的。

必须遵守:
1. 严格保留系统指定的 mechanic、arena、rule、music_piece、hook_style、title_pattern、ending,不要更改。
2. concept.twist(必填,≥12 字符):用一句话写出这条视频里"出人意料的那一刻"——例如数量突然暴增、规则突变、静音后爆发、结尾揭晓答案。没有 twist 的方案不允许输出。
3. scene.arc.preset(必填):按钩子类型选择——prediction/mystery → "drop" 或 "tease-then-build";escalation → "ramp" 或 "countdown";contrast → "wave"。climax_at 取 0.8–0.9。
4. scene.style.fx.level 取 2 或 3;旋律型视频建议 3。
5. 强度下限(不要保守):旋转速度的绝对值 ≥ 12°/s;balls.speed ≥ 0.8;分裂/变化规则的 every_n_bounces ≤ 3;摆的数量 ≥ 12;轨道数 ≥ 8。
6. hook_line ≤ 6 个英文单词,必须是"问题"或"具体数字承诺",不要写科普式开场。timeline 里的 hook 必须在 t=0、dur ≤ 2.2。
7. title ≤ 100 字符,不含 #标签,最多 1 个 emoji,不能复用近期标题骨架;标题里要包含一个具体数字或明确的结果承诺。
8. duration:旋律型 24–38 秒;球桶类 ≤ 20 秒;摆/轨道类 30–45 秒。arc 的时间节点必须落在 duration 内。
9. 每 3 条里至少有 1 条使用"熟悉旋律(recognizability ≥ 4)";球桶排序类每周最多 1 条。
10. novelty_notes ≥ 25 字符,必须说明"结构上"和"听感上"与最近视频的具体区别(不是只换颜色)。
11. first_comment ≤ 140 字符,必须是让人想回答的问题(猜歌名/猜球数/猜哪个桶先满)。
12. 不要输出任何解释文字,只输出符合 schema 的 JSON。

验收:
- npm test、npm run lint 通过。
- 在工作台里用 AI 生成 6 个 Spec:每个都有 twist、arc、fx.level≥2,且 hook_line ≤ 6 词、duration 满足上述范围。
- 旧 Spec(无 fx/arc/twist)仍可导入,并只触发警告 W106/W107,而不是错误。
```

---

### T13　奖励函数与实验维度(P2)

```text
【任务 T13:让系统学会"哪种画面方案更有效"】

允许改动的文件:src/domain/videospec.ts(axes 增加可选 arc_preset、fx_level)、src/domain/types.ts、src/domain/analytics.ts(奖励权重)、src/domain/bandit.ts(把 arc_preset 与 fx_level 加入可探索的维度,权重低于 mechanic/music_piece)、src/components/VideosView.tsx(记分牌显示)、对应测试。

要求:
1. 生成/导入 Spec 时,自动把 scene.arc.preset 与 scene.style.fx.level 复制到 axes.arc_preset 与 axes.fx_level。
2. 奖励函数 scoreChannelVideos:把"分享率(每千次观看分享数)"单独拎出来,权重从目前的 0.15(与评论合并)调整为:继续观看 0.35、平均观看百分比 0.15(降低,因为被循环虚高)、订阅率 0.25、分享率 0.15、点赞率 0.10。平均观看百分比一律先 min(…,100) 再计算。
3. bandit 里把 (arc_preset) 与 (fx_level) 作为两个独立的 arm 维度,按 Thompson Sampling 分配下周 60/30/10 比例中的"探索"部分。
4. VideosView 的记分牌表格里新增两列:arc、fx;并增加一个汇总卡片:"各 arc 的平均继续观看率",至少有 3 条样本时才显示数字。

验收:npm test、npm run lint 通过;给旧视频(无这两个字段)显示 "-" 而不是报错。
```

---

### T14　自动"平淡检测"(P2)

```text
【任务 T14:把第 3 章的 10 项检查变成自动 QA】

允许改动的文件:新增 workers/render/qa_stats.py(渲染完成后分析 MP4 与事件,输出 JSON);workers/render/render_worker.py(渲染结束后调用并写 <输出>.qa.json);server.ts(读取 .qa.json 并合并进 RenderRecord.qa_checks);src/domain/types.ts 与 src/domain/simulation.ts 中已有的 QACheckItem 结构复用,不要新建一套。

检查项(每项产生一个 QACheckItem,severity 为 warn 或 error):
 1. first_frame_motion:第 0 与第 0.3 秒两帧的平均像素差 ≥ 阈值,且第 0 帧里有 ≥3 种显著色(error)
 2. first_audio_onset:第一个声音在 0.3 秒内(error)
 3. hook_text_timing:钩子文字在 0.15 秒内出现、且不超过 2.4 秒退场(warn)
 4. juice_density:每个强事件周围 0.3 秒内,帧间像素差高于全片中位数(warn)
 5. intensity_rise:后 30% 的平均帧间像素差 ≥ 前 30% 的 1.2 倍(warn)
 6. rhythm_deviation:旋律型视频的节奏平均偏差 ≤ 25 毫秒(warn)
 7. audio_layers:最终混音在后 30% 的频谱能量(频带数)高于前 30%(warn)
 8. has_twist_moment:全片帧间差序列里存在一个相邻 1 秒窗口的变化量 ≥ 前一窗口 2 倍(warn)
 9. safe_zone:顶部 8%、底部 20% 区域的"文字像素"占比为 0(通过比较 hud/text 层是否绘制到这些区域来判断,不要做 OCR)(warn)
 10. ending_return:循环型视频首尾帧差 ≤ 中间随机帧差的 50%(warn)
把通过项数量 / 10 写成 qa_score;score < 0.8 时,在审核页的 L1/L2 流程里提示"建议重做",但不阻止人工放行。

验收:npm test、npm run lint 通过;对 baseline 里的老视频和新渲染的视频各跑一次,老视频得分明显低于新视频。
```

---

## 7. 内容与运营层建议(不需要写代码)

### 7.1 选题节奏(根据数据)

| 做法 | 理由 |
|---|---|
| 球桶排序系列**每周最多 1 条**,并且必须带"结果承诺"(例如 "Sorted in 10 Seconds" 这种)而不是换皮 | 该系列 9 条占 37% 播放,订阅/点赞效率都低于其余视频 |
| **熟悉旋律型**(Canon / Für Elise / Ode / Mountain King)提升到每周 3–4 条,配合 T8 节奏锁定 | 订阅主要来自这一类 |
| 保留 **升级结构**("同一旋律 5 次,每次更快") | 继续观看 57.4%,点赞 15‰,是少数"有结构"的作品 |
| **长一点的视频**(30–45 秒)只在有高潮设计时做 | 80 秒的 Orbits 点赞率最高,说明留下来的观众很投入 |
| 讲解型排序算法(Quick/Shell/Bubble)**暂停** | 继续观看 24–33%,明显最差 |
| 每条视频开头 2 秒必须有"画面+声音同时发生" | 这是降低 56% 划走率的唯一抓手 |

### 7.2 标题和首评

- 标题里放**一个数字或结果承诺**(例如 "Sorted in 10 Seconds" "5 Times, Each Faster")。
- 首评写成能让人"猜"的问题:猜歌名、猜球数、猜哪个桶先满。猜测类评论最容易带动互动与分享。
- 不要再给同一机制生成 5 个只差一个 emoji 的标题。

### 7.3 频道卫生(你自己决定)

- 十几条 2018–2019 的无关中文视频与工程课程视频,建议设为不公开/私享,避免推荐系统给频道打上混乱的主题标签。

---

## 8. 验证与实验设计

### 8.1 改完后怎么验证"不再平淡"

| 阶段 | 做法 | 通过标准 |
|---|---|---|
| 本地 | 用 T0 的 bench 脚本对比 baseline 与新版 4 个 fixture | 肉眼可见:清晰度、发光、粒子、强度变化;耗时 ≤ 120 秒/30 秒视频 |
| 自检 | T14 的 qa_score | 新视频 ≥ 0.8,老视频明显更低 |
| 线上(小样本) | 发布 6 条新版视频(不同旋律、不同 arc,每条都是全新内容,不要重复上传同一视频) | 48 小时后,每条 ≥ 800 次观看再评估 |

### 8.2 线上指标目标(与当前对照)

| 指标 | 当前 | 第一阶段目标 | 理想 |
|---|---|---|---|
| 继续观看率 | 43.9% | **≥ 55%** | ≥ 65% |
| 点赞率(每千次观看) | 7 | ≥ 12 | ≥ 20 |
| 分享(每千次观看) | 0.5 | ≥ 2 | ≥ 5 |
| 订阅(每千次观看) | 0.65 | ≥ 1.5 | ≥ 3 |
| 单条观看 | 850–1,900 | 至少有 1 条 > 5,000 | 稳定 > 5,000 |

### 8.3 A/B 对比的做法

一次只改一类因素,否则分不清是谁起作用:

1. **第 1 周**:只上线 T1–T4(画面升级),旋律/音频不变。看继续观看率变化。
2. **第 2 周**:再加 T7–T8(声音与节奏)。看点赞与订阅变化。
3. **第 3 周**:再加 T5、T9、T12(arc、冷开场、twist)。看分享与单条上限。
4. 每个阶段至少发 6 条,按"继续观看率中位数"比较,而不是看单条。

---

## 9. 风险与注意事项

| 风险 | 对策 |
|---|---|
| 小模型一次改太多导致崩 | 严格一次一个任务、一个 commit;失败就回滚到上一个 commit |
| 画面升级后渲染变慢,触发 60 秒超时 | T2 里已要求把超时改为 240 秒;GitHub Actions 的 25 分钟总限制要对应评估批量大小 |
| 确定性被破坏(同一 Spec 两次渲染不一致) | 每个任务都要求"渲染两次逐帧 md5 一致";随机只用 seed 派生 |
| 新增 Spec 字段被 zod 丢弃 | 所有新增字段必须同步改 `videospec.ts` 的 zod 与手写 JSON Schema(前面任务里已反复强调) |
| 特效过强导致画面过曝或晃眼 | T4 有"亮度 >240 像素占比 ≤ 6%"的检查;震屏只在强事件触发,幅度 ≤ 0.6% 画面宽 |
| 重复内容风险 | 即便画面更好,也不要重复发布相同旋律+相同机制+相同 arc 的组合;T12 的提示词和 novelty 规则里保留结构差异要求 |
| 版权 | 旋律继续只使用公有领域或自创(`license` 字段已有);不要引入外部采样 |

---

## 附录 A:参数速查

**FX 等级预设**

| level | flash | ripple | particles | shake | pop | vignette |
|---|---|---|---|---|---|---|
| 0(关) | 0 | 0 | 0 | 0 | 0 | 0 |
| 1(轻) | 0.4 | 0.5 | 0.4 | 0 | 0.5 | 0.3 |
| 2(标准,默认) | 0.7 | 0.8 | 0.7 | 0.5 | 0.8 | 0.5 |
| 3(强) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.7 |

**Arc 预设与适用场景**

| preset | 形态 | 适合 |
|---|---|---|
| ramp | 缓慢爬升到高潮 | escalation 钩子、旋律越来越快 |
| tease-then-build | 先预告→回落→再爬升 | mystery / prediction 钩子 |
| wave | 三次起伏,最后一次最高 | contrast 钩子、长视频 |
| countdown | 5 段阶梯,每段有节拍点 | "10 秒内完成"类承诺 |
| drop | 稀疏→静默蓄力→爆发 | 熟悉旋律的"高潮炸裂"版 |

**声部层次(随强度 I 加入)**

| I 阈值 | 加入的声部 |
|---|---|
| 始终 | 主旋律 |
| ≥ 0.35 | 低音 |
| ≥ 0.60 | 节奏(hi-hat 式嗒声 + 柔和底鼓) |
| ≥ 0.85 | 高八度增厚 |

**安全区**

| 区域 | 比例 | 规则 |
|---|---|---|
| 顶部 | 0–10% | 不放文字 |
| 底部 | 80–100% | 不放文字(Shorts 标题与账号信息所在) |
| 右侧 | 88–100% 宽度 | 不放关键信息(点赞/评论图标所在) |

## 附录 B:一个最小可行的执行顺序(如果你只想做 4 件事)

1. **T1**(让 JSON 生效)
2. **T2 + T3**(清晰度 + 打击感)——观感提升最明显
3. **T7 + T8**(声音层次 + 节奏对齐)——订阅转化提升最明显
4. **T12**(提示词升级)——让后续批量生成的 Spec 都"有戏"

这 4 项做完,"平淡"问题基本解决;T5、T9 能把"不错"推到"想转发"。
