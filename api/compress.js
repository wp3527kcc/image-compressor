const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { put, list } = require('@vercel/blob');
const { cleanupExpiredImages } = require('./cleanup');
const { applyRateLimitHeaders, checkRateLimit } = require('./rate-limit');

ffmpeg.setFfmpegPath(ffmpegPath);

const RECORD_FILE = 'compression-records.md';
const MAX_JSON_BODY_SIZE = 1024 * 1024;
const MAX_FILES = 20;
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

const IMAGE_FORMATS = {
  webp: { extension: 'webp', contentType: 'image/webp' },
  jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
  png: { extension: 'png', contentType: 'image/png' },
  avif: { extension: 'avif', contentType: 'image/avif' },
};

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

function getVideoCrf(quality) {
  return Math.round(35 - (quality / 100) * 17);
}

function normalizeImageFormat(value) {
  const format = String(value || 'webp').toLowerCase();
  return IMAGE_FORMATS[format] ? format : 'webp';
}

function normalizeResizeOptions(value) {
  const maxWidth = parseInt(value?.maxWidth, 10);
  const maxHeight = parseInt(value?.maxHeight, 10);
  return {
    maxWidth: Number.isFinite(maxWidth) && maxWidth > 0 ? Math.min(maxWidth, 12000) : null,
    maxHeight: Number.isFinite(maxHeight) && maxHeight > 0 ? Math.min(maxHeight, 12000) : null,
  };
}

function normalizeMediaType(file) {
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  return 'image';
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
  const name = String(filename || 'media').replace(/[\\/]/g, '_');
  const baseName = name.replace(/\.[^/.]+$/, '').trim();
  return baseName || 'media';
}

function getSafePathSegment(value) {
  return String(value || 'media')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'media';
}

function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

