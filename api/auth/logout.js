const { clearSessionCookie, destroySession, readSessionIdFromRequest } = require('../session');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const sessionId = readSessionIdFromRequest(req);
    if (sessionId) {
      await destroySession(sessionId);
    }
    clearSessionCookie(req, res);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || '退出登录失败' });
  }
};
