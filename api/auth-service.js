const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { ensureAuthSchema, getDb } = require('./db');
const { sendVerificationEmail } = require('./mailer');

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  const raw = String(password || '');
  if (raw.length < PASSWORD_MIN_LENGTH) {
    throw createHttpError(400, `密码长度至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (raw.length > 128) {
    throw createHttpError(400, '密码长度不能超过 128 位');
  }
  return raw;
}

function getAppBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  const protocol = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!host) {
    throw createHttpError(500, '无法解析应用地址');
  }
  return `${protocol}://${host}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function findUserByEmail(email) {
  await ensureAuthSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT id, email, password_hash, email_verified_at
    FROM auth_users
    WHERE email = ${email}
    LIMIT 1
  `;
  return rows[0] || null;
}

function toAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.email_verified_at || null,
  };
}

async function issueVerificationEmail(userId, email, req) {
  const sql = getDb();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);

  await sql`
    UPDATE auth_email_verifications
    SET used_at = NOW()
    WHERE user_id = ${userId}::uuid AND used_at IS NULL
  `;

  await sql`
    INSERT INTO auth_email_verifications (user_id, token_hash, expires_at)
    VALUES (${userId}::uuid, ${tokenHash}, ${expiresAt})
  `;

  const verifyUrl = `${getAppBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  await sendVerificationEmail({
    to: email,
    verifyUrl,
  });
}

async function registerUser({ email, password, req }) {
  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    throw createHttpError(400, '邮箱格式不正确');
  }
  const normalizedPassword = validatePassword(password);

  await ensureAuthSchema();
  const sql = getDb();
  const existing = await findUserByEmail(normalizedEmail);
  const passwordHash = await bcrypt.hash(normalizedPassword, 12);

  let userId;
  if (existing) {
    if (existing.email_verified_at) {
      throw createHttpError(409, '该邮箱已注册，请直接登录');
    }
    await sql`
      UPDATE auth_users
      SET password_hash = ${passwordHash}, updated_at = NOW()
      WHERE id = ${existing.id}::uuid
    `;
    userId = existing.id;
  } else {
    const inserted = await sql`
      INSERT INTO auth_users (email, password_hash)
      VALUES (${normalizedEmail}, ${passwordHash})
      RETURNING id
    `;
    userId = inserted[0]?.id;
  }

  await issueVerificationEmail(userId, normalizedEmail, req);
}

async function verifyEmailToken(token) {
  const rawToken = String(token || '').trim();
  if (!rawToken) {
    throw createHttpError(400, '缺少验证参数');
  }

  await ensureAuthSchema();
  const sql = getDb();
  const tokenHash = hashToken(rawToken);
  const rows = await sql`
    SELECT ev.id, ev.user_id, u.email
    FROM auth_email_verifications ev
    JOIN auth_users u ON u.id = ev.user_id
    WHERE ev.token_hash = ${tokenHash}
      AND ev.used_at IS NULL
      AND ev.expires_at > NOW()
    LIMIT 1
  `;
  const verification = rows[0];
  if (!verification) {
    throw createHttpError(400, '验证链接无效或已过期');
  }

  await sql`
    UPDATE auth_email_verifications
    SET used_at = NOW()
    WHERE id = ${verification.id}::uuid
  `;
  await sql`
    UPDATE auth_users
    SET email_verified_at = NOW(), updated_at = NOW()
    WHERE id = ${verification.user_id}::uuid
  `;

  return {
    email: verification.email,
  };
}

async function authenticateUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || '');
  if (!normalizedEmail || !normalizedPassword) {
    throw createHttpError(400, '邮箱和密码不能为空');
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    throw createHttpError(401, '邮箱或密码错误');
  }

  const matched = await bcrypt.compare(normalizedPassword, user.password_hash);
  if (!matched) {
    throw createHttpError(401, '邮箱或密码错误');
  }

  if (!user.email_verified_at) {
    throw createHttpError(403, '请先验证邮箱后再登录');
  }

  return toAuthUser(user);
}

module.exports = {
  authenticateUser,
  createHttpError,
  registerUser,
  toAuthUser,
  verifyEmailToken,
};
