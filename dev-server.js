require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const compressHandler = require('./api/compress');
const uploadHandler = require('./api/upload');   // Edge Function（Web API 风格）
const cleanupHandler = require('./api/cleanup');
const registerHandler = require('./api/auth/register');
const verifyEmailHandler = require('./api/auth/verify-email');
const loginHandler = require('./api/auth/login');
const logoutHandler = require('./api/auth/logout');
const meHandler = require('./api/auth/me');
const historyHandler = require('./api/history');

const PORT = process.env.PORT || 4000;

/**
 * Edge Function 适配器
 * 将 Node.js IncomingMessage/ServerResponse 转换为 Web API Request/Response，
 * 以便在本地开发时运行声明了 { runtime: 'edge' } 的 handler。
 */
async function callEdgeHandler(edgeHandler, req, res) {
  const protocol = 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `${protocol}://${host}${req.url}`;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuffer = Buffer.concat(chunks);

  const webRequest = new Request(url, {
    method: req.method,
    headers: new Headers(
      Object.fromEntries(
        Object.entries(req.headers).filter(([, v]) => typeof v === 'string')
      )
    ),
    body: req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
      ? bodyBuffer
      : undefined,
    // duplex 在 Node.js 18 fetch 中需要显式声明（流式 body）
    ...(req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0
      ? { duplex: 'half' } : {}),
  });

  const webResponse = await edgeHandler(webRequest);

  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => res.setHeader(name, value));
  const resBody = await webResponse.arrayBuffer();
  res.end(Buffer.from(resBody));
}

// MIME 类型映射
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  // API 路由
  const requestPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  // Edge Function 路由（返回 Web API Response 对象）
  if (requestPath === '/api/upload') {
    return callEdgeHandler(uploadHandler, req, res);
  }

  // 标准 Serverless Function 路由（Node.js req/res 风格）
  const serverlessRoutes = {
    '/api/compress': compressHandler,
    '/api/cleanup': cleanupHandler,
    '/api/auth/register': registerHandler,
    '/api/auth/verify-email': verifyEmailHandler,
    '/api/auth/login': loginHandler,
    '/api/auth/logout': logoutHandler,
    '/api/auth/me': meHandler,
    '/api/history': historyHandler,
  };
  const handler = serverlessRoutes[requestPath];

  if (handler) {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    return handler(req, res);
  }

  // 静态文件服务
  const staticRouteAliases = {
    '/': '/index.html',
    '/login': '/login.html',
    '/login/': '/login.html',
    '/register': '/register.html',
    '/register/': '/register.html',
  };
  const staticPath = staticRouteAliases[requestPath] || requestPath;
  let filePath = path.join(__dirname, 'public', staticPath);
  const ext = path.extname(filePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 本地开发服务器已启动: http://localhost:${PORT}`);
});
