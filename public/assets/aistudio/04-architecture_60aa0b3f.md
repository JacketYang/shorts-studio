# 04 技术架构与基础设施

## 1. 总体架构

```
                        ┌───────────────────────────────────────────┐
                        │  控制面 Control Plane（Next.js + Drizzle）  │
 浏览器/手机 ─────────▶ │  UI · API Routes · 状态机 · 规划器 · 守卫     │
                        └──────┬───────────────┬────────────────────┘
                               │               │
                 Postgres(Neon/Supabase)   Cloudflare R2（对象存储）
                               │               ▲
   Cloudflare Worker Cron ─────┘               │ 预签名上传/下载
   （每分钟 POST /api/cron/tick）              │
                               ▼               │
                  ┌─────────────────────────────┴──┐
                  │ 渲染 Worker（无状态、CPU）        │
                  │ GitHub Actions（MVP）/ Oracle VM │
                  │ / 自己电脑 / Cloud Run Jobs      │
                  │ 输入 Spec → 输出 mp4+帧+指纹      │
                  └────────────────────────────────┘
        外部：YouTube Data/Analytics API · LLM API · 趋势数据源
```

### 1.1 三个硬边界
1. **控制面不渲染视频**（Next.js 进程里不做 CPU 重活）。
2. **Worker 无状态、不连数据库**：只通过「领取任务 API + 对象存储 + 回调 API」与控制面交互。
3. **所有长耗时动作都是任务（job）**，任务存在数据库，由 tick 驱动，状态机推进。

## 2. 免费/低成本资源选型

> 额度会变，下表为 2026 年资料，开工前以官网为准。

| 需求 | 推荐 | 免费额度（资料） | 备注 |
|---|---|---|---|
| 数据库 | **Neon 或 Supabase 免费 Postgres** | 约 0.5GB（Neon）/ 500MB（Supabase） | 保持 Drizzle + pg；指标快照量小，够用很久 |
| 对象存储 | **Cloudflare R2** | 10GB、A 类 100 万次/月、B 类 1000 万次/月、**出口流量免费** | S3 兼容；Spec/封面帧长期留存，mp4 发布后 14 天清理 |
| 定时器 | **Cloudflare Worker Cron Trigger** | Workers 免费层 10 万请求/天 | 每分钟调用控制面 `/api/cron/tick`（带密钥） |
| 控制面托管 | 方案 1：任意能跑 Node 的地方（Oracle 免费 VM / Railway / Fly / 自己的机器）；方案 2：Vercel（个人非商用）| — | **注意 Vercel Hobby 禁止商用**；Cloudflare 上跑 Next+pg 需 OpenNext+Hyperdrive，复杂度高，MVP 不选 |
| 渲染 | **GitHub Actions**（MVP） | 私有仓库 2,000 分钟/月（Linux），公共仓库不限 | 渲染代码/模板是核心竞争力，建议用**私有仓库**；见 §3 的预算 |
| 24h 常驻 VM | Oracle Cloud Always Free（Arm） | 资料不一致：2 OCPU/12GB 或 4 OCPU/24GB | 注册需信用卡；适合做 Worker 或托管控制面；以官网为准 |
| 备用渲染 | 自己电脑当 Worker（拉取模式）；Google Cloud Run Jobs（有免费额度，需绑卡）| — | 同一个 Worker 协议 |
| LLM | OpenAI 兼容协议，可切换厂商 | Gemini 有免费层；DeepSeek/Gemini Flash-Lite 约 $0.1–0.3/百万输入 token | 见 `05` 的成本模型 |

关于你说的「instabox」：我没能确认是哪个服务。判断标准很简单——**只要它能跑 Docker/ffmpeg 的 CPU 任务、能出站访问 HTTPS 就能做 Worker**；如果它休眠、有执行时长限制，只要单条渲染能在限制内完成也没问题。

### 2.1 为什么不用 Cloudflare D1
D1 是 SQLite，需要把现有 Postgres 的 Drizzle 配置整套换成 sqlite 方言，且 Worker 上的 CPU 时间限制（免费 10ms）不适合承载规划器/守卫的计算。**数据库用 Postgres，Cloudflare 只负责 R2 与 Cron。**

## 3. 无 GPU 渲染方案

**结论：物理模拟/算法可视化类视频不需要 GPU。** 帧是 2D 矢量/位图绘制 + 刚体模拟，CPU 完全够。

