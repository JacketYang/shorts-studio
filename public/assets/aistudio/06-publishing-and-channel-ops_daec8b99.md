# 06 发布与频道运营

## 1. 先决条件（关键路径，必须最先处理）

| 项 | 要求 | 不满足的后果 |
|---|---|---|
| OAuth 同意屏幕发布状态 | **In production（正式版）**。个人使用可保持「未验证应用」，同意时会有警告页 | 「测试」状态下刷新令牌 7 天过期，自动发布会周期性中断 |
| API 合规审计（YouTube API Services Audit） | 通过后解除「未审计项目上传的视频被锁私享」，并可申请提高配额 | 视频可通过 API 上传成功，但**一直是 private，无法转公开** |
| 配额 | 默认 10,000 单位/天/GCP 项目（**项目级，不是频道级**） | 默认只能上传约 6 条/天（全部频道合计） |
| 隐私政策/服务条款页面 | 审计申请需要可公开访问的页面；工作台提供 `/privacy` `/terms` 静态页 | 无法提交审计 |

> 事实核对（2026 资料）：`videos.insert` 1,600 单位；`videos.update`、`thumbnails.set`、`comments.insert`、`commentThreads.insert`、`videos.delete` 各 50；`search.list` 100；多数 `list` 1。未通过审计的 API 客户端上传的视频被限制为私享。开发时请再对照官方 Quota Calculator 复核。

### 1.1 第 0 天验证（5 分钟）
用现有凭据通过 API 上传一个**测试视频**，看最终是否能设为公开：
- 能公开 → 项目已审计/不受限，直接做自动发布；
- 被锁 private → 立即提交审计申请，同时启用 **§8 的降级方案**。

### 1.2 审计申请要点
- 用途描述：管理**自己拥有的**多个频道的内容发布与数据分析，不涉及第三方用户数据；
- 提供演示视频（录屏：连接频道 → 导入 Spec → 渲染 → 审核 → 发布）；
- 说明数据存储与删除方式（令牌加密、可一键断开并删除凭据）；
- 不要为了绕过配额创建多个 GCP 项目（违反 API 条款）。

## 2. 多频道 OAuth

- 每个频道单独授权：在 Google 授权页选择对应的**品牌账号/频道**；
- 授权后调用 `channels.list?mine=true` 取 `yt_channel_id`，与 `channels` 表绑定；**同一 `yt_channel_id` 不允许重复连接**；
- 请求的 scope（最小集）：
  - `youtube.upload`（上传）
  - `youtube.force-ssl`（评论读写、删除视频、更新元数据）
  - `youtube.readonly`（读取）
  - `yt-analytics.readonly`（数据分析）
- 刷新令牌 AES-GCM 加密存库；访问令牌只放内存，过期前 5 分钟刷新；
- 凭据失效（`invalid_grant`）→ 频道状态变 `reauth_required`，暂停该频道所有发布任务并告警，**不影响其他频道**；
- 频道间隔离：任务、队列、配额记账均带 `channel_id`；但**配额桶按 GCP 项目共享**，所以全局有一个 `quota_ledger`，发布调度器看的是「项目剩余配额」。

## 3. 配额台账与调度

- `quota_ledger(project_ref, date_pt, units, op, ref)`；**按太平洋时间午夜重置**统计「今天」；
- 每次调用前预扣、失败不退（因为失败的上传也可能扣配额）；
- 日预算分配（默认项目 10,000）：
  - 上传：`上传条数 × 1,600`（默认最多 4 条 = 6,400）
  - 维护写操作（改元数据/首评/回复）：≤ 1,500
  - 读取与同步：≤ 1,000
  - 保留 ≥ 15%（≈ 1,500）作为安全余量
- **全局日上传上限 = ⌊项目日配额 × 上传份额 ÷ 1,600⌋**（默认 10,000 配额下约 4 条，**是所有频道合计**）。各频道的 `daily_cap`（默认 3）只是频道内上限，调度器必须同时满足全局上限；因此在审计/扩容之前，多频道并行没有意义，先把单频道做好；
- 审计通过、配额提升后，只改配置 `daily_quota_units`，上限自动放开；
- 配额不足的上传任务顺延到次日，并在日历上以「配额顺延」标识。

## 4. 发布流程（P0）

```
approved
  → [schedule] 选槽：频道时区窗口内，且与该频道其他视频间隔 ≥ 3 小时，遵守日上限
  → [upload]  上传 private + publishAt(UTC)；记录 idempotency_key = upload:{video_id}
      · 先查远端：按「标题 + 创建时间 + 时长」匹配或查 uploads 播放列表，避免重试造成重复
      · 使用可续传上传（resumable），分块 8MB，网络中断从断点续传
  → [set_meta] 加入播放列表（系列）、发首评（commentThreads.insert，50 单位；置顶需手动）
  → [verify]  发布时间到后（+10 分钟）查询 privacyStatus=public，确认成功；否则告警
  → [measure] 排期快照任务（1h/24h/48h/7d）
```

### 4.1 元数据规范（Shorts）
| 字段 | 规则 |
|---|---|
| `snippet.title` | ≤ 100 字符；见 `02` 的标题限频；不要堆 #标签（1–2 个即可） |
| `snippet.description` | ≤ 5,000 字节；第一行是钩子复述；含系列名/集数；含 `#Shorts` |
| `snippet.tags` | 合计 ≤ 500 字符；对 Shorts 影响很小，保留 5–10 个即可 |
| `snippet.categoryId` | 默认 28（科技）或 24（娱乐），按频道配置 |
| `snippet.defaultLanguage/defaultAudioLanguage` | `en` |
| `status.privacyStatus` | `private`（配合 `publishAt`） |
| `status.publishAt` | ISO 8601 UTC |
| `status.selfDeclaredMadeForKids` | 必须明确设置，默认 `false` |
| `status.containsSyntheticMedia` | 默认 `false`；写实 AI 素材必须 `true`（以官方文档为准，开发时核对字段名） |
| 视频本身 | 竖屏 ≤ 3 分钟被识别为 Shorts（2024-10 起上限 3 分钟） |