async function fetchSourceBuffer(file, maxSize) {
  const sourceUrl = file.downloadUrl || file.url;
  if (!isAllowedBlobUrl(sourceUrl)) {
    throw new Error('媒体地址不合法');
  }

  const response = await fetch(sourceUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`读取媒体失败: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxSize) {
    throw new Error(`媒体大小超过 ${formatSize(maxSize)} 限制`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxSize) {
    throw new Error(`媒体大小超过 ${formatSize(maxSize)} 限制`);
  }

  return Buffer.from(arrayBuffer);
}

function convertImage(inputBuffer, format, quality, resizeOptions) {
  const pipeline = sharp(inputBuffer);
  if (resizeOptions?.maxWidth || resizeOptions?.maxHeight) {
    pipeline.resize({
      width: resizeOptions.maxWidth || undefined,
      height: resizeOptions.maxHeight || undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  if (format === 'jpeg') {
    return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  if (format === 'png') {
    return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, quality }).toBuffer();
  }
  if (format === 'avif') {
    return pipeline.avif({ quality }).toBuffer();
  }
  return pipeline.webp({ quality }).toBuffer();
}

function writeTempFile(buffer, extension) {
  const filePath = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function removeTempFiles(paths) {
  for (const filePath of paths) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('删除临时文件失败:', error);
    }
  }
}

function compressVideo(inputBuffer, quality) {
  return new Promise((resolve, reject) => {
    const inputPath = writeTempFile(inputBuffer, 'input');
    const outputPath = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    const crf = getVideoCrf(quality);

    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        `-crf ${crf}`,
        '-preset veryfast',
        '-c:a aac',
        '-b:a 128k',
        '-movflags +faststart',
      ])
      .format('mp4')
      .on('end', () => {
        try {
          const outputBuffer = fs.readFileSync(outputPath);
          removeTempFiles([inputPath, outputPath]);
          resolve(outputBuffer);
        } catch (error) {
          removeTempFiles([inputPath, outputPath]);
          reject(error);
        }
      })
      .on('error', error => {
        removeTempFiles([inputPath, outputPath]);
        reject(error);
      })
      .save(outputPath);
  });
}

async function readRecords() {
  const defaultContent = '# 压缩记录\n\n| 时间 | IP地址 | 类型 | 文件名称 | 压缩前大小 | 压缩后大小 | 压缩率 |\n|------|--------|------|----------|------------|------------|--------|\n';

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
    const content = await response.text();
    if (!content.includes('| 类型 |')) {
      return defaultContent;
    }
    return content;
  } catch (error) {
    console.error('读取记录失败:', error);
    return defaultContent;
  }
}

function appendRecord(markdownContent, record) {
  const newRow = `| ${escapeMarkdownCell(record.time)} | ${escapeMarkdownCell(record.ip)} | ${escapeMarkdownCell(record.mediaType)} | ${escapeMarkdownCell(record.fileName)} | ${escapeMarkdownCell(record.originalSize)} | ${escapeMarkdownCell(record.compressedSize)} | ${escapeMarkdownCell(record.compressionRatio)} |\n`;
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
      console.log(`已清理 ${deleted.length} 个过期媒体`);
    }
  } catch (error) {
    console.error('清理过期媒体失败:', error);
  }
}

async function processImage(file, inputBuffer, quality, imageFormat, resizeOptions) {
  const originalName = String(file.name || 'image');
  const originalSize = Number(file.size) || inputBuffer.length;
  const formatConfig = IMAGE_FORMATS[imageFormat];
  const outputFilename = `${getBaseName(originalName)}.${formatConfig.extension}`;
  const outputPathname = `compressed/${getSafePathSegment(outputFilename)}`;
  const outputBuffer = await convertImage(inputBuffer, imageFormat, quality, resizeOptions);
  const metadata = await sharp(outputBuffer).metadata();
  const compressedBlob = await put(outputPathname, outputBuffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: formatConfig.contentType,
    cacheControlMaxAge: 24 * 60 * 60,
  });

  return {
    result: {
      mediaType: 'image',
      originalName,
      originalSize,
      compressedSize: outputBuffer.length,
      compressionRatio: ((1 - outputBuffer.length / originalSize) * 100).toFixed(1),
      width: metadata.width,
      height: metadata.height,
      outputFilename,
      outputFormat: imageFormat,
      url: compressedBlob.url,
      downloadUrl: compressedBlob.downloadUrl || compressedBlob.url,
      expiresInHours: 24,
    },
    recordType: '图片',
  };
}

async function processVideo(file, inputBuffer, quality) {
  const originalName = String(file.name || 'video');
  const originalSize = Number(file.size) || inputBuffer.length;
  const outputFilename = `${getBaseName(originalName)}.mp4`;
  const outputPathname = `compressed/${getSafePathSegment(outputFilename)}`;
  const outputBuffer = await compressVideo(inputBuffer, quality);
  const compressedBlob = await put(outputPathname, outputBuffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'video/mp4',
    cacheControlMaxAge: 24 * 60 * 60,
  });

  return {
    result: {
      mediaType: 'video',
      originalName,
      originalSize,
      compressedSize: outputBuffer.length,
      compressionRatio: ((1 - outputBuffer.length / originalSize) * 100).toFixed(1),
      outputFilename,
      outputFormat: 'mp4',
      url: compressedBlob.url,
      downloadUrl: compressedBlob.downloadUrl || compressedBlob.url,
      expiresInHours: 24,
    },
    recordType: '视频',
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const rateLimit = await checkRateLimit(req, 'compress');
    applyRateLimitHeaders(res, rateLimit);
    if (rateLimit.limited) {
      return res.status(429).json({ error: '压缩请求过于频繁，请稍后再试' });
    }

    const body = await readJsonBody(req);
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : [];

    if (files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个文件' });
    }

    const quality = clampQuality(body.quality);
    const imageFormat = normalizeImageFormat(body.imageFormat);
    const resizeOptions = normalizeResizeOptions(body.imageResize);
    const results = [];
    const recordsToSave = [];
    const clientIP = getClientIP(req);
    const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    for (const file of files) {
      const mediaType = normalizeMediaType(file);
      const maxSize = mediaType === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      const inputBuffer = await fetchSourceBuffer(file, maxSize);
      const processed = mediaType === 'video'
        ? await processVideo(file, inputBuffer, quality)
        : await processImage(file, inputBuffer, quality, imageFormat, resizeOptions);
      const { result, recordType } = processed;

      results.push(result);
      recordsToSave.push({
        time: currentTime,
        ip: clientIP,
        mediaType: recordType,
        fileName: result.originalName,
        originalSize: formatSize(result.originalSize),
        compressedSize: formatSize(result.compressedSize),
        compressionRatio: `${result.compressionRatio}%`,
      });
    }

    await saveCompressionRecords(recordsToSave);
    await runCleanup();

    res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('压缩失败:', error);
    res.status(500).json({ error: error.message || '媒体处理失败' });
  }
};
