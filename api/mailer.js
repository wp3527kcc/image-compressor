const nodemailer = require('nodemailer');

let cachedTransporter = null;
let cachedFingerprint = '';

function getMailerConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number.parseInt(String(process.env.SMTP_PORT || ''), 10);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_FROM || user).trim();

  if (!host || !Number.isFinite(port) || !user || !pass) {
    throw new Error('缺少 SMTP 邮件配置');
  }

  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    from,
  };
}

function getTransporter() {
  const config = getMailerConfig();
  const fingerprint = JSON.stringify({
    host: config.host,
    port: config.port,
    user: config.user,
    from: config.from,
  });
  if (!cachedTransporter || cachedFingerprint !== fingerprint) {
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
    cachedFingerprint = fingerprint;
  }
  return {
    transporter: cachedTransporter,
    from: config.from,
  };
}

async function sendVerificationEmail({ to, verifyUrl }) {
  const { transporter, from } = getTransporter();
  await transporter.sendMail({
    from,
    to,
    subject: '请验证你的邮箱地址',
    text: `欢迎注册图片压缩服务，请在 24 小时内访问以下链接完成验证：\n${verifyUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;">
        <p>欢迎注册图片压缩服务。</p>
        <p>请在 24 小时内点击下方链接完成邮箱验证：</p>
        <p><a href="${verifyUrl}" target="_blank" rel="noopener noreferrer">${verifyUrl}</a></p>
        <p>如果你没有发起注册，请忽略此邮件。</p>
      </div>
    `,
  });
}

module.exports = {
  sendVerificationEmail,
};
