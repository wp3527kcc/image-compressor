const path = require('path');
const { applyRateLimitHeaders, checkRateLimit } = require('./rate-limit');
const { buildObjectKey, getOssClient, getPublicUrlByKey } = require('./oss');
const { requireAuth } = require('./require-auth');
const { addUploadHistory } = require('./history-service');

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
];
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_UPLOAD_SIZE + 512 * 1024;
function sanitizeFilename(value) {
  return String(value || 'file')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'file';
}

function getHeader(contentType) {
  if (Array.isArray(contentType)) return contentType[0] || '';
  return String(contentType || '');
}

function parseBoundary(contentType) {
  const match = getHeader(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] || match?.[2] || null;
}

function parseMultipartBody(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from('\r\n\r\n');
  let cursor = buffer.indexOf(boundaryBuffer);
  if (cursor === -1) {
    throw new Error('无法解析上传内容');
  }

  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length;
    const isFinal = buffer[partStart] === 45 && buffer[partStart + 1] === 45;
    if (isFinal) break;

    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) {
      partStart += 2;
    }
    const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, partStart);
    if (nextBoundaryIndex === -1) break;

    const part = buffer.slice(partStart, nextBoundaryIndex - 2);
    const headerEnd = part.indexOf(headerSeparator);
    if (headerEnd === -1) {
      cursor = nextBoundaryIndex;
      continue;
    }

    const headerText = part.slice(0, headerEnd).toString('utf8');
    const content = part.slice(headerEnd + headerSeparator.length);
    const disposition = headerText.match(/content-disposition:[^\r\n]*/i)?.[0] || '';
    const fieldName = disposition.match(/name="([^"]+)"/i)?.[1] || '';
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || '';
    const contentType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || '';

    if (filename && fieldName === 'file') {
      return {
        filename,
        contentType,
        buffer: content,
      };
    }

    cursor = nextBoundaryIndex;
  }

  throw new Error('未找到上传文件字段');
}

function readMultipartBody(req) {
  const boundary = parseBoundary(req.headers['content-type']);
  if (!boundary) {
    throw new Error('仅支持 multipart/form-data 上传');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;

    req.on('data', chunk => {
      totalSize += chunk.length;
      if (totalSize > MAX_REQUEST_SIZE) {
        reject(new Error(`上传文件不能超过 ${Math.floor(MAX_UPLOAD_SIZE / (1024 * 1024))}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const bodyBuffer = Buffer.concat(chunks);
        const parsed = parseMultipartBody(bodyBuffer, boundary);
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    const rateLimit = await checkRateLimit(req, 'upload');
    applyRateLimitHeaders(res, rateLimit);
    if (rateLimit.limited) {
      return res.status(429).json({ error: '上传请求过于频繁，请稍后再试' });
    }

    const upload = await readMultipartBody(req);
    if (!upload.buffer || upload.buffer.length === 0) {
      return res.status(400).json({ error: '上传文件不能为空' });
    }
    if (!ALLOWED_CONTENT_TYPES.includes(upload.contentType)) {
      return res.status(400).json({ error: '不支持的文件类型' });
    }
    if (upload.buffer.length > MAX_UPLOAD_SIZE) {
      return res.status(400).json({ error: `上传文件不能超过 ${Math.floor(MAX_UPLOAD_SIZE / (1024 * 1024))}MB` });
    }

    const ext = path.extname(upload.filename || '').slice(0, 12).toLowerCase();
    const safeName = sanitizeFilename(path.basename(upload.filename || 'upload'));
    const outputName = `${safeName}${ext && !safeName.endsWith(ext) ? ext : ''}`;
    const objectKey = buildObjectKey('compressor/uploadFiles/', outputName);
    const client = getOssClient();
    await client.put(objectKey, upload.buffer, {
      mime: upload.contentType,
      headers: {
        'Content-Type': upload.contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });

    const fileUrl = getPublicUrlByKey(objectKey);
    const uploadedFile = {
      name: upload.filename || outputName,
      size: upload.buffer.length,
      type: upload.contentType,
      url: fileUrl,
      downloadUrl: fileUrl,
      pathname: objectKey,
    };
    await addUploadHistory(user.id, uploadedFile);

    res.status(200).json({
      success: true,
      file: uploadedFile,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || '文件上传失败' });
  }
};
