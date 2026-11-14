# 07 导入 JSON 模板与「让 AI 生成 JSON」的提示词

> 这是**唯一的内容入口契约**（D6）。AI、人工、趋势机器人产出的内容都必须落成下面的 JSON。
> 开发要求：用 zod 实现，并同时导出 JSON Schema（给 AI 做结构化输出约束）；每个模板另有自己的 `paramsSchema`。
> 版本规则：`schema` 字段形如 `videospec/1`；不兼容修改时升主版本，导入器要能读旧版本并自动升级。

## 1. 文档类型总览

| `schema` | 用途 | 谁产出 |
|---|---|---|
| `videospec/1` | 单条视频的完整可渲染规格 | AI / 人 |
| `specbatch/1` | 一批 VideoSpec（导入的常规载体） | AI / 人 |
| `ideabatch/1` | 只有创意、没有渲染细节（便宜的第一步；可再「展开」成 Spec） | AI / 人 / 趋势机器人 |
| `melody/1` | 旋律库条目（公版导入或原创生成） | 导入脚本 / AI（仅限原创） |
| `trendimport/1` | 手动导入的趋势榜单（TikTok/IG/其他） | 人 / 抓取工具 |
| `referencechannels/1` | 参考频道清单 | 人 / AI |

## 2. VideoSpec v1 字段说明

坐标/尺寸一律使用**归一化单位**（画面宽度 = 1.0），时间单位秒，颜色 `#RRGGBB`。时间为负数表示「从视频末尾倒数」。

| 路径 | 类型 | 必填 | 约束/说明 |
|---|---|---|---|
| `schema` | string | ✔ | 固定 `"videospec/1"` |
| `spec_key` | string | ✔ | 导入方给的幂等键，同频道内唯一，`[a-z0-9-]{6,80}` |
| `channel_slug` | string | ✔ | 目标频道；导入时可被覆盖 |
| `concept.working_title` | string | ✔ | 内部工作标题 |
| `concept.hook_line` | string | ✔ | 钩子文案，≤ 6 个词 |
| `concept.hook_style` | enum | ✔ | `prediction/escalation/mystery/countdown/contrast` |
| `concept.payoff` | string | ✔ | 看完得到什么（一句话） |
| `concept.emotion` | enum | ✔ | `satisfying/curious/tense/funny/awe` |
| `concept.series` | object\|null |  | `{slug, episode(int≥1), title}` |
| `concept.novelty_notes` | string | ✔ | 与最近同机制视频的**实质差异**（≥ 20 字符；系列内必填且需具体） |
| `format.aspect` | enum | ✔ | `9:16`（默认）/`1:1` |
| `format.width,height,fps` | int | ✔ | 默认 1080×1920 @ 30 |
| `format.duration_sec` | number | ✔ | 8–180；推荐 15–60 |
| `format.loop.enabled` | bool | ✔ |  |
| `format.loop.mode` | enum | 条件 | `visual-return/audio-return/none` |
| `scene.template` | string | ✔ | 模板 key，必须已注册 |
| `scene.template_version` | string | ✔ | semver 范围，如 `^1.0` |
| `scene.seed` | int | ✔ | 非负整数；同 Spec 同 seed 必须逐帧一致 |
| `scene.style.palette` | object | ✔ | `{family: "neon\|pastel\|mono\|warm\|cool", colors: ["#..",...]}` |
| `scene.style.background` | object |  | `{type:"solid\|gradient\|grid", colors:[..]}` |
| `scene.style.trail` | object |  | `{enabled, length_frames, fade}` |
| `scene.style.camera` | object |  | `{zoom_from, zoom_to, shake}` |
| `scene.params` | object | ✔ | **模板专属**，由模板 `paramsSchema` 校验 |
| `timeline[]` | array | ✔ | 见 §3 |
| `audio.mode` | enum | ✔ | `sim-driven`（模拟事件触发，默认）/`track`（一条预制音轨）/`none` |
| `audio.music` | object | 条件 | `sim-driven`/`track` 时必填，见 §4 |
| `audio.sfx[]` | array |  | `{event, sound, gain_db}` |
| `audio.mix` | object | ✔ | `{target_lufs:-14, true_peak_db:-1}` |
| `publish.title` | string | ✔ | ≤ 100 字符 |
| `publish.description` | string | ✔ | ≤ 5000 字节 |
| `publish.tags[]` | string[] |  | 合计 ≤ 500 字符 |
| `publish.category_id` | string |  | 默认取频道档案 |
| `publish.made_for_kids` | bool | ✔ | 默认 false |
| `publish.contains_synthetic_media` | bool | ✔ | 默认 false |
| `publish.default_language` | string | ✔ | `en` |
| `publish.first_comment` | string |  | 提问式首评，≤ 200 字符 |
| `publish.schedule` | object |  | `{mode:"auto"\|"fixed", at?: ISO8601, window_local?: ["17:00","22:00"]}` |
| `axes.mechanic` | string | ✔ | 与 `02` 一致 |
| `axes.arena` | string | ✔ |  |
| `axes.rule` | string | ✔ |  |
| `axes.music_piece` | string | ✔ | `pd:<id>` / `gen:<kind>-<seed>` / `none` |
| `axes.hook_style` | string | ✔ | 与 `concept.hook_style` 相同 |
| `axes.title_pattern` | enum | ✔ | `question/number-contrast/challenge/statement/ellipsis` |
| `axes.ending` | enum | ✔ | `loop/reveal/cut` |
| `axes.palette_family`,`axes.instrument` | string |  | 弱轴 |
| `provenance.generator` | object | ✔ | `{kind:"llm\|human\|bot", model?, prompt_version?}` |
| `provenance.trend_refs[]` | array |  | `{source, ref, note}` |
| `provenance.created_at` | ISO8601 | ✔ |  |

