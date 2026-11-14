# 09 交给编码 AI 的主 Prompt 与分阶段任务 Prompt

## 为什么要单独写 Prompt 文档，而不是把所有文档合成一个

- 文档总量很大，合成一个 Prompt 会撑爆上下文、关键约束被稀释；
- 正确做法：**Prompt = 入口 + 硬约束 + 完成定义；文档 = 细节来源**。编码 AI 在仓库里能直接读 `docs/`；
- 分阶段给任务（Phase 1 → 2 → 3），每次只让它做一个阶段，避免一次性大爆炸。

用法：先把「主 Prompt」发给编码 AI（每个新会话都带上），再按阶段追加「阶段任务 Prompt」。

---

## A. 主 Prompt（每次会话都带）

```text
你是资深全栈工程师，正在为「多频道 YouTube Shorts 自动化工作台」写代码。
项目的唯一事实来源是仓库里的 /docs 目录。开始前按顺序阅读：
docs/00-README.md（含决策记录 D1–D12）→ 03 → 04 → 07 →（按任务需要）02、05、06、08。
文档与你的想法冲突时以 docs 为准；docs 内部冲突以 00-README 的决策记录为准；发现文档有缺口或错误，
不要自行发明，把问题写进 docs/OPEN_QUESTIONS.md，并按「最保守、最容易回退」的方案先做。

【技术栈（已有脚手架）】
Next.js(App Router, TypeScript) + Postgres + Drizzle ORM + Tailwind。数据库连接在 src/db/index.ts，读取 DATABASE_URL。
对象存储 Cloudflare R2（S3 兼容）；渲染 Worker 是独立目录 workers/render（Python 3.11 + ffmpeg，Docker 化）。
保留已有的 /api/health 路由，平台健康检查依赖它。不要手改 package.json 里的依赖版本，用包管理器命令安装依赖。

【不可违背的约束】
1. 视频规格唯一入口是 VideoSpec JSON（docs/07）。用 zod 实现并导出 JSON Schema。
2. 渲染必须确定性：同 Spec + 同 seed + 同模板版本 = 逐帧相同。禁止在模板里使用系统时间/未播种随机数。
3. 控制面不做 CPU 重活；Worker 无状态、不连数据库，只通过 docs/04 §3.3 的协议交互。
4. 所有长耗时动作是 jobs 表里的任务；任务必须幂等（idempotency_key）；重试不能造成重复上传。
5. 所有业务表带 channel_id，所有查询必须按 channel_id 过滤；有自动化测试证明无法跨频道读取。
6. 差异度守卫（docs/02）是发布前强制关卡（Phase 1 告警模式，Phase 2 起阻断）。
7. YouTube 配额按项目计，写操作前必须经 quota_ledger 预扣；videos.insert=1600 单位；不要通过多项目绕配额。
8. 上传策略：private + publishAt。API 不支持置顶评论，只发首评，置顶由人工完成。
9. 密钥只放环境变量；OAuth 刷新令牌 AES-GCM 加密入库；日志脱敏；前端 bundle 不含任何密钥。
10. 外部服务（YouTube、R2、LLM、渲染触发）各自有接口 + 真实实现 + Mock 实现，CI 与本地默认用 Mock。
11. 音乐只允许公版/CC0/原创；旋律入库必须有 composer、death_year、source_url、license。
12. 不实现 docs/03 §4.10 的排除项（视频编辑器、AI 写实视频、刷量等）。

【工作方式】
- 先输出一份简短计划（要改/新增的文件、数据表、接口），再动手；每个小步骤可运行、可验证。
- domain 逻辑（状态机、守卫、规划器、配额）写成不依赖 Next/DB 的纯函数并配单元测试。
- 每次完成一个工作包，更新 docs/PROGRESS.md（做了什么、没做什么、已知问题、如何验证）。
- UI 文案中文；代码、字段、JSON 键英文；提供移动端可用的审核页。
- 最终验证：npx next typegen、npm exec tsc -- --noEmit、npm run build 都必须通过；/api/health 必须返回成功。

【完成定义】以 docs/08 对应阶段的「验收」清单为准，逐条给出验证方法与结果。不得宣称完成而没有逐条验证。
```

---

## B. Phase 1 任务 Prompt

