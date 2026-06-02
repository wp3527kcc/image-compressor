const http = require('http');
const fs = require('fs');
const path = require('path');
const compressHandler = require('./api/compress');
const uploadHandler = require('./api/upload');
const cleanupHandler = require('./api/cleanup');

const PORT = process.env.PORT || 4000;

// MIME 类型映射
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  // API 路由
  const requestPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  const apiRoutes = {
    '/api/compress': compressHandler,
    '/api/upload': uploadHandler,
    '/api/cleanup': cleanupHandler,
  };
  const handler = apiRoutes[requestPath];

  if (handler) {
    // 模拟 Vercel 的 res.status().json() 方法
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    return handler(req, res);
  }

  // 静态文件服务
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
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
