import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '@shared/protocol';
import { Hub, type HubOptions } from './hub.js';
import { toSnapshot } from './tournament.js';
import type { Session } from './room.js';

export interface ServerOptions extends HubOptions {
  port: number;
  /** Thư mục chứa client web (build) để phục vụ trực tiếp, hoặc null */
  webRoot: string | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export interface RunningServer {
  hub: Hub;
  http: Server;
  port: number;
  close(): Promise<void>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const hub = new Hub(opts);
  const webRoot = opts.webRoot ? resolve(opts.webRoot) : null;

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type' });
      return void res.end();
    }
    if (path === '/health') return json(res, 200, { ok: true, rooms: hub.rooms.size, sessions: hub.sessions.size, uptime: Math.round(process.uptime()) });
    const rm = path.match(/^\/api\/rooms\/([A-Za-z0-9]{3,8})$/);
    if (rm) {
      const r = hub.rooms.get(rm[1].toUpperCase());
      if (!r || r.isClosed) return json(res, 404, { exists: false });
      return json(res, 200, { exists: true, mode: r.config.mode, teamMode: r.config.teamMode, maxPlayers: r.config.maxPlayers, players: r.activePlayers().length, status: r.status });
    }
    if (path === '/api/tournaments') {
      const list = [...hub.tournaments.values()].filter((t) => t.isPublic).map((t) => ({ code: t.code, name: t.name, size: t.size, entries: t.entries.length, status: t.status, format: t.format }));
      return json(res, 200, list);
    }
    const tm = path.match(/^\/api\/tournaments\/([A-Za-z0-9]{3,8})$/);
    if (tm) {
      const t = hub.tournaments.get(tm[1].toUpperCase());
      return t ? json(res, 200, toSnapshot(t)) : json(res, 404, { error: 'not_found' });
    }
    const inv = path.match(/^\/invite\/([A-Za-z0-9]{3,8})$/);
    if (inv) {
      // Trang mời: mở game (liên kết sâu) hoặc chơi ngay trên trình duyệt
      const code = inv[1].toUpperCase();
      res.writeHead(302, { Location: `/?room=${code}` });
      return void res.end();
    }
    if (!webRoot) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return void res.end('VIGO BILLIARDS PARTY server. WebSocket tại /ws');
    }
    // phục vụ file tĩnh
    let rel = normalize(path).replace(/^([/\\])+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let file = join(webRoot, rel);
    if (!file.startsWith(webRoot) || !existsSync(file) || !statSync(file).isFile()) file = join(webRoot, 'index.html');
    try {
      const body = readFileSync(file);
      const ext = extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws: WebSocket) => {
    const ctx: { session: Session | null; conn: { send(m: ServerMsg): void; close(): void } } = {
      session: null,
      conn: {
        send: (m) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
        },
        close: () => ws.close(4000, 'replaced'),
      },
    };
    // Giới hạn tốc độ: tối đa 40 thông điệp/giây (burst 80)
    let tokens = 80;
    let last = Date.now();
    let alive = true;
    ws.on('pong', () => (alive = true));
    const hb = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 20000);
    ws.on('message', (data) => {
      const now = Date.now();
      tokens = Math.min(80, tokens + ((now - last) / 1000) * 40);
      last = now;
      if (--tokens < 0) {
        ctx.conn.send({ t: 'error', code: 'rate_limited', message: 'Gửi quá nhanh' });
        return;
      }
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return ctx.conn.send({ t: 'error', code: 'bad_json', message: 'JSON không hợp lệ' });
      }
      hub.handle(ctx as never, msg);
    });
    ws.on('close', () => {
      clearInterval(hb);
      hub.onClose(ctx.session, ctx.conn as never);
    });
    ws.on('error', () => ws.terminate());
  });

  return new Promise((resolveP, reject) => {
    http.once('error', reject);
    http.listen(opts.port, () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolveP({
        hub,
        http,
        port,
        close: () =>
          new Promise<void>((r) => {
            hub.shutdown();
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => r());
          }),
      });
    });
  });
}
