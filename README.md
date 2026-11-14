# Shorts Studio — 多频道 YouTube Shorts 自动化工作台

基于设计文档 (`00`–`99`) 构建的生产级工作台：在一个界面完成「VideoSpec / IdeaBatch / TrendImport JSON 导入 & AI 差异化补货 → 确定性无 GPU 物理音频渲染 → 自动 QA / T2 视觉抽检 / 差异度守卫 → L0/L1/L2 分级审核 → 7 天排期日历与配额管理 → YouTube OAuth 2.0 真实上传 / 评论中心 / 留存曲线 & Thompson Sampling 记分牌」。

---

## 本地运行与测试

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（参考 docs/SETUP_AND_CREDENTIALS.md）
cp .env.example .env

# 3. 运行全部单元测试（域逻辑、加解密、隔离、幂等恢复、Cron Tick）
npm test

# 4. 启动开发服务器 (Express + Vite, 端口 3000)
npm run dev

# 5. 生产构建与启动
npm run build
npm start
```

---

## 密钥获取与部署配置文档（必读）

👉 请查看 **[docs/SETUP_AND_CREDENTIALS.md](./docs/SETUP_AND_CREDENTIALS.md)**，内含详细图文级步骤说明：
- 在哪里申请与限制 `YOUTUBE_API_KEY`
- 如何配置 Google OAuth 同意屏幕（Scopes / 测试用户 / 转正式版）
- 在哪里获取 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 及必配 HTTPS 重定向 URL
- 在哪里获取 `GEMINI_API_KEY`、生成 `TOKEN_ENC_KEY` / `WORKER_HMAC_SECRET`
- 如何将密钥填到本地 `.env` 与线上平台环境变量（Secrets）
- 如何排查 YouTube API 审计锁定（Private Lock）与使用「半手动发布包」降级

---

## 渲染 Worker 与 GitHub Actions

- 确定性物理动画合成器位于 `workers/render/render_worker.py` 与 `workers/render/Dockerfile`（纯 Python 标准库 + `ffmpeg`，无需 GPU / Chromium，支持 `melody-bounce` 与 `ball-sort` 动态帧合成 + `-14 LUFS` 音频归一化）。
- GitHub Actions 触发模板位于 `.github/workflows/render.yml`（支持 `workflow_dispatch` 批量领取渲染任务并回传 HMAC 签名回调），可随时迁移至 Oracle 免费 ARM VM、Cloud Run Jobs 或本地容器。

---

## Git 版本控制与远程推送

本项目已在本地 `main` 分支保留完整提交历史（`.env`、运行时数据库 `data/` 与浏览器截图目录已通过 `.gitignore` 严格忽略）。配置你的远程仓库即可统一推送：

```bash
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```