**`spec_hash`**：对「规范化后的（键排序）`channel_slug + scene + timeline + audio + publish.title`」取 SHA-256；`provenance` 与 `spec_key` 不参与。同频道内 `spec_hash` 相同视为重复，拒绝导入。

## 3. `timeline[]` 项

```json
{ "t": 0.0, "dur": 1.6, "type": "text", "role": "hook", "text": "Can you name this song?", "position": "top-safe", "style": "bold-white-shadow" }
{ "t": 12.0, "type": "event", "name": "split_rate_increase", "args": { "every_n_bounces": 1 } }
{ "t": -2.0, "dur": 2.0, "type": "text", "role": "end_card", "text": "Part 3 • Follow for Part 4", "position": "bottom-safe" }
```
- `type`: `text | event | sfx`；`event.name` 必须在模板声明的事件列表内；
- `position`：`top-safe | center | bottom-safe`（均位于 Shorts UI 安全区内）；
- 文本检查：`role:"hook"` 必须存在且 `t ≤ 0.3`。

## 4. `audio.music`

```json
{
  "melody_ref": { "source": "library", "id": "pd:canon-in-d" },
  "transpose": 0,
  "tempo_bpm": 96,
  "instrument": "marimba",
  "note_mapping": "per_collision",
  "wrap": "loop",
  "reverb": 0.12
}
```
- `melody_ref.source`：`library`（引用旋律库 id）或 `inline`（内嵌一个 `melody/1`，用于 AI 生成的原创旋律）；
- 引用的旋律必须 `license ∈ {public-domain, cc0, original}`，否则导入报错；
- `note_mapping`：`per_collision`（每次碰撞下一个音）/`per_beat`（按节拍）/`per_event`（按模板事件）。

## 5. 完整示例 A：`melody-bounce`

