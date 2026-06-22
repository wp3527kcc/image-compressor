const crypto = require('crypto');
const { appendSetCookie, parseCookies } = require('./http-utils');

const SESSION_COOKIE_NAME = 'session_id';
const SESSION_KEY_PREFIX = 'sess:image-compressor:';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getRedisConfig() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) {
    throw new Error('缺少 Redis 会话配置');
  }
  return {
    url: url.replace(/\/+$/, ''),
    token,
  };
}

async function callRedis(command) {
  const redis = getRedisConfig();
  const response = await fetch(`${redis.url}/${command.map(item => encodeURIComponent(item)).join('/')}`, {
    headers: {
      Authorization: `Bearer ${redis.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Redis 会话请求失败: ${response.status}`);
  }

  return response.json();
}

function getSessionKey(sessionId) {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwardedProto) return forwardedProto === 'https';
  return Boolean(req.socket?.encrypted) || process.env.NODE_ENV === 'production';
}

function buildSessionCookie(req, value, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
  ];
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function setSessionCookie(req, res, sessionId) {
  appendSetCookie(res, buildSessionCookie(req, sessionId, SESSION_TTL_SECONDS));
}

function clearSessionCookie(req, res) {
  appendSetCookie(res, buildSessionCookie(req, '', 0));
}

async function createSession(user) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const payload = JSON.stringify({
    userId: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt || null,
    createdAt: Date.now(),
  });
  await callRedis(['SET', getSessionKey(sessionId), payload, 'EX', String(SESSION_TTL_SECONDS)]);
  return sessionId;
}

async function getSessionById(sessionId) {
  if (!sessionId) return null;
  const response = await callRedis(['GET', getSessionKey(sessionId)]);
  const raw = response?.result;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

async function destroySession(sessionId) {
  if (!sessionId) return;
  await callRedis(['DEL', getSessionKey(sessionId)]);
}

function readSessionIdFromRequest(req) {
  const cookies = parseCookies(req);
  return String(cookies[SESSION_COOKIE_NAME] || '').trim() || null;
}

module.exports = {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionById,
  readSessionIdFromRequest,
  setSessionCookie,
};