### 3.1 推荐渲染栈（让开发 AI 对齐你现有渲染器后确定；以下为默认）
- 语言：**Python 3.11**（pymunk 刚体物理 / numpy）+ **skia-python 或 pycairo** 绘制 → 通过管道把原始帧喂给 **ffmpeg（libx264, `-preset veryfast`, `yuv420p`）**；
- 音频：**事件驱动合成**——模拟产生「碰撞事件 + 时间戳 + 力度」，音频引擎用 numpy 合成（或 FluidSynth + CC0 SoundFont），保证音画严格同步；
- 为什么不用浏览器录屏（Puppeteer/Remotion）：Chromium 录屏在 CPU 上慢且帧不稳定；Remotion 商用有授权限制，且逐帧截图在无 GPU 机器上更慢；
- 如果你现有渲染器是 Node/Canvas 也行，**但必须满足 Worker 协议（§3.3）和确定性要求**。

### 3.2 性能与预算估算（需实测校准）
- 1080×1920 @30fps × 30s = 900 帧；skia/cairo 光栅 + 物理 通常 20–60 帧/秒 → 约 15–45 秒；ffmpeg 编码 10–20 秒；加上依赖安装/拉取镜像 1–2 分钟 → **单条约 2–4 分钟 Actions 时间**；
- 私有仓库 2,000 分钟/月 ≈ 500–1,000 条/月（含少量重试）；当前 3 个频道 × 每天 3 条 = 270 条/月，**够用**；
- 优化：预构建容器镜像（GHCR）避免每次安装依赖；把多条渲染合并到一次 workflow 运行（批量，摊销启动成本）。

### 3.3 Worker 协议（所有运行环境统一）
```
1. 触发：控制面调用 GitHub workflow_dispatch（带 job_id 批次）/ 或 Worker 轮询 POST /api/worker/claim
2. Worker 用 WORKER_TOKEN 调用 POST /api/worker/claim → 返回 {job_id, spec, template_version, upload_urls(预签名PUT)}
3. Worker 渲染（确定性）→ 产出：video.mp4、frames/f0..f7.jpg、audio.wav(可选)、events.json(碰撞/音符事件)、fingerprint.json(pHash/旋律序列/文件SHA)、render.log
4. Worker 用预签名 URL 上传到 R2
5. Worker 调用 POST /api/worker/complete（HMAC 签名，含各文件 key、耗时、模板版本、错误）
6. 失败：POST /api/worker/fail {reason_code, log_tail}；控制面决定是否重试
```
- 模板代码版本化（`template@semver`），Spec 里指定版本，保证可复现；
- Worker 镜像里的模板版本与控制面「模板注册表」必须一致，不一致则 `fail(reason=template_version_mismatch)`；
- 一个 Worker 可同时领多条（并发由控制面限制）；
- **模板版本不可变（immutable）**：已发布的 semver 版本永不修改、永不删除，旧版本保留在镜像/注册表里；否则 R2 清理成片后无法确定性重渲。

## 4. 控制面内部分层（建议目录）

```
src/
  app/                  页面 + API routes（薄）
  server/
    domain/             状态机、规则、守卫（纯函数，可单元测试）
      novelty/          差异度守卫（02）
      planner/          排期规划器
      review/           审核与信任等级
      quota/            配额台账
    services/           youtube/ r2/ llm/ render/ trends/ 适配器（可替换）
    jobs/               tick 调度器、各类 job handler
    schemas/            zod：VideoSpec 等（与 07 一致）
  db/                   schema.ts + migrations
  lib/
workers/render/         渲染 Worker（独立可部署；含模板代码与 Dockerfile）
docs/
```

**要求**：domain 层不依赖 Next/DB 具体实现，便于测试；每个外部服务一个接口 + 一个真实实现 + 一个 Mock 实现（开发/CI 用）。

## 5. 任务系统（jobs）

- 表 `jobs(id, channel_id, type, payload, status, run_at, attempts, max_attempts, locked_by, locked_until, idempotency_key, result, error_code, created_at, updated_at)`；
- 类型：`generate_specs` `render` `qa` `novelty` `schedule` `upload` `set_publish` `sync_videos` `snapshot_metrics` `sync_comments` `ingest_trends` `cleanup` `ai_review`；
- tick：每分钟 `SELECT ... FOR UPDATE SKIP LOCKED` 领到期任务，设置 `locked_until`，处理，写结果；
- 重试：指数退避；不可重试错误（配额超限、凭据失效、校验失败）直接 `failed` 并产生告警；
- **并发安全**：同一 `idempotency_key` 只能存在一个活跃任务（例如 `upload:{video_id}`）。

