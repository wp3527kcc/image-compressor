const { handleUpload } = require('@vercel/blob/client');
const { applyRateLimitHeaders, checkRateLimit } = require('./rate-limit');

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

    req.on('data', chunk => chunks.push(chunk));
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const rateLimit = await checkRateLimit(req, 'upload');
    applyRateLimitHeaders(res, rateLimit);
    if (rateLimit.limited) {
      return res.status(429).json({ error: '上传请求过于频繁，请稍后再试' });
    }

    const body = await readJsonBody(req);
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async pathname => {
        if (!pathname.startsWith('uploads/')) {
          throw new Error('上传路径不合法');
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_SIZE,
          addRandomSuffix: true,
          cacheControlMaxAge: 24 * 60 * 60,
        };
      },
      onUploadCompleted: async () => {},
    });

    res.status(200).json(jsonResponse);
  } catch (error) {
    res.status(400).json({ error: error.message || '上传授权失败' });
  }
};
