const { verifyEmailToken } = require('../auth-service');

function getAppBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const protocol = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  return host ? `${protocol}://${host}` : '';
}

function renderHtml({ title, description, success, appBaseUrl }) {
  const color = success ? '#059669' : '#dc2626';
  const link = appBaseUrl ? `<p><a href="${appBaseUrl}" style="color:#4f46e5;">返回应用</a></p>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="font-family:Arial,sans-serif;padding:24px;line-height:1.6;color:#111827;">
  <h2 style="margin-bottom:12px;color:${color};">${title}</h2>
  <p>${description}</p>
  ${link}
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '仅支持 GET 请求' });
  }

  try {
    const requestUrl = new URL(req.url, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`);
    const token = requestUrl.searchParams.get('token') || '';
    const result = await verifyEmailToken(token);
    const html = renderHtml({
      title: '邮箱验证成功',
      description: `账号 ${result.email} 已完成验证，现在可以返回应用登录。`,
      success: true,
      appBaseUrl: getAppBaseUrl(req),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;
    res.end(html);
  } catch (error) {
    const html = renderHtml({
      title: '邮箱验证失败',
      description: error.message || '验证链接无效或已过期，请重新注册。',
      success: false,
      appBaseUrl: getAppBaseUrl(req),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = Number(error.status) || 400;
    res.end(html);
  }
};
