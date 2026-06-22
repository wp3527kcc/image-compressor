const { requireAuth } = require('./require-auth');
const { clearUserHistory, listUserHistory } = require('./history-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return res.status(405).json({ error: '仅支持 GET 或 DELETE 请求' });
  }

  try {
    const user = await requireAuth(req, res);
    if (!user) return;

    if (req.method === 'GET') {
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const limit = requestUrl.searchParams.get('limit') || '100';
      const history = await listUserHistory(user.id, limit);
      return res.status(200).json({
        success: true,
        history,
      });
    }

    const deletedCount = await clearUserHistory(user.id);
    return res.status(200).json({
      success: true,
      deletedCount,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || '历史记录操作失败' });
  }
};
