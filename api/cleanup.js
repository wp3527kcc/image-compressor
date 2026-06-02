const { list, del } = require('@vercel/blob');

const IMAGE_PREFIXES = ['uploads/', 'compressed/'];
const MAX_IMAGE_AGE_MS = 24 * 60 * 60 * 1000;

async function cleanupExpiredImages() {
  const now = Date.now();
  const deleted = [];

  for (const prefix of IMAGE_PREFIXES) {
    let cursor;

    do {
      const result = await list({ prefix, cursor, limit: 1000 });
      const expiredBlobs = result.blobs.filter(blob => {
        const uploadedAt = new Date(blob.uploadedAt).getTime();
        return Number.isFinite(uploadedAt) && now - uploadedAt > MAX_IMAGE_AGE_MS;
      });

      for (const blob of expiredBlobs) {
        await del(blob.url);
        deleted.push(blob.pathname);
      }

      cursor = result.cursor;
    } while (cursor);
  }

  return deleted;
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 GET 或 POST 请求' });
  }

  try {
    const deleted = await cleanupExpiredImages();
    res.status(200).json({ success: true, deletedCount: deleted.length, deleted });
  } catch (error) {
    res.status(500).json({ error: error.message || '清理过期图片失败' });
  }
}

module.exports = handler;
module.exports.cleanupExpiredImages = cleanupExpiredImages;