```text
当前任务：实现 Phase 1（docs/08 的 Phase 1 范围与验收）。目标：单频道跑通
「导入 VideoSpec → 渲染 → 审核 → 上传（private+publishAt）→ 同步与指标快照」。

按以下顺序交付，每步完成后更新 docs/PROGRESS.md：
1. 数据库 schema（docs/04 §6 中 Phase 1 需要的表）+ 迁移；jobs 任务系统与 /api/cron/tick（Bearer CRON_SECRET）。
2. VideoSpec zod schema + JSON Schema 导出 + POST /api/import（支持 dry_run）+ 导入页面（错误带 JSON 路径，错误码见 docs/07 §8）+ 模板注册表。
   把 docs/07 §5/§6 的示例做成 fixtures 与测试。
3. workers/render：Dockerfile、Worker 协议客户端（claim/complete/fail，HMAC 签名）、模板 melody-bounce 与 ball-sort、
   事件驱动音频合成、QA 指标计算（LUFS、黑帧、首帧、钩子能量）、指纹输出（pHash/旋律序列/SHA-256）。
   先盘点仓库中已有的渲染代码并复用，不要重写已有逻辑。提供 GitHub Actions workflow（workflow_dispatch，带 job 批次）。
4. 渲染调度：控制面触发 workflow_dispatch（带 Mock 实现）；任务状态机；失败原因分类；一键重试。
5. 自动 QA + 差异度守卫（告警模式）+ 审核队列页面（L0 全手动，通过/驳回+原因标签+改标题后通过）。
6. YouTube 集成：OAuth 连接频道（scope 见 docs/06 §2）、令牌加密、quota_ledger、可续传上传 private+publishAt、
   首评、发布校验、失败重试（重试前先查远端防重复）、同步远端视频（uploads 播放列表）、
   Analytics 快照（24h/48h）、导入 Studio CSV（格式见 docs/data/channel-snapshot.csv）。
   若检测到上传后视频被锁私享，页面提示并启用「半手动发布包」流程（docs/06 §8）。
7. 基础页面：总览、频道、创意库（导入/Spec 列表）、制作（渲染队列/预览）、审核、日历（Phase 1 简版列表即可）、设置、监控。
8. README：本地启动、环境变量清单、如何更换渲染运行环境、如何运行测试。
9. 逐条验证 docs/08 Phase 1 的 9 条验收，并在 docs/PROGRESS.md 记录结果（包括强制第一次上传在 90% 处失败的幂等测试）。

不要做：多频道 UI、自动补货、趋势、评论中心、L1/L2 审核（留到后续阶段）；但数据表要带 channel_id。
```

---

## C. Phase 2 任务 Prompt

```text
当前任务：实现 Phase 2（docs/08）。前提：Phase 1 已验收。
1. 多频道硬隔离：频道切换器；所有查询 channel_id 过滤；R2 路径前缀；跨频道隔离的自动化测试（尝试读取他人数据必须失败）。
2. 差异度守卫升级为阻断（docs/02 §4.2 的 8 条硬规则、§4.3 相似度检测、Novelty Score 与阈值配置）；上线前两周默认告警模式可配置。
3. 排期规划器 + 日历：按频道时区窗口自动选槽、日上限、配额感知、60/30/10 配比、拖动调整。
4. AI 适配器：OpenAI 兼容；LLM_MODEL_T1/T2/T3；ai_calls 成本台账；频道月预算与全局预算熔断（80% 告警/100% 停止非必要任务）。
5. 自动补货：水位线 → 代码抽样轴组合并过守卫 → AI 按 docs/07 §9 的提示词写 specbatch → 校验失败带错误重试≤2 次 → 入库 → 渲染。
6. ideabatch 导入与「展开为 Spec」。
7. 审核 L1 半自动与信任等级升降（docs/03 §4.5）。
8. 视频管理：批量改隐私（每任务 ≤20 条）、改元数据、删除（二次确认+审计）。旧视频治理标记。
9. 每日摘要邮件。
10. 逐条验证 docs/08 Phase 2 的 6 条验收并记录。
```

---

## D. Phase 3 任务 Prompt

```text
当前任务：实现 Phase 3（docs/08）。前提：Phase 2 已验收。
1. 数据看板与留存曲线、72 小时评分与标签（docs/05 §8）、归因到模板/旋律/钩子/标题模式。
2. 记分牌 + Thompson Sampling 抽样（守卫优先）+ 每周 T3 周报（生成下周 60/30/10 配比建议并被规划器采用）。
3. 参考频道库：RSS 监控 + videos.list，离群爆款榜；日耗配额 ≤100 单位；参考频道解析需人工确认。
4. 趋势信号库、trendimport 导入、选题建议（输出 ideabatch）。
5. 评论中心：同步→AI 起草→人工确认→发送；隐藏垃圾；默认不自动回复。
6. 视觉 AI 抽检（T2）：5 个关键帧 + 标题。
7. 「做下一集」爆款复用（docs/07 §9.1）。
8. 逐条验证 docs/08 Phase 3 的 5 条验收并记录。
```

---

## E. 给「模板开发 AI」的单独 Prompt（可与主流程并行）

```text
任务：把现有渲染器里的一个机制封装成符合 docs/05 §2.2 模板接口的模板包，放在 workers/render/templates/<key>/。
要求：
1. 先阅读现有渲染代码，列出其参数，整理成 JSON Schema（paramsSchema）与 defaults，写 2 个示例 Spec（对齐 docs/07 §5 的格式）。
2. 所有随机性来自 spec.scene.seed；模板对同一输入输出逐帧一致（写测试：渲染两次比较帧哈希）。
3. 模拟产生事件流 events[]（t、type、位置、力度、碰撞对象），音频由事件驱动合成，保证音画同步误差 < 1 帧。
4. 前 0.5 秒必须出现运动和声音；支持 loop.mode = visual-return / audio-return。
5. 声明 axes 的可选值与事件名列表；提供 estimateCost(spec)。
6. 性能目标：28 秒 1080×1920@30fps 在 2 核 CPU 上 ≤ 5 分钟，记录实测。
7. 不引入需要 GPU 的依赖；不联网；不读取系统时间。
```