```json
{
  "schema": "videospec/1",
  "spec_key": "mb-canon-hexagon-split-0001",
  "channel_slug": "physics-music",
  "concept": {
    "working_title": "Canon in D by splitting balls in a hexagon",
    "hook_line": "Can you name this song?",
    "hook_style": "mystery",
    "payoff": "One ball becomes 64 and the melody becomes unmistakable, then it collapses back to one.",
    "emotion": "satisfying",
    "series": { "slug": "name-that-tune", "episode": 1, "title": "Name That Tune" },
    "novelty_notes": "First episode of the series: hexagon arena with split-on-bounce; previous melody videos used a circle arena with growth rule."
  },
  "format": { "aspect": "9:16", "width": 1080, "height": 1920, "fps": 30, "duration_sec": 28,
              "loop": { "enabled": true, "mode": "audio-return" } },
  "scene": {
    "template": "melody-bounce",
    "template_version": "^1.0",
    "seed": 884102,
    "style": {
      "palette": { "family": "neon", "colors": ["#00F5D4", "#F15BB5", "#FEE440", "#9B5DE5"] },
      "background": { "type": "gradient", "colors": ["#05060F", "#101437"] },
      "trail": { "enabled": true, "length_frames": 18, "fade": 0.85 },
      "camera": { "zoom_from": 1.0, "zoom_to": 1.15, "shake": 0.0 }
    },
    "params": {
      "arena": { "shape": "hexagon", "size": 0.78, "wall_thickness": 0.012, "rotation_deg_per_s": 6 },
      "balls": { "count_start": 1, "radius": 0.028, "speed": 0.55, "restitution": 1.0, "gravity": 0.0, "max_count": 64 },
      "rule": { "type": "split_on_bounce", "every_n_bounces": 3, "inherit_color": false },
      "note_trigger": { "on": "ball_wall_collision", "velocity_from": "impact" }
    }
  },
  "timeline": [
    { "t": 0.0, "dur": 1.6, "type": "text", "role": "hook", "text": "Can you name this song?", "position": "top-safe", "style": "bold-white-shadow" },
    { "t": -2.0, "dur": 2.0, "type": "text", "role": "end_card", "text": "Name That Tune • Part 1", "position": "bottom-safe", "style": "small-white" }
  ],
  "audio": {
    "mode": "sim-driven",
    "music": {
      "melody_ref": { "source": "library", "id": "pd:canon-in-d" },
      "transpose": 0, "tempo_bpm": 96, "instrument": "marimba",
      "note_mapping": "per_collision", "wrap": "loop", "reverb": 0.12
    },
    "sfx": [ { "event": "ball_split", "sound": "soft-pop", "gain_db": -14 } ],
    "mix": { "target_lufs": -14, "true_peak_db": -1 }
  },
  "publish": {
    "title": "Can You Name This Song? 64 Balls Play It 🎵",
    "description": "Every bounce plays the next note. One ball becomes 64.\n\nName That Tune • Part 1\n#Shorts #satisfying #physics #music",
    "tags": ["satisfying", "physics simulation", "bouncing ball music", "name that tune"],
    "category_id": "24",
    "made_for_kids": false,
    "contains_synthetic_media": false,
    "default_language": "en",
    "first_comment": "Did you guess it before the 10th note? 👇",
    "schedule": { "mode": "auto", "window_local": ["17:00", "22:00"] }
  },
  "axes": {
    "mechanic": "melody-bounce", "arena": "hexagon", "rule": "split-on-bounce",
    "music_piece": "pd:canon-in-d", "hook_style": "mystery",
    "title_pattern": "question", "ending": "loop",
    "palette_family": "neon", "instrument": "marimba"
  },
  "provenance": {
    "generator": { "kind": "llm", "model": "example-model", "prompt_version": "specgen-v1" },
    "trend_refs": [ { "source": "reference_video", "ref": "yt:JTrpkr4ZGCo", "note": "own best performer: Canon in D xylophone" } ],
    "created_at": "2026-11-15T08:00:00Z"
  }
}
```

## 6. 完整示例 B：`ball-sort`（只展示与 A 不同的部分，其他字段同上）

```json
{
  "scene": {
    "template": "ball-sort",
    "template_version": "^1.0",
    "seed": 120455,
    "params": {
      "balls": { "count": 24, "colors": ["#FF595E", "#FFCA3A", "#8AC926", "#1982C4"] },
      "bins": { "count": 4, "layout": "under-funnel" },
      "mechanism": {
        "pegs": { "rows": 7, "jitter": 0.25 },
        "gates": [ { "type": "moving", "period_s": 2.4 }, { "type": "color-filter", "color_index": 2 } ],
        "spiral": { "enabled": false }
      },
      "goal": { "type": "sorted_by_color", "celebrate": "confetti-light" }
    }
  },
  "axes": { "mechanic": "ball-sort", "arena": "funnel", "rule": "color-filter-gate", "music_piece": "gen:pentatonic-5521", "hook_style": "prediction", "title_pattern": "challenge", "ending": "reveal" }
}
```
**其他模板的 `params` 由模板代码声明**；模板注册表对外提供 `GET /api/templates` 返回每个模板的 `paramsSchema + examples`，供 UI 校验与 AI 提示词使用。

## 7. 其他 JSON

### 7.1 `specbatch/1`
```json
{ "schema": "specbatch/1", "batch_id": "2026-11-15-physics-music-a", "generated_at": "2026-11-15T08:00:00Z",
  "items": [ { "schema": "videospec/1", "...": "..." } ] }
```
导入规则：逐条校验；成功的入库，失败的返回 `{index, spec_key, errors[], warnings[]}`；整批最多 50 条；批内重复 `spec_hash` 只保留第一条。

### 7.2 `ideabatch/1`（先出创意，选中再展开成 Spec，省钱）
```json
{ "schema": "ideabatch/1", "batch_id": "ideas-2026-11-15", "items": [
  { "idea_key": "idea-hexagon-canon-0001", "channel_slug": "physics-music",
    "mechanic": "melody-bounce", "arena": "hexagon", "rule": "split-on-bounce",
    "music_piece": "pd:canon-in-d", "hook_style": "mystery", "hook_line": "Can you name this song?",
    "title_candidates": ["Can You Name This Song? 64 Balls Play It 🎵", "64 Balls. One Famous Melody."],
    "payoff": "One ball becomes 64 and the melody becomes unmistakable.",
    "series": { "slug": "name-that-tune", "episode": 1 },
    "novelty_notes": "New arena + new rule vs last 10 melody videos.",
    "source": { "kind": "trend", "ref": "reference_video:JTrpkr4ZGCo" } } ] }
```

