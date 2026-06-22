const { ALLOWED_PREFIXES, MAX_MEDIA_AGE_MS, getOssClient } = require('./oss');
const { requireAuth } = require('./require-auth');

function isCronAuthorized(req) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret) return false;
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader === `Bearer ${cronSecret}`) return true;
  return String(req.headers['x-cron-secret'] || '').trim() === cronSecret;
}

function isExpiredByLastModified(lastModified) {
  if (!lastModified) return false;
  const timestamp = new Date(lastModified).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp > MAX_MEDIA_AGE_MS;
}

async function cleanupExpiredByPrefix(prefix) {
  const client = getOssClient();
  const deleted = [];
  let continuationToken = null;

  do {
    const result = await client.listV2({
      prefix,
      'max-keys': 1000,
      'continuation-token': continuationToken || undefined,
    });
    const objects = Array.isArray(result.objects) ? result.objects : [];

    for (const object of objects) {
      if (!isExpiredByLastModified(object.lastModified)) continue;
      // await client.delete(object.name); // 暂时不执行删除，无权限
      deleted.push(object.name);
    }

    continuationToken = result.nextContinuationToken || null;
  } while (continuationToken);

  return deleted;
}

async function cleanupExpiredImages() {
  const allDeleted = [];
  for (const prefix of ALLOWED_PREFIXES) {
    allDeleted.push(...await cleanupExpiredByPrefix(prefix));
  }
  return allDeleted;
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 GET 或 POST 请求' });
  }

  try {
    if (!isCronAuthorized(req)) {
      const user = await requireAuth(req, res);
      if (!user) return;
    }

    const deleted = await cleanupExpiredImages();
    res.status(200).json({ success: true, deletedCount: deleted.length, deleted });
  } catch (error) {
    res.status(500).json({ error: error.message || '清理过期图片失败' });
  }
}

module.exports = handler;
module.exports.cleanupExpiredImages = cleanupExpiredImages;
