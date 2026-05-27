# 图片压缩 & WebP 转码工具

一个支持 Vercel 部署的在线图片压缩和 WebP 转码服务。

## 功能特性

- 支持 JPEG、PNG、GIF、BMP、TIFF、WebP 格式图片上传
- 可调节压缩质量（1-100%）
- 自动转换为 WebP 格式
- 拖拽上传 / 点击上传
- 实时预览缩略图
- 一键下载压缩后的 WebP 文件
- 批量处理（最多 20 张）

## 技术栈

- **前端**：原生 HTML/CSS/JavaScript
- **后端**：Vercel Serverless Functions
- **图片处理**：Sharp
- **文件解析**：Busboy

## 项目结构

```
image-compressor/
├── api/
│   └── compress.js       # Serverless Function - 图片压缩接口
├── public/
│   └── index.html        # 前端页面
├── vercel.json           # Vercel 部署配置
├── package.json
└── .gitignore
```

## 本地开发

```bash
# 安装依赖
pnpm install

# 安装 Vercel CLI（如果未安装）
pnpm add -g vercel

# 启动本地开发服务器
pnpm dev
```

## 部署到 Vercel

### 方式一：通过 Vercel CLI

```bash
vercel
```

### 方式二：通过 GitHub 集成

1. 将项目推送到 GitHub
2. 在 [Vercel Dashboard](https://vercel.com) 导入项目
3. 自动部署完成

## API 接口

### POST /api/compress

压缩图片并转换为 WebP 格式。

**请求**：`multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| images | File[] | 图片文件（最多 20 张） |
| quality | number | 压缩质量 1-100，默认 80 |

**响应**：

```json
{
  "success": true,
  "results": [
    {
      "originalName": "photo.jpg",
      "originalSize": 2048000,
      "compressedSize": 512000,
      "compressionRatio": "75.0",
      "width": 1920,
      "height": 1080,
      "outputFilename": "photo.webp",
      "base64": "..."
    }
  ]
}
```

## 注意事项

- Vercel Serverless Function 有 4.5MB 的请求体限制（免费计划）
- 函数执行超时时间设置为 60 秒
- 内存分配 1024MB
