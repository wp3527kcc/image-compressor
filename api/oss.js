const OSS = require('ali-oss');

const MAX_MEDIA_AGE_HOURS = 24;
const MAX_MEDIA_AGE_MS = MAX_MEDIA_AGE_HOURS * 60 * 60 * 1000;
const ALLOWED_PREFIXES = ['compressor/uploadFiles/', 'compressor/temp/'];

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
}

function getOssConfig() {
  const region = requireEnv('UMI_APP_OSS_REGION');
  const bucket = requireEnv('UMI_APP_OSS_BUCKET');
  return {
    region,
    bucket,
    accessKeyId: requireEnv('UMI_APP_OSS_ACCESS_KEY'),
    accessKeySecret: requireEnv('UMI_APP_OSS_SECRET_KEY'),
    endpoint: String(process.env.UMI_APP_OSS_ENDPOINT || '').trim() || undefined,
    secure: true,
    timeout: '60s',
  };
}

let cachedClient = null;
let cachedFingerprint = '';

function getOssClient() {
  const config = getOssConfig();
  const fingerprint = JSON.stringify({
    region: config.region,
    bucket: config.bucket,
    endpoint: config.endpoint || '',
    accessKeyId: config.accessKeyId,
  });
  if (!cachedClient || cachedFingerprint !== fingerprint) {
    cachedClient = new OSS(config);
    cachedFingerprint = fingerprint;
  }
  return cachedClient;
}

function encodeObjectKeyForUrl(objectKey) {
  return String(objectKey || '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function getPublicBaseUrl() {
  const customUrl = String(process.env.UMI_APP_OSS_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (customUrl) {
    return customUrl;
  }
  const config = getOssConfig();
  return `https://${config.bucket}.${config.region}.aliyuncs.com`;
}

function getPublicUrlByKey(objectKey) {
  return `${getPublicBaseUrl()}/${encodeObjectKeyForUrl(objectKey)}`;
}

function sanitizeObjectName(value, fallback = 'file') {
  return String(value || fallback)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || fallback;
}

function buildObjectKey(prefix, rawName) {
  const safePrefix = String(prefix || '').replace(/^\/+|\/+$/g, '');
  if (!safePrefix) {
    throw new Error('对象前缀不能为空');
  }
  const safeName = sanitizeObjectName(rawName || 'file', 'file');
  return `${safePrefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;
}

function normalizeObjectKey(value) {
  return String(value || '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function isAllowedObjectKey(value) {
  const key = normalizeObjectKey(value);
  return ALLOWED_PREFIXES.some(prefix => key.startsWith(prefix));
}

function extractObjectKeyFromInput(file) {
  const pathname = normalizeObjectKey(file?.pathname);
  if (pathname && isAllowedObjectKey(pathname)) {
    return pathname;
  }

  const sourceUrl = String(file?.downloadUrl || file?.url || '').trim();
  if (!sourceUrl) {
    throw new Error('媒体地址不合法');
  }

  try {
    const parsed = new URL(sourceUrl);
    const objectKey = normalizeObjectKey(decodeURIComponent(parsed.pathname));
    if (!isAllowedObjectKey(objectKey)) {
      throw new Error('媒体地址不合法');
    }
    return objectKey;
  } catch (error) {
    throw new Error('媒体地址不合法');
  }
}

module.exports = {
  ALLOWED_PREFIXES,
  MAX_MEDIA_AGE_HOURS,
  MAX_MEDIA_AGE_MS,
  buildObjectKey,
  extractObjectKeyFromInput,
  getOssClient,
  getPublicUrlByKey,
  isAllowedObjectKey,
  normalizeObjectKey,
  sanitizeObjectName,
};
