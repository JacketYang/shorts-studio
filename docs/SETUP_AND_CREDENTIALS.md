# 授权凭据、多频道管理、存储清理与一体部署指南（Shorts Studio）

本指南覆盖平台必需凭据获取、3~5 个多频道账号隔离绑定、AI 协议（Gemini / OpenAI / Anthropic）调试、对象存储与缓存清理，以及**前后端一体单进程部署**步骤。

---

## 一、凭据填在哪里？哪些在页面保存，哪些放服务端变量？

为同时保证**多频道操作便捷性**与**密钥隔离安全**：
- **在网页「频道与设置」直接修改并保存（写入服务端数据库）**：
  - AI 协议切换（`Gemini` / `OpenAI 兼容` / `Anthropic`）、`Base URL`、模型拉取/填写、`思考强度`（默认 `high`）、系统提示词；
  - 3~5 个 YouTube 频道的增删、每日配额、时段策略、各自独立弹窗 OAuth 绑定；
  - 存储驱动切换（本地文件夹 / `Cloudflare R2` / `S3` / `WebDAV`）、Endpoint、Bucket、目录前缀、缓存自动清理天数、数据库驱动选择。
- **在服务端 `.env` 或部署平台 Secrets 注入（只填平台必需密钥，无多余自创 Token）**：

| 变量名 | 用途 | 必填 | 获取来源 |
|---|---|---|---|
| `YOUTUBE_API_KEY` | 查询频道数据、参考频道与公开统计 | 是 | Google Cloud Console |
| `GOOGLE_CLIENT_ID` | YouTube OAuth 客户端 ID（所有频道共用） | 是 | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | YouTube OAuth 客户端密钥（所有频道共用） | 是 | Google Cloud Console |
| `APP_URL` | 工作台访问根地址（必须 `https://`，拼接 OAuth 回调） | 是 | 部署域名 / AI Studio URL |
| `GEMINI_API_KEY` | Gemini 原生协议密钥 | 按协议选填 | Google AI Studio |
| `CUSTOM_AI_API_KEY` | OpenAI 兼容协议密钥（DeepSeek / OpenRouter / OneAPI） | 按协议选填 | 对应服务商后台 |
| `ANTHROPIC_API_KEY` | Anthropic `/v1/messages` 协议密钥 | 按协议选填 | Anthropic Console / 中转站 |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | Cloudflare R2 / S3 对象存储密钥 | 使用 R2/S3 时 | Cloudflare R2 / AWS 后台 |
| `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` | WebDAV 账号密码 | 使用 WebDAV 时 | Alist / Nextcloud / NAS |
| `STORAGE_DB_PATH` / `DATABASE_URL` | 自定义 JSON 库路径或外部 PostgreSQL 连接串 | 可选 | 本地路径 / Postgres 服务 |

> 不再强制配置任何额外的 `TOKEN_ENC_KEY`、`WORKER_TOKEN`、`WORKER_HMAC_SECRET` 或 `CRON_SECRET`；单机一体部署可零额外密钥直接启动。

---

## 二、多频道（3~5 个频道）共用凭据与独立 Token 机制

