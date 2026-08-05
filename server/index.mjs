/**
 * Scoreboard server — serves the board, the API and the uploaded photos.
 *
 * No dependencies: this has to start on a studio machine years from now
 * without an npm install working. Live state is pushed to every open board
 * over SSE, so a second screen follows the operator without any setup.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import * as db from './db.mjs';
import * as auth from './auth.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = join(root, 'dist');
const PORT = Number(process.env.PORT || 4321);
// Matches carry cropped avatars inline, so bodies are bigger than plain JSON.
const MAX_BODY = 12 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

/* ── plumbing ──────────────────────────────────────────── */

const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
};

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('ไฟล์ใหญ่เกินไป'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const readJson = async (req) => {
  const raw = (await readBody(req)).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

/* ── live updates ──────────────────────────────────────── */

const clients = new Set();

function broadcast(type, payload) {
  const frame = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const res of clients) res.write(frame);
}

/* ── API ───────────────────────────────────────────────── */

async function api(req, res, url) {
  const path = url.pathname;
  const method = req.method;
  const gate = () => {
    if (auth.authed(req)) return true;
    send(res, 401, { error: 'ต้องปลดล็อกก่อน' });
    return false;
  };

  if (path === '/api/bootstrap' && method === 'GET') {
    const { match, presets, version } = db.read();
    return send(res, 200, { match, presets, version: version || 0, authed: auth.authed(req) });
  }

  // Same shape as the serverless deployment so one client works against both.
  if (path === '/api/version' && method === 'GET') {
    return send(res, 200, { version: db.read().version || 0 });
  }

  if (path === '/api/login' && method === 'POST') {
    const { password } = await readJson(req);
    const token = auth.check(password);
    if (!token) return send(res, 403, { error: 'รหัสไม่ถูกต้อง' });
    return send(res, 200, { authed: true }, {
      'set-cookie': `${auth.COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
    });
  }

  if (path === '/api/logout' && method === 'POST') {
    return send(res, 200, { authed: false }, {
      'set-cookie': `${auth.COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
  }

  if (path === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return undefined;
  }

  if (path === '/api/match' && method === 'PUT') {
    if (!gate()) return undefined;
    const match = await readJson(req);
    if (!match?.teams?.a || !match?.teams?.b) return send(res, 400, { error: 'รูปแบบไม่ถูกต้อง' });
    db.read().match = match;
    db.commit();
    // Tag the sender so its own echo doesn't bounce back and fight local state.
    broadcast('match', { match, from: req.headers['x-client-id'] || '' });
    return send(res, 200, { ok: true });
  }

  if (path === '/api/presets' && method === 'POST') {
    if (!gate()) return undefined;
    const { name, teams, rules } = await readJson(req);
    if (!name?.trim()) return send(res, 400, { error: 'ต้องตั้งชื่อ preset' });
    const preset = { id: db.newId('P'), name: name.trim(), teams, rules, createdAt: Date.now() };
    db.read().presets.push(preset);
    db.commit();
    broadcast('presets', { presets: db.read().presets });
    return send(res, 200, { preset, presets: db.read().presets });
  }

  if (path === '/api/presets' && method === 'DELETE') {
    if (!gate()) return undefined;
    const id = url.searchParams.get('id');
    const list = db.read().presets;
    const i = list.findIndex((p) => p.id === id);
    if (i === -1) return send(res, 404, { error: 'ไม่พบ preset' });
    list.splice(i, 1);
    db.commit();
    broadcast('presets', { presets: list });
    return send(res, 200, { ok: true, presets: list });
  }

  return send(res, 404, { error: 'ไม่มี endpoint นี้' });
}

/* ── static ────────────────────────────────────────────── */

function serveFile(res, file, { immutable = false } = {}) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    send(res, 404, { error: 'ไม่พบไฟล์' });
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

/** Resolve inside `base` only — a request must never escape the served folder. */
function safeJoin(base, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const full = join(base, rel);
  return full.startsWith(base) ? full : null;
}

/* ── boot ──────────────────────────────────────────────── */

await db.open();
const password = await auth.init();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);

    if (!existsSync(WEB_DIR)) {
      return send(res, 503, '<h1>ยังไม่ได้ build หน้าเว็บ — สั่ง npm run build ก่อน</h1>', {
        'content-type': 'text/html; charset=utf-8',
      });
    }

    // Only /assets/ carries content hashes, so only /assets/ may be frozen.
    // index.html must always revalidate or a studio machine would keep loading
    // last week's board forever.
    const file = url.pathname === '/' ? join(WEB_DIR, 'index.html') : safeJoin(WEB_DIR, url.pathname);
    if (!file) return send(res, 400, { error: 'path ไม่ถูกต้อง' });
    if (!existsSync(file)) return serveFile(res, join(WEB_DIR, 'index.html'));
    return serveFile(res, file, { immutable: url.pathname.startsWith('/assets/') });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  console.log('\n  Scoreboard พร้อมใช้งาน\n');
  console.log(`    เครื่องนี้      http://localhost:${PORT}`);
  for (const ip of lan) console.log(`    ในสตูดิโอ      http://${ip}:${PORT}`);
  console.log(`\n    รหัสปลดล็อก    ${password}`);
  console.log(`    ข้อมูล         ${db.DATA_DIR}\n`);
});
