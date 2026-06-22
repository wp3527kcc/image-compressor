const { resolveAuthUser } = require('../require-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '仅支持 GET 请求' });
  }

  try {
    const user = await resolveAuthUser(req);
    if (!user) {
      return res.status(401).json({ error: '未登录' });
    }
    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || '读取用户信息失败' });
  }
};
