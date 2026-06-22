/**
 * /api/upload — Edge Function
 *
 * 运行在 Vercel Edge Runtime（离用户最近的节点），将浏览器上传的文件
 * 通过 fetch 流式代理到阿里云 OSS，彻底绕过浏览器跨域限制，
 * 同时避免 Serverless Function 的冷启动延迟和带宽瓶颈。
 *
 * 不依赖任何 Node.js 内置模块，全程使用 Web API。
 */

const { buildObjectKey, getPublicUrlByKey, putObjectToOss } = require('../lib/oss-edge');
const { applyRateLimitHeaders, checkRateLimit } = require('../lib/rate-limit');
const { addUploadHistory } = require('../lib/history-service');

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

// ── Session / Auth（纯 Web API，不依赖 lib/session.js 的 Node.js crypto）──

const SESSION_COOKIE_NAME = 'session_id';
const SESSION_KEY_PREFIX = 'sess:image-compressor:';

function parseCookiesFromHeader(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';')
      .map(pair => {
        const idx = pair.indexOf('=');
        if (idx <= 0) return null;
        return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
      })
      .filter(Boolean)
  );
}

async function getSessionFromRedis(sessionId) {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '');
  if (!url || !token) throw new Error('缺少 Redis 会话配置');

  const key = `${SESSION_KEY_PREFIX}${sessionId}`;
  const res = await fetch(`${url}/${['GET', key].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Redis 请求失败: ${res.status}`);
  const data = await res.json();
  const raw = data?.result;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function resolveUser(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const sessionId = String(parseCookiesFromHeader(cookieHeader)[SESSION_COOKIE_NAME] || '').trim();
  if (!sessionId) return null;
  const session = await getSessionFromRedis(sessionId);
  if (!session?.userId || !session?.emailVerifiedAt) return null;
  return session;
}

// ── 文件名工具（不依赖 path 模块）────────────────────────────────────────

function getFileExt(filename) {
  const base = String(filename || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).slice(0, 12).toLowerCase() : '';
}

function getBasename(filename) {
  return String(filename || 'file').split(/[\\/]/).pop() || 'file';
}

function sanitizeFilename(value) {
  return String(value || 'file')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|#%{}^~[\]`\r\n\t]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'file';
}

// ── Response 工具 ─────────────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// ── rate-limit 适配（lib/rate-limit.js 期望 Node.js req/res 风格）─────────

function makeRateLimitReq(request) {
  return {
    headers: {
      'x-forwarded-for': request.headers.get('x-forwarded-for') || '',
      'x-real-ip': request.headers.get('x-real-ip') || '',
    },
    socket: {},
  };
}

function makeRateLimitRes() {
  const headers = {};
  return {
    _extra: headers,
    setHeader(name, value) { headers[name] = String(value); },
    getHeader(name) { return headers[name]; },
  };
}

// ── 主处理器 ──────────────────────────────────────────────────────────────

async function handler(request) {
  if (request.method !== 'POST') {
    return json({ error: '仅支持 POST 请求' }, 405);
  }

  try {
    // 1. 鉴权
    const session = await resolveUser(request);
    if (!session) return json({ error: '请先登录后再操作' }, 401);

    // 2. 限流
    const rlReq = makeRateLimitReq(request);
    const rlRes = makeRateLimitRes();
    const rateLimit = await checkRateLimit(rlReq, 'upload');
    applyRateLimitHeaders(rlRes, rateLimit);
    if (rateLimit.limited) {
      return json({ error: '上传请求过于频繁，请稍后再试' }, 429, rlRes._extra);
    }

    // 3. 解析 multipart/form-data（Web API 原生支持）
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: '仅支持 multipart/form-data 上传' }, 400);
    }
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return json({ error: '未找到上传文件字段' }, 400);
    }

    // 4. 校验
    const contentType = file.type || '';
    const size = file.size || 0;
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return json({ error: '不支持的文件类型' }, 400);
    }
    if (size === 0) return json({ error: '上传文件不能为空' }, 400);
    if (size > MAX_UPLOAD_SIZE) {
      return json({ error: `文件不能超过 ${Math.floor(MAX_UPLOAD_SIZE / (1024 * 1024))}MB` }, 400);
    }

    // 5. 构建对象键
    const filename = file.name || 'upload';
    const ext = getFileExt(filename);
    const safeName = sanitizeFilename(getBasename(filename));
    const outputName = `${safeName}${ext && !safeName.endsWith(ext) ? ext : ''}`;
    const objectKey = buildObjectKey('compressor/uploadFiles/', outputName);

    // 6. 读取文件内容并上传到 OSS（Edge 节点 → OSS，绕过浏览器跨域）
    const fileBuffer = await file.arrayBuffer();
    const fileUrl = await putObjectToOss({ objectKey, body: fileBuffer, contentType });

    // 7. 记录历史
    const uploadedFile = {
      name: filename,
      size,
      type: contentType,
      url: fileUrl,
      downloadUrl: fileUrl,
      pathname: objectKey,
    };
    await addUploadHistory(session.userId, uploadedFile);

    return json({ success: true, file: uploadedFile }, 200, rlRes._extra);
  } catch (error) {
    console.error('[upload] error:', error?.message);
    return json({ error: error?.message || '文件上传失败' }, 500);
  }
}

module.exports = handler;
module.exports.config = { runtime: 'edge' };
