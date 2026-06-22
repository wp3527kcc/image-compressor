const { ensureAuthSchema, getDb } = require('./db');
const { readSessionIdFromRequest, getSessionById } = require('./session');

async function resolveAuthUser(req) {
  const sessionId = readSessionIdFromRequest(req);
  if (!sessionId) return null;

  const session = await getSessionById(sessionId);
  if (!session?.userId || !session?.emailVerifiedAt) {
    return null;
  }

  await ensureAuthSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT id, email, email_verified_at
    FROM auth_users
    WHERE id = ${session.userId}::uuid
    LIMIT 1
  `;
  const user = rows[0];
  if (!user || !user.email_verified_at) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.email_verified_at,
    sessionId,
  };
}

async function requireAuth(req, res) {
  try {
    const user = await resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ error: '请先登录后再操作' });
      return null;
    }
    req.authUser = user;
    return user;
  } catch (error) {
    console.error('鉴权校验失败:', error);
    res.status(401).json({ error: '登录状态无效，请重新登录' });
    return null;
  }
}

module.exports = {
  requireAuth,
  resolveAuthUser,
};