**只需在 Google Cloud 配置 1 组 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`，即可绑定任意多个频道：**
1. 在 **「频道与设置」→「新增工作台频道」** 添加你的第 1~5 个频道。
2. 在频道列表中，对每个频道分别点击 **「授权绑定 / 重连账号」**。
3. 弹窗已强制启用 `prompt=select_account consent`：Google 登录页每次都会弹出账号/品牌账号选择列表，你只需分别登录或选中对应频道所属 Google 账号完成授权。
4. 系统将每个频道独立的 `refresh_token` 按 `channel_id` 隔离保存在服务端数据库中（不会交叉覆盖、任何前端接口与导出 JSON 都不回显明文），各频道配额、渲染队列、AI 预算均完全隔离。
5. 支持在「多频道账号管理与隔离列表」随时**新增、切换、断开 OAuth 或删除频道**：删除频道时可勾选**“彻底删除该频道所有关联数据与本地缓存视频”**，一次性清空名下所有数据记录与磁盘 MP4/过程缓存文件（或仅删除账号凭据并保留历史归档）。
6. 如 OAuth 应用处于 **Testing（测试应用）** 状态，记得把这 3~5 个频道对应的 Google 邮箱都加入 Google Auth Platform 的 **Test users（测试用户）** 名单。

---

## 三、Google Cloud / YouTube 凭据获取路径

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，启用 **YouTube Data API v3** 与 **YouTube Analytics API**。
2. 在 **「凭据」→「创建凭据」→「API 密钥」** 获取 `YOUTUBE_API_KEY`。
3. 在 **Google Auth Platform（OAuth 同意屏幕）** 选择 **外部 (External)**，添加以下 4 个 Scope：
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
4. 在 **「凭据」→「创建凭据」→「OAuth 客户端 ID」→「Web 应用」**，在 **已获授权的重定向 URI** 中填入当前工作台 HTTPS 回调地址（可在「频道与设置」一键复制）：
   `https://<你的域名>/api/auth/youtube/callback`
   创建后即可复制 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET`。

---

## 四、AI 协议（Gemini / OpenAI / Anthropic）、模型拉取与思考强度最高档对齐

在 **「频道与设置」→「AI 接口协议、模型拉取/选择、思考强度与提示词控制」**：
1. **三大协议支持**：
   - `Gemini 原生协议`
   - `OpenAI 兼容协议 (/chat/completions)`（DeepSeek / OpenRouter / OneAPI）
   - `Anthropic 协议 (/v1/messages)`（Claude 官方或兼容中转）
2. **模型选填双模式（GET 拉取 + 手填）**：填写 `Base URL` 后点击 **「GET 获取模型」** 自动请求端口 `/models` 列表生成下拉选项，同时支持在右侧输入框自由手填/微调模型 ID。
3. **思考强度最高档自动对齐 (`thinking_level: max`)**：默认选择 **「最高档对齐」**，服务端自动探测不同接口可接受的最高档位：
   - **OpenAI 兼容接口**：依次尝试 `xhigh` → `max` → `high`（遇端口不支持参数自动降级，避免报 400）；
   - **Anthropic 协议**：依次尝试 `budget_tokens: 32000` → `16000` → `8192`；
   - **Gemini 原生**：依次尝试 `thinkingBudget: 32768` → `24576` → `8192`。
4. **连通性测试**：点击 **「测试连通性」** 直接使用页面当前配置发起实测，返回延迟（ms）、Token 消耗与**实际对齐生效的思考档位**。

---

## 五、对象存储接口、过程缓存管理与数据库适配器

在 **「频道与设置」→「视频存储接口、过程缓存清理与数据库适配器」**：
1. **三类存储目录严格分离**：
   - `cache/`：渲染过程中的 JSON 配置、FFmpeg `concat.txt` 等临时过程文件；
   - `renders/`：单条短视频成品 MP4；
   - `compilations/`：长视频合集 MP4。
2. **三种存储驱动自由切换**：
   - **本地指定文件夹 (`local`)**：直接填写任意持久化磁盘/挂载目录路径（如 `./data/media` 或 `/mnt/videos/shorts-studio`）；
   - **Cloudflare R2 / AWS S3 / MinIO (`s3`)**：填写 Endpoint、Region（R2 填 `auto`）、Bucket、路径前缀与可选 CDN 公开域名，服务端内置 AWS SigV4 签名直传；
   - **WebDAV (`webdav`)**：填写 Alist / Nextcloud / NAS 的 WebDAV 地址与前缀，生成完毕自动上传远端并可勾选上传后自动删除本地文件。
3. **清理与空间统计**：页面实时展示 `cache`、`renders`、`compilations` 与数据库文件占用大小，支持 **「测试存储连接」**、**「清理过程缓存」**、**「清理已发布视频 MP4」**、**「清空全部媒体缓存」** 及单文件删除；每次 Cron 心跳也会按设定的过期小时数自动清理过期 `cache/` 文件。

---

## 六、前后端一体单进程部署（One-Step Deployment）

本项目已重构为**前后端一体化单进程架构**：Express 服务端在生产环境下直接托管 Vite 构建产出的静态前端资源（`dist/`）和全部 `/api/*` 接口，**无需单独部署前端静态站或配置 Nginx 反代分流**。

### 本地 / VPS / Cloud Run 一体部署命令
```bash
# 1. 安装依赖（需 Node >= 20、Python >= 3.10、ffmpeg）
npm ci

# 2. 配置 .env（填入服务端必需密钥与 https:// APP_URL）
cp .env.example .env

# 3. 构建前端与服务端静态资源到 dist/
npm run build

# 4. 单进程一键启动（同时提供前端页面与全部 /api/* 路由，监听 PORT=3000）
NODE_ENV=production npm start
```

### Docker 一体化镜像参考
```dockerfile
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 ffmpeg fonts-dejavu-core ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
```
挂载 `./data` 持久卷启动：`docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data shorts-studio`
