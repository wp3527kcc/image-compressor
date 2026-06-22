const { applyRateLimitHeaders, checkRateLimit } = require('../../lib/rate-limit');
const { authenticateUser } = require('../../lib/auth-service');
const { readJsonBody } = require('../../lib/http-utils');
const { createSession, setSessionCookie } = require('../../lib/session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const rateLimit = await checkRateLimit(req, 'auth_login');
    applyRateLimitHeaders(res, rateLimit);
    if (rateLimit.limited) {
      return res.status(429).json({ error: '登录请求过于频繁，请稍后再试' });
    }

    const body = await readJsonBody(req);
    const user = await authenticateUser({
      email: body.email,
      password: body.password,
    });
    const sessionId = await createSession(user);
    setSessionCookie(req, res, sessionId);

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    return res.status(Number(error.status) || 500).json({
      error: error.message || '登录失败',
    });
  }
};
