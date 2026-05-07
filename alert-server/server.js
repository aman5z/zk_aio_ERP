const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;
const ADMIN_PASSWORD = 'school2024'; // CHANGE THIS

let clients = []; // SSE teacher connections
let lastAlert = null;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS headers for local network
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve admin page
  if (pathname === '/' || pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'admin.html')));
    return;
  }

  // Serve teacher alert page
  if (pathname === '/alert') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'teacher.html')));
    return;
  }

  // SSE endpoint - teachers connect here
  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('data: {"type":"connected"}\n\n');

    // Send last alert if exists (so late-joiners see it)
    if (lastAlert) {
      res.write(`data: ${JSON.stringify(lastAlert)}\n\n`);
    }

    clients.push(res);
    console.log(`Teacher connected. Total: ${clients.length}`);

    req.on('close', () => {
      clients = clients.filter(c => c !== res);
      console.log(`Teacher disconnected. Total: ${clients.length}`);
    });
    return;
  }

  // Admin sends alert
  if (pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.password !== ADMIN_PASSWORD) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Wrong password' }));
          return;
        }
        lastAlert = {
          type: 'alert',
          level: data.level || 'high',
          title: data.title || 'EMERGENCY ALERT',
          message: data.message || '',
          instructions: data.instructions || '',
          timestamp: new Date().toISOString()
        };
        // Broadcast to all teachers
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify(lastAlert)}\n\n`);
        });
        console.log(`Alert sent to ${clients.length} teachers`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reached: clients.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }

  // Admin clears/all-clear
  if (pathname === '/clear' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.password !== ADMIN_PASSWORD) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Wrong password' }));
          return;
        }
        lastAlert = null;
        const clearMsg = { type: 'clear', timestamp: new Date().toISOString() };
        clients.forEach(client => {
          client.write(`data: ${JSON.stringify(clearMsg)}\n\n`);
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  // Status
  if (pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: clients.length, hasAlert: !!lastAlert }));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚨 School Alert Server running on port ${PORT}`);
  console.log(`   Admin panel:  http://localhost:${PORT}/`);
  console.log(`   Teacher page: http://localhost:${PORT}/alert`);
  console.log(`   Admin password: ${ADMIN_PASSWORD}\n`);
});
