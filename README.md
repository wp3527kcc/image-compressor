# 图片/视频压缩工具

一个面向 Vercel 部署的在线媒体压缩工具。前端将原文件直传到 Vercel Blob，后端 Serverless Function 再从 Blob 拉取文件进行压缩，并将压缩结果回写到 Blob。原文件和压缩结果默认保留 24 小时。

## 功能特性

- 支持点击上传和拖拽上传。
- 支持批量处理，最多 20 个文件。
- 支持图片格式：JPEG、PNG、GIF、BMP、TIFF、WebP。
- 支持视频格式：MP4、WebM、MOV、AVI。
- 支持压缩质量调节，范围 1-100，默认 80。
- 图片可输出为 WebP、JPEG、PNG、AVIF。
- 视频统一输出为 MP4。
- 支持图片缩略图和视频预览。
- 支持单个下载和一键下载所有结果。
- 自动展示原大小、压缩后大小、压缩率、图片尺寸和结果保留时间。
- 自动清理超过 24 小时的上传文件和压缩结果。

## 技术栈

- **前端**：原生 HTML/CSS/JavaScript
- **上传**：`@vercel/blob/client`
- **后端**：Vercel Serverless Functions
- **存储**：Vercel Blob
- **图片处理**：Sharp
- **视频处理**：fluent-ffmpeg + ffmpeg-static
- **本地开发**：Node.js 自定义开发服务器

## 项目结构

```text
image-compressor/
├── api/
│   ├── upload.js         # Vercel Blob 客户端上传授权
│   ├── compress.js       # 媒体压缩接口
│   └── cleanup.js        # 过期 Blob 清理接口
├── public/
│   └── index.html        # 前端页面
├── dev-server.js         # 本地开发服务器
├── vercel.json           # Vercel 函数资源和 Cron 配置
├── package.json
└── .gitignore
```

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动本地开发服务器
pnpm dev
```

默认访问地址：

```text
http://localhost:4000
```

本地运行上传和压缩功能需要配置 Vercel Blob 读写令牌：

```bash
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

## 部署到 Vercel

### 方式一：通过 Vercel CLI

```bash
vercel
```

### 方式二：通过 GitHub 集成

1. 将项目推送到 GitHub。
2. 在 Vercel Dashboard 导入项目。
3. 创建并绑定 Vercel Blob Store。
4. 配置 `BLOB_READ_WRITE_TOKEN` 环境变量。
5. 触发部署。

## API 接口

### POST `/api/upload`

用于 `@vercel/blob/client` 直传文件前的服务端授权。

限制：

- 上传路径必须以 `uploads/` 开头。
- 单个文件最大 100MB。
- 允许图片和视频 MIME 类型。
- 上传文件会添加随机后缀，缓存时间为 24 小时。

### POST `/api/compress`

压缩已经上传到 Vercel Blob 的图片或视频。

请求体为 JSON：

```json
{
  "quality": 80,
  "imageFormat": "webp",
  "files": [
    {
      "name": "photo.jpg",
      "size": 2048000,
      "type": "image/jpeg",
      "url": "https://example.public.blob.vercel-storage.com/uploads/photo.jpg",
      "downloadUrl": "https://example.public.blob.vercel-storage.com/uploads/photo.jpg",
      "pathname": "uploads/photo.jpg"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `quality` | number | 压缩质量，范围 1-100，默认 80 |
| `imageFormat` | string | 图片输出格式，支持 `webp`、`jpeg`、`png`、`avif` |
| `files` | array | 已上传到 Vercel Blob 的文件列表，最多 20 个 |

响应示例：

```json
{
  "success": true,
  "results": [
    {
      "mediaType": "image",
      "originalName": "photo.jpg",
      "originalSize": 2048000,
      "compressedSize": 512000,
      "compressionRatio": "75.0",
      "width": 1920,
      "height": 1080,
      "outputFilename": "photo.webp",
      "outputFormat": "webp",
      "url": "https://example.public.blob.vercel-storage.com/compressed/photo.webp",
      "downloadUrl": "https://example.public.blob.vercel-storage.com/compressed/photo.webp",
      "expiresInHours": 24
    }
  ]
}
```

### GET/POST `/api/cleanup`

清理 `uploads/` 和 `compressed/` 目录下超过 24 小时的 Blob 文件。`vercel.json` 已配置每日 0 点自动调用。

响应示例：

```json
{
  "success": true,
  "deletedCount": 2,
  "deleted": [
    "uploads/example.jpg",
    "compressed/example.webp"
  ]
}
```

## 压缩记录

每次压缩完成后，服务端会将记录追加到 Vercel Blob 中的 `compression-records.md`，包括时间、IP、媒体类型、文件名、压缩前大小、压缩后大小和压缩率。

## 注意事项

- 前端通过 CDN 引入 `@vercel/blob/client`，网络不可用时会影响上传功能。
- 图片最大处理大小为 50MB，视频最大处理大小为 100MB。
- `api/compress.js` 当前配置为 60 秒超时、1024MB 内存；大视频可能受 Serverless 超时或内存限制影响。
- 公开部署时建议增加鉴权、限流和更严格的隐私处理。
