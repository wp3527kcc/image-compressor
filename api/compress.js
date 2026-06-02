const sharp = require('sharp');
const { put, list } = require('@vercel/blob');
const { cleanupExpiredImages } = require('./cleanup');

const RECORD_FILE = 'compression-records.md';
const MAX_JSON_BODY_SIZE = 1024 * 1024;
const MAX_FILES = 20;
const MAX_SOURCE_SIZE = 50 * 1024 * 1024;

function getClientIP(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return ip?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function readJsonBody(req) {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) {
      return Promise.resolve(JSON.parse(req.body.toString('utf8') || '{}'));
    }
    if (typeof req.body === 'string') {
      return Promise.resolve(JSON.parse(req.body || '{}'));
    }
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_JSON_BODY_SIZE) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function clampQuality(value) {
  const quality = parseInt(value, 10);
  if (Number.isNaN(quality)) return 80;
  return Math.min(100, Math.max(1, quality));
}

function isAllowedBlobUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.vercel-storage.com');
  } catch (error) {
    return false;
  }
}

function getBaseName(filename) {
  const name = String(filename || 'image').replace(/[\\/]/g, '_');
  const baseName = name.replace(/\.[^/.]+$/, '').trim();
  return baseName || 'image';
}

function getSafePathSegment(value) {
  return String(value || 'image')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'image';
}

function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

async function fetchSourceBuffer(file) {
  const sourceUrl = file.downloadUrl || file.url;
  if (!isAllowedBlobUrl(sourceUrl)) {
    throw new Error('图片地址不合法');
  }

  const response = await fetch(sourceUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`读取图片失败: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_SIZE) {
    throw new Error('图片大小超过 50MB 限制');
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_SOURCE_SIZE) {
    throw new Error('图片大小超过 50MB 限制');
  }

  return Buffer.from(arrayBuffer);
}

async function readRecords() {
  const defaultContent = '# 图片压缩记录\n\n| 时间 | IP地址 | 图片名称 | 压缩前大小 | 压缩后大小 | 压缩率 |\n|------|--------|----------|------------|------------|--------|\n';

  try {
    const blobs = await list({ prefix: RECORD_FILE });
    const recordBlob = blobs.blobs.find(blob => blob.pathname === RECORD_FILE);
    if (!recordBlob) {
      return defaultContent;
    }
    const response = await fetch(`${recordBlob.url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      return defaultContent;
    }
    return await response.text();
  } catch (error) {
    console.error('读取记录失败:', error);
    return defaultContent;
  }
}

function appendRecord(markdownContent, record) {
  const newRow = `| ${escapeMarkdownCell(record.time)} | ${escapeMarkdownCell(record.ip)} | ${escapeMarkdownCell(record.imageName)} | ${escapeMarkdownCell(record.originalSize)} | ${escapeMarkdownCell(record.compressedSize)} | ${escapeMarkdownCell(record.compressionRatio)} |\n`;
  const lines = markdownContent.split('\n');
  const headerIndex = lines.findIndex(line => line.startsWith('|------|'));
  if (headerIndex !== -1) {
    lines.splice(headerIndex + 1, 0, newRow);
  } else {
    lines.push(newRow);
  }
  return lines.join('\n');
}

async function saveRecords(content) {
  await put(RECORD_FILE, content, {
    access: 'public',
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  console.log('记录保存成功');
}

async function saveCompressionRecords(recordsToSave) {
  try {
    let content = await readRecords();
    for (const record of recordsToSave) {
      content = appendRecord(content, record);
    }
    await saveRecords(content);
  } catch (error) {
    console.error('保存记录过程出错:', error);
  }
}

async function runCleanup() {
  try {
    const deleted = await cleanupExpiredImages();
    if (deleted.length > 0) {
      console.log(`已清理 ${deleted.length} 个过期图片`);
    }
  } catch (error) {
    console.error('清理过期图片失败:', error);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const body = await readJsonBody(req);
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];

    if (files.length === 0) {
      return res.status(400).json({ error: '请上传至少一张图片' });
    }

    const quality = clampQuality(body.quality);
    const results = [];
    const recordsToSave = [];
    const clientIP = getClientIP(req);
    const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    for (const file of files) {
      const originalName = String(file.name || 'image');
      const originalSize = Number(file.size) || 0;
      const originalBaseName = getBaseName(originalName);
      const outputFilename = `${originalBaseName}.webp`;
      const outputPathname = `compressed/${getSafePathSegment(outputFilename)}`;
      const inputBuffer = await fetchSourceBuffer(file);
      const metadata = await sharp(inputBuffer).metadata();
      const outputBuffer = await sharp(inputBuffer)
        .webp({ quality })
        .toBuffer();
      const compressedBlob = await put(outputPathname, outputBuffer, {
        access: 'public',
        addRandomSuffix: true,
        cacheControlMaxAge: 24 * 60 * 60,
      });
      const sourceSize = originalSize || inputBuffer.length;
      const compressionRatio = ((1 - outputBuffer.length / sourceSize) * 100).toFixed(1);

      results.push({
        originalName,
        originalSize: sourceSize,
        compressedSize: outputBuffer.length,
        compressionRatio,
        width: metadata.width,
        height: metadata.height,
        outputFilename,
        url: compressedBlob.url,
        downloadUrl: compressedBlob.downloadUrl || compressedBlob.url,
        expiresInHours: 24,
      });

      recordsToSave.push({
        time: currentTime,
        ip: clientIP,
        imageName: originalName,
        originalSize: formatSize(sourceSize),
        compressedSize: formatSize(outputBuffer.length),
        compressionRatio: `${compressionRatio}%`,
      });
    }

    await saveCompressionRecords(recordsToSave);
    await runCleanup();

    res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('压缩失败:', error);
    res.status(500).json({ error: error.message || '图片处理失败' });
  }
};