### 4.2 失败与错误码处理
| 错误 | 处理 |
|---|---|
| `quotaExceeded` | 当日停止所有写操作，次日 PT 午夜后恢复；告警 |
| `uploadLimitExceeded`（频道日上传上限） | 顺延；降低该频道日上限；告警 |
| `invalid_grant` / 401 | 频道 `reauth_required` |
| 5xx / 网络 | 指数退避重试最多 5 次，**重试前先查远端是否已创建** |
| 视频处理失败（`processingFailure`） | 标记失败，重新渲染 + 重新上传（新幂等键） |
| 版权/Content ID 认领 | 同步到 `videos.claim_status`（手动录入或从 Studio 邮件；API 不直接提供），按 `02` 手册处理 |

### 4.3 发布时间策略
- MVP：每频道设 1–3 个发布时间窗（频道时区）；以英文观众为主默认 `America/New_York` 17:00–22:00 与 `Europe/London` 18:00–21:00 两个窗；
- 数据足够后（≥ 40 条）按小时桶统计 `reward`，倾向高分时段，但保留 20% 随机；
- **Shorts 的时间敏感性低于长视频**，不要在这上面过度投入。

## 5. 频道管理（对应 PRD 4.7）

| 功能 | API | 配额 | 说明 |
|---|---|---|---|
| 同步全部远端视频 | `channels.list(contentDetails)` → `playlistItems.list`（uploads）→ `videos.list` | 约 1 + N/50 + N/50 | 比 `search.list` 便宜 100 倍 |
| 改标题/描述/标签/隐私 | `videos.update` | 50/次 | 批量改隐私（旧视频治理）需限速：每次任务 ≤ 20 条 |
| 删除视频 | `videos.delete` | 50 | 二次确认 + 输入视频标题确认；写入 `audit_log`；**不可恢复**，UI 先推荐「改为不公开」 |
| 播放列表（系列） | `playlists.insert/update`、`playlistItems.insert` | 50 | 每个系列一个播放列表 |
| 评论收件箱 | `commentThreads.list`（`allThreadsRelatedToChannelId`） | 1/页 | 同步频率：发布 7 天内每 2 小时；之后每天 |
| 回复评论 | `comments.insert` | 50 | AI 起草 → 人工确认 → 发送；默认**不自动回复** |
| 隐藏/拒绝/标记 | `comments.setModerationStatus` | 50 | 对垃圾评论批量处理 |
| 置顶评论 | **API 不支持** | — | 手动 |
| 数据快照 | Analytics `reports.query` + `videos.list` | Analytics 有独立配额 | 见下 |

### 5.1 数据快照
- **T+1h**：只用 `videos.list`（statistics：viewCount/likeCount/commentCount），1 单位，用来发现「卡死」（0 播放）；
- **T+24h/48h/7d**：Analytics API（数据有 1–3 天延迟，`48h` 可靠）：
  `views, engagedViews, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, likes, comments, shares, subscribersGained, subscribersLost`，维度 `video`；
  留存曲线：维度 `elapsedVideoTimeRatio` + 指标 `audienceWatchRatio`，筛选单个视频；
- 估算继续观看率 = `engagedViews / views`；与 Studio 导出 CSV 对比校准；
- 缺口：「Shorts feed 展示次数」「swiped away」API 不一定提供，以 Studio CSV 手动导入补充。

### 5.2 旧视频治理（诊断 F9）
同步后，所有 `published_at` 早于「新定位起点」且不属于任何系列的视频，在 `/videos` 中标记「历史无关」；提供「批量设为不公开」。**默认不删除。**

## 6. 评论管理规则（P1）
1. 收件箱按优先级：对首评的回复 > 提问 > 正向 > 垃圾；
2. AI 起草回复遵循频道语气（档案里写「语气规则」与「禁止话题」）；
3. 含链接/多次重复/辱骂 → 自动建议隐藏；
4. 禁止：诱导订阅式群发、互相刷评论、购买互动；
5. 回复 SLA 目标：发布后 24 小时内回复前 20 条评论（互动是推荐信号）。

## 7. 通知
- 每日摘要（邮件/Telegram）：今日发布、明日待审、失败任务、配额、AI 花费、异常（0 播放视频、凭据失效）；
- P1：Telegram Bot 直接审核（通过/驳回按钮）。

## 8. 降级方案：半手动发布（审计没通过时）

1. 审核通过后，系统生成「发布包」页面：下载 mp4、复制标题/描述/标签/首评一键复制按钮；
2. 在 Studio 手动上传并用 Studio 的「安排时间」功能定时；
3. 运营者回工作台粘贴 YouTube 链接 → 系统用 `videos.list` 校验并与内部条目关联；
4. 数据同步仍走 API（只读 scope 不受审计限制），形成完整闭环；
5. 审计通过后一键切换到自动发布，**不丢数据**。

## 9. 安全与合规
- 只管理自己的频道；不抓取/不存储他人观众个人数据；
- 评论里的作者信息只保存展示需要的字段，保留期 90 天；
- 提供「断开频道并删除凭据」；
- 遵守 YouTube API Services Developer Policies（如不向第三方转售数据、不拼接用户画像等）。