### 7.3 `melody/1`
```json
{ "schema": "melody/1", "id": "pd:canon-in-d", "title": "Canon in D (main theme)", "composer": "Johann Pachelbel",
  "death_year": 1706, "source_url": "https://example.org/mutopia/canon", "license": "public-domain",
  "key": "D major", "tempo_bpm": 96, "time_signature": "4/4", "recognizability": 5,
  "tags": ["baroque", "wedding", "slow-build"],
  "tracks": [ { "name": "lead", "notes": [ { "beat": 0, "pitch": 78, "dur": 1, "vel": 90 }, { "beat": 1, "pitch": 76, "dur": 1, "vel": 85 } ] } ],
  "loopable": true }
```
校验：`pitch` 0–127；`dur>0`；`beat` 单调不减；总时长 4–120 拍；`license ∈ {public-domain, cc0, original}`；`public-domain` 必须带 `composer`、`death_year ≤ 1950`（传统民歌 `composer:"traditional"`）、`source_url`。

### 7.4 `trendimport/1`
```json
{ "schema": "trendimport/1", "source": "tiktok_creative_center", "captured_at": "2026-11-15T00:00:00Z", "region": "US",
  "items": [ { "type": "hashtag", "name": "satisfying", "rank": 4, "metric": { "views": 312182870, "growth_pct": 12 }, "url": null, "note": "" },
             { "type": "sound", "name": "Some Trending Song", "rank": 2, "reference_only": true, "note": "do not use; copyrighted" } ] }
```
`type`: `hashtag | sound | video | topic | search`。`sound` 一律 `reference_only: true`。

### 7.5 `referencechannels/1`
```json
{ "schema": "referencechannels/1", "items": [
  { "name": "satisfying.ba11s", "handle": null, "yt_channel_id": null, "tags": ["ball-escape", "viral-origin"], "note": "需解析" },
  { "name": "CodeCraftedPhysics", "handle": null, "yt_channel_id": null, "tags": ["ring-escape"] },
  { "name": "Jack's Physics", "handle": null, "yt_channel_id": null, "tags": ["escalation"] },
  { "name": "FuncFlow", "handle": null, "yt_channel_id": null, "tags": [] },
  { "name": "The Peaceful Physics", "handle": null, "yt_channel_id": null, "tags": ["daily", "guess-game"] },
  { "name": "JollyMathFist", "handle": null, "yt_channel_id": null, "tags": ["neon-trails", "billiards"] },
  { "name": "Satisfying Physics Simulation", "handle": null, "yt_channel_id": "UCotJqOQEwG9OgDL2coBl9UA", "tags": ["python-sim", "synth-from-sim"] } ] }
```
`handle` 与 `yt_channel_id` 为 null 的条目，首次由系统用一次 `search.list`（100 单位）解析，**人工确认后**写回。

## 8. 校验错误码（导入器必须返回结构化错误）

| 码 | 级别 | 含义 |
|---|---|---|
| E001 | error | JSON 结构不符合 schema |
| E002 | error | `schema` 版本不支持 |
| E010 | error | 模板不存在或版本不满足 |
| E011 | error | `scene.params` 不符合模板 `paramsSchema` |
| E020 | error | 时长/分辨率/帧率超出范围 |
| E030 | error | 旋律引用不存在 |
| E031 | error | 旋律缺少授权信息或授权不在允许集合 |
| E040 | error | 标题/描述/标签超长 |
| E041 | error | `spec_hash` 重复（频道内） |
| E042 | error | `spec_key` 重复 |
| E050 | error | `channel_slug` 不存在 |
| W101 | warn | 预估差异度偏低（预检） |
| W102 | warn | 钩子文案超过 6 个词 |
| W103 | warn | 缺少 `hook` 文本或 `t > 0.3` |
| W104 | warn | 非循环但结尾无 end_card |
| W105 | warn | 系列内 `novelty_notes` 过于笼统 |

## 9. 让 AI 生成 specbatch 的提示词（T1 模型）

> 用法：控制面把 `{{...}}` 替换成真实数据后调用。组合（`{{combos}}`）由**代码**先抽样并通过差异度守卫，AI 只负责写创意细节。要求使用结构化输出（JSON schema）并在服务端再次校验。

