# 开发进度与验收记录 (PROGRESS)

## Phase 1–3 全链路已实现清单

### Phase 1：单频道闭环与确定性渲染
1. **VideoSpec v1 & 模板注册表 (`src/domain/videospec.ts`, `src/domain/templates.ts`)**
   - 完整 Zod 校验与 JSON Schema 导出，支持 `videospec/1`、`specbatch/1`、`ideabatch/1`、`melody/1`、`referencechannels/1`、`trendimport/1`。
   - 结构化错误码 `E001`–`E050` 与告警码 `W101`–`W105`，返回精确 JSON 路径；规范化 `spec_hash` 防重复导入。
2. **确定性物理音频渲染引擎 (`src/domain/simulation.ts`, `workers/render/render_worker.py`)**
   - 内置 `melody-bounce@1.0.0` 与 `ball-sort@1.0.0` 两个确定性模板（`mulberry32` 播种 PRNG）。
   - 浏览器端 9:16 Canvas + WebAudio 实时交互预览 + Shorts UI 安全区参考线。
   - 服务端纯 Python 标准库 + `ffmpeg` 实时合成真实物理动画帧与 `-14 LUFS` 马林巴事件音频（1080×1920 30fps H.264 + AAC）。
3. **差异度守卫 Novelty Guard (`src/domain/novelty.ts`)**
   - 8 条硬规则检查 + 3-gram 标题相似度 + 0–100 评分，支持按频道切换「仅告警」与「强制阻断」。

### Phase 2：多频道硬隔离、排期日历与自动化运维
4. **多频道硬隔离与 OAuth 2.0 真实集成 (`src/server/youtube.ts`, `src/server/crypto.ts`)**
   - 所有业务表与接口按 `channel_id` 严格隔离，跨频道禁止复用同一 `(mechanic, music_piece, hook_style)` 组合与同一 `yt_channel_id`。
   - OAuth 2.0 授权弹窗（强制 HTTPS 回调 + HMAC `state` 验签），Refresh Token 经 **AES-256-GCM** 加密存储且永不泄漏到前端或导出备份。
5. **7 天排期日历、紧急撤回与置信升降级 (`src/components/CalendarView.tsx`, `src/domain/bandit.ts`)**
   - 支持「7 天内容日历」与列表切换、排期改期、模拟 90% 断网幂等重传、远端公开状态校验、「半手动发布包」降级，以及一键「紧急撤回（设为 private 并自动降级至 L0）」。
   - 支持 L0 → L1（连续 20 条无撤回且 8h 超时自动过审）→ L2 信任等级评估与 `/api/cron/tick` 低水位自动补货（受 AI 月预算硬上限熔断保护）。

### Phase 3：数据闭环、评论中心与趋势情报
6. **频道视频与 Thompson Sampling 记分牌 (`src/components/VideosView.tsx`, `src/domain/analytics.ts`)**
   - 支持 YouTube API 远端同步、Studio CSV 导入（含 `engagedViews/views` 继续观看率估算）、视频标题/描述编辑（`videos.update`）、单视频「做下一集」AI 续集生成、分段留存曲线（`audienceWatchRatio`）SVG 展示，以及下周 `60/30/10` 配比记分牌。
7. **评论中心 (`src/components/CommentsView.tsx`)**
   - 同步频道评论线程，按「回复首评 > 观众提问 > 正向互动 > 垃圾评论」权重排序；Gemini 按频道语气起草回复，人工确认发送与隐藏垃圾评论（明确提示 YouTube API 不支持置顶评论）。
8. **情报与趋势 (`src/components/InsightsView.tsx`)**
   - 支持参考频道 0 配额 RSS + `videos.list`（1 单位/50条）抓取及 `>= 5x` 离群爆款识别，支持 `trendimport/1` 导入与一键 AI 转译为 `ideabatch/1` 创意池并展开为 `VideoSpec`。

## 文档索引
- 🔑 **授权凭据获取与部署配置指南**：[docs/SETUP_AND_CREDENTIALS.md](./SETUP_AND_CREDENTIALS.md)
