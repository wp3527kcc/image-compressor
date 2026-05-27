const sharp = require('sharp');
const Busboy = require('busboy');
const { put, list, head } = require('@vercel/blob');

// Vercel Serverless Function 的请求体大小限制配置
module.exports.config = {
  api: {
    bodyParser: false, // 禁用默认 body parser，手动解析 multipart
  },
};

// 记录文件名
const RECORD_FILE = 'compression-records.md';

// 获取客户端IP地址
function getClientIP(req) {
  return req.headers['x-forwarded-for'] || 
         req.headers['x-real-ip'] || 
         req.socket?.remoteAddress || 
         'unknown';
}

// 解析 multipart/form-data 请求
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: 50 * 1024 * 1024, files: 20 },
    });

    const files = [];
    const fields = {};

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp'];

      if (!allowedTypes.includes(mimeType)) {
        file.resume();
        return;
      }

      const chunks = [];
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('end', () => {
        files.push({
          fieldname,
          originalname: filename,
          mimetype: mimeType,
          buffer: Buffer.concat(chunks),
          size: Buffer.concat(chunks).length,
        });
      });
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('finish', () => resolve({ files, fields }));
    busboy.on('error', reject);

    req.pipe(busboy);
  });
}

// 格式化文件大小
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 从 Vercel Blob 读取历史记录
async function readRecords() {
  try {
    const blobs = await list({ prefix: RECORD_FILE });
    if (blobs.blobs.length === 0) {
      return '# 图片压缩记录\n\n| 时间 | IP地址 | 图片名称 | 压缩前大小 | 压缩后大小 | 压缩率 |\n|------|--------|----------|------------|------------|--------|\n';
    }
    const response = await fetch(blobs.blobs[0].url);
    return await response.text();
  } catch (error) {
    console.error('读取记录失败:', error);
    return '# 图片压缩记录\n\n| 时间 | IP地址 | 图片名称 | 压缩前大小 | 压缩后大小 | 压缩率 |\n|------|--------|----------|------------|------------|--------|\n';
  }
}

// 追加新记录到 Markdown
function appendRecord(markdownContent, record) {
  const newRow = `| ${record.time} | ${record.ip} | ${record.imageName} | ${record.originalSize} | ${record.compressedSize} | ${record.compressionRatio} |\n`;
  const lines = markdownContent.split('\n');
  const headerIndex = lines.findIndex(line => line.startsWith('|------|'));
  if (headerIndex !== -1) {
    lines.splice(headerIndex + 1, 0, newRow);
  } else {
    lines.push(newRow);
  }
  return lines.join('\n');
}

// 保存记录到 Vercel Blob
async function saveRecords(content) {
  try {
    await put(RECORD_FILE, content, { access: 'public' });
    console.log('记录保存成功');
  } catch (error) {
    console.error('保存记录失败:', error);
  }
}

// 主处理函数
module.exports = async function handler(req, res) {
  // 仅允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const { files, fields } = await parseMultipart(req);

    if (!files || files.length === 0) {
      return res.status(400).json({ error: '请上传至少一张图片' });
    }

    const quality = parseInt(fields.quality) || 80;
    const results = [];
    const recordsToSave = [];
    const clientIP = getClientIP(req);
    const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    for (const file of files) {
      const originalName = file.originalname.replace(/\.[^/.]+$/, '');
      const outputFilename = `${originalName}.webp`;

      // 获取原始图片元数据
      const metadata = await sharp(file.buffer).metadata();

      // 使用 sharp 压缩并转换为 webp（输出到 Buffer）
      const outputBuffer = await sharp(file.buffer)
        .webp({ quality })
        .toBuffer();

      const compressionRatio = ((1 - outputBuffer.length / file.size) * 100).toFixed(1);

      // 转为 Base64 供前端直接下载
      const base64Data = outputBuffer.toString('base64');

      results.push({
        originalName: file.originalname,
        originalSize: file.size,
        compressedSize: outputBuffer.length,
        compressionRatio,
        width: metadata.width,
        height: metadata.height,
        outputFilename,
        base64: base64Data,
      });

      // 收集记录
      recordsToSave.push({
        time: currentTime,
        ip: clientIP,
        imageName: file.originalname,
        originalSize: formatSize(file.size),
        compressedSize: formatSize(outputBuffer.length),
        compressionRatio: `${compressionRatio}%`,
      });
    }

    // 保存记录（不阻塞响应）
    (async () => {
      try {
        let content = await readRecords();
        for (const record of recordsToSave) {
          content = appendRecord(content, record);
        }
        await saveRecords(content);
      } catch (error) {
        console.error('保存记录过程出错:', error);
      }
    })();

    res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('压缩失败:', error);
    res.status(500).json({ error: error.message || '图片处理失败' });
  }
};