```text
SYSTEM
You are a creative producer for a YouTube Shorts channel that publishes original, code-rendered physics/music simulations.
You never output prose. You output exactly one JSON object of type "specbatch/1" that validates against the provided JSON Schema.
You write the creative details (titles, hook lines, first comments, series naming, template params) for each assigned combination.

CHANNEL PROFILE
{{channel_profile}}   // niche, language, tone rules, forbidden topics, brand, palette families

TEMPLATE CATALOG (use ONLY these templates; params must satisfy each paramsSchema)
{{template_catalog}}  // key, version, paramsSchema, allowed axes values, events, examples

MELODY LIBRARY (use ONLY ids listed here; never invent a melody id; never write notes of a famous melody from memory)
{{melody_list}}       // id, title, recognizability, last_used_at

ASSIGNED COMBINATIONS (one video per combination; do not change the structural axes)
{{combos}}            // each: mechanic, arena, rule, music_piece, hook_style, ending, series?

RECENT HISTORY (last 30 days; avoid these titles, title skeletons and hook lines)
{{recent_history}}

BANNED
{{banned_titles_and_skeletons}}

OPTIONAL TREND/REFERENCE INSIGHTS (inspiration only; never copy titles or visuals)
{{trend_signals}}

RULES
1. One item per assigned combination. Keep the combination's axes exactly; fill `axes` accordingly.
2. `concept.hook_line`: max 6 words, speaks to the first 1.5 seconds. Match `hook_style`.
3. `publish.title`: max 100 chars, specific and curious, no clickbait lies, at most one emoji, no hashtags in the title.
   Titles in one batch must use different openings; do not reuse any banned skeleton (e.g. "16 Balls, 4 Bins ...").
4. `concept.novelty_notes`: state concretely what differs from the most similar recent video (arena, rule, melody, structure). Min 20 chars. "Different colors" is NOT a difference.
5. `scene.params`: choose values inside the schema; vary scale, count and speed meaningfully between items (not by tiny amounts).
6. `scene.seed`: random integer, unique per item.
7. `format.duration_sec`: 15–35 for most; at most 1 in 5 may be 45–80.
8. `format.loop.enabled` true unless the idea needs a reveal ending; then add an end_card.
9. `timeline` must include a hook text at t<=0.3 with role "hook" and text equal to `hook_line`.
10. `publish.first_comment`: a short question that invites a guess or opinion. No links, no "subscribe", no begging.
11. `publish.description`: first line restates the hook; include series name and episode if any; end with "#Shorts" and 2-3 relevant hashtags.
12. `made_for_kids=false`, `contains_synthetic_media=false` unless told otherwise.
13. `provenance.generator.kind="llm"`; fill model and prompt_version from the context; `created_at` = now (UTC).
14. Never mention real artists, brands or copyrighted songs by a recording name; only the library `title` is allowed.
15. Output valid JSON only. No comments, no trailing commas.

USER
Produce a specbatch/1 with {{n}} items for channel "{{channel_slug}}". batch_id = "{{batch_id}}". Now = {{now_utc}}.
```

### 9.1 「做下一集」提示词（爆款复用）
```text
You receive one high-performing VideoSpec (A) and its metrics. Produce 3 NEW VideoSpecs for the next episodes of the same series.
Keep what the audience liked: {{liked_elements}} (e.g. recognizable melody + escalating speed).
Change at least two of: arena, rule, music_piece, ending. Never reuse A's title skeleton or A's music_piece within 14 days.
Each item must include concrete novelty_notes versus A. Output specbatch/1 only.
```

### 9.2 评论回复草稿提示词（P1）
```text
Channel tone: {{tone_rules}}. Forbidden: {{forbidden}}.
Write a reply (max 200 chars, 1 emoji max) to this comment on the video "{{video_title}}": "{{comment}}".
If it is a question about the melody/physics, answer concretely. If spam or abuse, output {"action":"hide"}.
Output JSON: {"action":"reply|hide|ignore","text":"..."}.
```

## 10. 给开发 AI 的实现要点
1. 先实现 zod schema + JSON Schema 导出 + 导入 API（`POST /api/import`，带 `dry_run=true` 支持）+ 导入页（预览/错误清单）；
2. 模板注册表读取模板包里的 `paramsSchema`；Spec 校验分两层（通用 + 模板）；
3. 导入是幂等的：重复导入同一批不产生重复；
4. 把 §5 的示例作为 fixture 放进测试，并提供 `npm run fixtures:import`；
5. 输出的错误必须带 JSON 路径（如 `scene.params.balls.count`），方便把错误回喂给 AI 重试。
