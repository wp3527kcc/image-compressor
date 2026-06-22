/**
 * OSS 上传工具 —— Edge Runtime 版本
 * 使用 Web Crypto API（HMAC-SHA1）生成 OSS 鉴权签名，
 * 通过 fetch 直接将文件推送到 OSS，不依赖任何 Node.js 内置模块。
 */

const ALLOWED_PREFIXES = ['compressor/uploadFiles/', 'compressor/temp/'];
const MAX_MEDIA_AGE_HOURS = 24;
const MAX_MEDIA_AGE_MS = MAX_MEDIA_AGE_HOURS * 60 * 60 * 1000;

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`缺少环境变量: ${name}`);
  return value;
}

/**
 * 用 Web Crypto HMAC-SHA1 计算 OSS 签名（Base64）
 */
async function hmacSha1Base64(secretKey, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const raw = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
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
  if (!safePrefix) throw new Error('对象前缀不能为空');
  const safeName = sanitizeObjectName(rawName || 'file', 'file');
  return `${safePrefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;
}

function normalizeObjectKey(value) {
  return String(value || '').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function isAllowedObjectKey(value) {
  const key = normalizeObjectKey(value);
  return ALLOWED_PREFIXES.some(prefix => key.startsWith(prefix));
}

function encodeObjectKeyForUrl(objectKey) {
  return String(objectKey || '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function getPublicBaseUrl() {
  const custom = String(process.env.UMI_APP_OSS_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (custom) return custom;
  const bucket = requireEnv('UMI_APP_OSS_BUCKET');
  const region = requireEnv('UMI_APP_OSS_REGION');
  return `https://${bucket}.${region}.aliyuncs.com`;
}

function getPublicUrlByKey(objectKey) {
  return `${getPublicBaseUrl()}/${encodeObjectKeyForUrl(objectKey)}`;
}

/**
 * 将文件内容（ArrayBuffer）通过 OSS Signature V1 PUT 到指定对象
 */
async function putObjectToOss({ objectKey, body, contentType }) {
  const bucket = requireEnv('UMI_APP_OSS_BUCKET');
  const region = requireEnv('UMI_APP_OSS_REGION');
  const accessKeyId = requireEnv('UMI_APP_OSS_ACCESS_KEY');
  const accessKeySecret = requireEnv('UMI_APP_OSS_SECRET_KEY');

  const customEndpoint = String(process.env.UMI_APP_OSS_ENDPOINT || '').trim()
    .replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const endpoint = customEndpoint || `${bucket}.${region}.aliyuncs.com`;

  const date = new Date().toUTCString();
  // OSS V1 签名: VERB\nContent-MD5\nContent-Type\nDate\nCanonicalizedResource
  const stringToSign = `PUT\n\n${contentType}\n${date}\n/${bucket}/${objectKey}`;
  const signature = await hmacSha1Base64(accessKeySecret, stringToSign);

  const response = await fetch(`https://${endpoint}/${objectKey}`, {
    method: 'PUT',
    headers: {
      Authorization: `OSS ${accessKeyId}:${signature}`,
      'Content-Type': contentType,
      Date: date,
      'Cache-Control': 'public, max-age=86400',
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OSS 上传失败 (${response.status})${text ? ': ' + text.slice(0, 300) : ''}`);
  }

  return getPublicUrlByKey(objectKey);
}

module.exports = {
  ALLOWED_PREFIXES,
  MAX_MEDIA_AGE_HOURS,
  MAX_MEDIA_AGE_MS,
  buildObjectKey,
  getPublicUrlByKey,
  isAllowedObjectKey,
  putObjectToOss,
  sanitizeObjectName,
};
