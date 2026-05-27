const sharp = require('sharp');
const Busboy = require('busboy');

// Vercel Serverless Function 的请求体大小限制配置
module.exports.config = {
  api: {
    bodyParser: false, // 禁用默认 body parser，手动解析 multipart
  },
};

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

    for (const file of files) {
      const originalName = file.originalname.replace(/\.[^/.]+$/, '');
      const outputFilename = `${originalName}.webp`;

      // 获取原始图片元数据
      const metadata = await sharp(file.buffer).metadata();

      // 使用 sharp 压缩并转换为 webp（输出到 Buffer）
      const outputBuffer = await sharp(file.buffer)
        .webp({ quality })
        .toBuffer();

      // 转为 Base64 供前端直接下载
      const base64Data = outputBuffer.toString('base64');

      results.push({
        originalName: file.originalname,
        originalSize: file.size,
        compressedSize: outputBuffer.length,
        compressionRatio: ((1 - outputBuffer.length / file.size) * 100).toFixed(1),
        width: metadata.width,
        height: metadata.height,
        outputFilename,
        base64: base64Data,
      });
    }

    res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('压缩失败:', error);
    res.status(500).json({ error: error.message || '图片处理失败' });
  }
};