## 6. 数据模型（概要，开发 AI 细化为 Drizzle schema）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | id, email, password_hash | 单用户起步 |
| `channels` | id, user_id, slug(唯一，供 VideoSpec 的 channel_slug 引用), yt_channel_id, title, status, oauth_refresh_token_enc, token_scopes, gcp_project_ref, quota_bucket | 凭据加密 |
| `channel_profiles` | channel_id, locale, niche, brand(json), allowed_templates, review_mode, trust_level, daily_cap, tz, posting_windows, novelty_overrides, ai_budget_monthly | 档案 |
| `templates` | id, key, version, params_schema(json), axes(json), status | 模板注册表 |
| `melodies` | id, channel_id?, key, title, composer, source, license, events(json), last_used_at | 旋律库 |
| `ideas` | id, channel_id, source, concept(json), status | 创意（ideabatch） |
| `specs` | id, channel_id, spec(json), spec_hash, schema_version, status, series_id, episode | VideoSpec |
| `renders` | id, spec_id, template_version, status, worker, started_at, ended_at, files(json), fingerprint(json), error | 渲染产物 |
| `qa_results` | render_id, checks(json), novelty_score, novelty_detail(json), verdict | QA+差异度 |
| `reviews` | id, render_id, mode, decision, reason_tags, note, decided_by, decided_at | 审核 |
| `videos` | id, channel_id, spec_id, render_id, yt_video_id, state, scheduled_at, published_at, privacy, title, ... | 内部视频实体，与远端关联 |
| `remote_videos` | channel_id, yt_video_id, title, published_at, privacy, duration, last_synced | 同步的全部远端视频（含旧视频） |
| `metric_snapshots` | video_id, taken_at, window, views, engaged_views, avg_view_pct, avg_view_sec, likes, comments, shares, subs_gained, subs_lost, watch_hours, stayed_to_watch(est) | 快照 |
| `comments` | id, channel_id, yt_comment_id, video_id, author, text, status, ai_draft, replied_at | 评论 |
| `reference_channels` | id, yt_channel_id, note, last_polled | 参考频道 |
| `reference_videos` | id, ref_channel_id, yt_video_id, stats, outlier_ratio, tags | 参考视频 |
| `trend_signals` | id, source, topic, score, payload, captured_at | 趋势 |
| `arms` | channel_id, axis, value, n, reward_sum, reward_sq, updated_at | 探索/记分牌 |
| `ai_calls` | id, channel_id, purpose, model, tokens_in, tokens_out, cost_usd, created_at | 成本台账 |
| `quota_ledger` | project_ref, date_pt, units, op, ref | YouTube 配额台账（按太平洋时间日） |
| `audit_log` | id, actor, action, entity, payload, at | 审计 |

索引原则：所有按 `channel_id + status/时间` 查询的表加复合索引；`specs.spec_hash` 唯一（频道内）防重复导入。

## 7. 存储布局（R2）

```
r2://studio/{channel_id}/specs/{spec_id}.json
r2://studio/{channel_id}/renders/{render_id}/video.mp4
r2://studio/{channel_id}/renders/{render_id}/frames/f{0..7}.jpg
r2://studio/{channel_id}/renders/{render_id}/events.json
r2://studio/{channel_id}/renders/{render_id}/fingerprint.json
r2://studio/{channel_id}/library/melodies/...
```
生命周期规则：`renders/*/video.mp4` 发布后 14 天删除；被驳回 3 天删除。预计单条 5–15MB，10GB 可容纳 ≥ 700 条在库成片，足够。

## 8. 安全与密钥

- 环境变量：`DATABASE_URL`、`R2_*`、`TOKEN_ENC_KEY`（32 字节）、`CRON_SECRET`、`WORKER_TOKEN`、`WORKER_HMAC_SECRET`、`GOOGLE_CLIENT_ID/SECRET`、`LLM_API_KEY`、`LLM_BASE_URL`、`GITHUB_DISPATCH_TOKEN`；
- 绝不入库明文令牌；日志脱敏；
- 登录：MVP 用单用户邮箱密码（或 Cloudflare Access 前置）；
- 公网暴露的接口：`/api/cron/tick`（Bearer CRON_SECRET）、`/api/worker/*`（WORKER_TOKEN + HMAC）、`/api/health`（保留，平台健康检查需要）。
