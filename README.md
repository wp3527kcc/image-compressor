# 图片/视频压缩工具

一个基于 Vercel Serverless Functions 的媒体压缩服务，已接入完整鉴权：

- 用户必须注册、完成邮箱验证并登录后，才能使用上传与压缩功能。
- 原文件和压缩结果均存储在阿里云 OSS。
- 用户数据与邮箱验证数据存储在 NeonDB。
- 登录态（Session）存储在 Redis。

## 功能特性

- 注册 / 登录 / 登出 / 当前登录态查询。
- 注册时发送邮箱验证邮件，未验证邮箱禁止登录。
- 支持批量处理，最多 20 个文件。
- 图片支持 JPEG、PNG、GIF、BMP、TIFF、WebP。
- 视频支持 MP4、WebM、MOV、AVI。
- 图片输出支持 WebP、JPEG、PNG、AVIF；视频输出为 MP4。
- 支持压缩质量和图片最大宽高设置。
- 支持单个下载和打包下载 ZIP。
- 上传、压缩、注册、登录接口支持基于 Redis 的 IP 限流。
- 自动清理 OSS 中超过 24 小时的 `uploads/` 与 `compressed/` 文件。
- 用户上传与压缩历史写入 NeonDB（不再使用浏览器本地历史存储）。

## 技术栈

- 前端：原生 HTML/CSS/JavaScript
- 后端：Node.js + Vercel Functions
- 对象存储：阿里云 OSS
- 数据库：Neon PostgreSQL
- 会话与限流：Upstash Redis REST API
- 邮件：SMTP（`nodemailer`）
- 图片处理：Sharp
- 视频处理：fluent-ffmpeg + ffmpeg-static

## 项目结构

```text
image-compressor/
├── api/
│   ├── auth/                 # 注册/登录/邮箱验证接口
│   ├── auth-service.js       # 用户与邮箱验证业务
│   ├── session.js            # Redis Session 与 Cookie
│   ├── require-auth.js       # 接口鉴权守卫
│   ├── db.js                 # NeonDB 连接与表结构初始化
│   ├── mailer.js             # SMTP 发信
│   ├── upload.js             # 上传到 OSS
│   ├── compress.js           # 读取 OSS 压缩并写回 OSS
│   ├── cleanup.js            # 清理过期 OSS 文件
│   ├── history.js            # 用户历史查询/清空接口
│   ├── history-service.js    # 上传与压缩历史写库逻辑
│   └── rate-limit.js         # Redis 限流
├── migrations/
│   └── 001_auth.sql          # 用户与邮箱验证表结构
├── public/
│   ├── index.html            # 主业务页面（需登录）
│   ├── login.html            # 登录页
│   └── register.html         # 注册页
├── dev-server.js
├── vercel.json
└── package.json
```

## 环境变量

### OSS

```bash
UMI_APP_OSS_ACCESS_KEY=your_access_key_id
UMI_APP_OSS_SECRET_KEY=your_access_key_secret
UMI_APP_OSS_BUCKET=your_bucket
UMI_APP_OSS_REGION=oss-cn-shanghai
# 可选
UMI_APP_OSS_ENDPOINT=
UMI_APP_OSS_PUBLIC_URL=
```

### NeonDB

```bash
DATABASE_URL=postgres://...
```

### 邮件（SMTP）

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your_user
SMTP_PASS=your_password_or_app_token
SMTP_FROM="压缩服务 <noreply@example.com>"
APP_BASE_URL=https://your-domain.com
```

### Redis（Session + 限流）

```bash
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
UPLOAD_RATE_LIMIT=60
UPLOAD_RATE_LIMIT_WINDOW_SECONDS=3600
COMPRESS_RATE_LIMIT=20
COMPRESS_RATE_LIMIT_WINDOW_SECONDS=3600
AUTH_REGISTER_RATE_LIMIT=10
AUTH_REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600
AUTH_LOGIN_RATE_LIMIT=30
AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS=3600
```

### 定时清理（可选）

若使用 Vercel Cron，建议配置：

```bash
CRON_SECRET=your_cron_secret
```

`/api/cleanup` 会优先接受 `Authorization: Bearer <CRON_SECRET>` 或 `x-cron-secret` 头部，满足后可跳过登录态校验。

## 本地开发

```bash
pnpm install
pnpm dev
```

默认访问：`http://localhost:4000`

## 鉴权接口

- `POST /api/auth/register`：注册并发送邮箱验证邮件
- `GET /api/auth/verify-email?token=...`：邮箱验证
- `POST /api/auth/login`：登录并写入 Session Cookie
- `POST /api/auth/logout`：退出登录
- `GET /api/auth/me`：获取当前登录用户

## 页面路由

- `/`：压缩主页面（未登录会自动重定向到 `/login`）
- `/login`：登录页面
- `/register`：注册页面

## 受保护接口

以下接口需要登录后访问：

- `POST /api/upload`
- `POST /api/compress`
- `GET /api/history`
- `DELETE /api/history`
- `GET /api/cleanup`
- `POST /api/cleanup`

## 压缩记录

每次压缩完成后，服务端会将记录写入 OSS 的 `compression-records.md`。
同时，用户维度的上传/压缩历史会写入 NeonDB 的 `auth_media_history` 表，并由前端从 `/api/history` 拉取展示。
