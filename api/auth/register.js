const { applyRateLimitHeaders, checkRateLimit } = require('../rate-limit');
const { registerUser } = require('../auth-service');
const { readJsonBody } = require('../http-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const rateLimit = await checkRateLimit(req, 'auth_register');
    applyRateLimitHeaders(res, rateLimit);
    if (rateLimit.limited) {
      return res.status(429).json({ error: '注册请求过于频繁，请稍后再试' });
    }

    const body = await readJsonBody(req);
    await registerUser({
      email: body.email,
      password: body.password,
      req,
    });

    return res.status(200).json({
      success: true,
      message: '注册成功，请前往邮箱完成验证后再登录',
    });
  } catch (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({
      error: error.message || '注册失败',
    });
  }
};
