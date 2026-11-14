import type { ClientMsg, GameMode, Profile, ServerMsg, TeamMode } from '@shared/protocol';
import { LocalServer } from './local';

export type NetStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';

type Handler = (m: ServerMsg) => void;

const LS = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* bỏ qua */ }
  },
};
export { LS };

/** Địa chỉ máy chủ mặc định: lúc build (VITE_SERVER_URL), hoặc cùng máy chủ đã phục vụ trang web. */
export function defaultServerUrl(): string {
  const built = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').trim();
  if (built) return built;
  const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  if (native || location.protocol === 'file:') return ''; // ứng dụng đóng gói: người dùng nhập địa chỉ máy chủ
  if (location.port === '5173') return 'ws://localhost:8080'; // vite dev
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
}

export function normalizeServer(u: string): string {
  let s = u.trim();
  if (!s) return '';
  if (!/^wss?:\/\//i.test(s)) {
    if (/^https:\/\//i.test(s)) s = s.replace(/^https:/i, 'wss:');
    else if (/^http:\/\//i.test(s)) s = s.replace(/^http:/i, 'ws:');
    else s = (/^(localhost|127\.|10\.|192\.168\.)/.test(s) ? 'ws://' : 'wss://') + s;
  }
  return s.replace(/\/+$/, '').replace(/\/ws$/, '');
}

export class Net {
  status: NetStatus = 'idle';
  sessionId = LS.get('vigo.session') ?? '';
  playerId = '';
  name = LS.get('vigo.name') ?? '';
  /** serverTime - Date.now() */
  clockOffset = 0;
  rtt = 0;
  server = normalizeServer(LS.get('vigo.server') ?? '') || normalizeServer(defaultServerUrl());
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<(s: NetStatus) => void>();
  private retry = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private wantOnline = false;
  private pingSentAt = 0;
  private queue: ClientMsg[] = [];
  lastError = '';
  local: LocalServer | null = null;
  prof: Profile | undefined;

  setProfile(p: Profile): void {
    this.prof = p;
    if (this.status === 'online') this.send({ t: 'setProfile', prof: p });
    this.local?.handle({ t: 'setProfile', prof: p });
  }

  /** Bắt đầu ván offline với máy (không cần máy chủ) */
  startLocal(mode: GameMode, teamMode: TeamMode, maxPlayers: 2 | 3 | 4, bestOf: 1 | 3 | 5): void {
    this.local?.stop();
    this.local = new LocalServer(this.name || 'Bạn', (m) => this.emit(m), this.prof);
    this.playerId = this.local.session.playerId;
    this.local.createAndStart(mode, teamMode, maxPlayers, bestOf);
  }

  stopLocal(): void {
    this.local?.stop();
    this.local = null;
    this.playerId = this.serverPlayerId;
  }

  private serverPlayerId = '';
  private emit(m: ServerMsg): void { for (const h of this.handlers) h(m); }

  onMessage(h: Handler): () => void { this.handlers.add(h); return () => this.handlers.delete(h); }
  onStatus(h: (s: NetStatus) => void): () => void { this.statusHandlers.add(h); return () => this.statusHandlers.delete(h); }

  private setStatus(s: NetStatus) {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  setServer(url: string) {
    this.server = normalizeServer(url);
    LS.set('vigo.server', this.server);
    this.disconnect();
    if (this.server) this.connect();
  }

  setName(n: string) {
    this.name = n.trim().slice(0, 16);
    LS.set('vigo.name', this.name);
    if (this.status === 'online') this.send({ t: 'setName', name: this.name });
  }

  connect(): void {
    this.wantOnline = true;
    if (!this.server) { this.setStatus('offline'); this.lastError = 'Chưa cấu hình địa chỉ máy chủ'; return; }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus(this.retry > 0 || this.sessionId ? (this.retry > 0 ? 'reconnecting' : 'connecting') : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.server + '/ws');
    } catch (e) {
      this.lastError = (e as Error).message;
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'auth', sessionId: this.sessionId || undefined, name: this.name || undefined, prof: this.prof }));
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data as string); } catch { return; }
      if (m.t === 'auth.ok') {
        this.sessionId = m.sessionId;
        this.playerId = this.local ? this.playerId : m.playerId;
        this.serverPlayerId = m.playerId;
        if (!this.name) this.name = m.name;
        LS.set('vigo.session', m.sessionId);
        LS.set('vigo.name', this.name);
        this.clockOffset = m.serverTime - Date.now();
        this.retry = 0;
        this.setStatus('online');
        this.startPing();
        for (const q of this.queue.splice(0)) this.send(q);
      } else if (m.t === 'pong') {
        this.rtt = Date.now() - this.pingSentAt;
        this.clockOffset = m.serverTime + this.rtt / 2 - Date.now();
      }
      this.emit(m);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.stopPing();
      if (this.wantOnline) this.scheduleRetry();
      else this.setStatus('idle');
    };
    ws.onerror = () => { this.lastError = 'Không kết nối được máy chủ'; };
  }

  disconnect(): void {
    this.wantOnline = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus('idle');
  }

  private scheduleRetry(): void {
    this.retry++;
    this.setStatus('reconnecting');
    const delay = Math.min(8000, 500 * 2 ** Math.min(this.retry, 4));
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  /** Gọi khi ứng dụng quay lại màn hình hoặc mạng được khôi phục */
  nudge(): void {
    if (!this.wantOnline) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.connect();
    } else {
      this.send({ t: 'game.sync' });
    }
  }

  private startPing() {
    this.stopPing();
    const tick = () => { this.pingSentAt = Date.now(); this.rawSend({ t: 'ping', c: this.pingSentAt }); };
    tick();
    this.pingTimer = window.setInterval(tick, 5000);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private rawSend(m: ClientMsg): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(m)); return true; }
    return false;
  }

  send(m: ClientMsg): void {
    if (this.local) { this.local.handle(m); return; }
    if (!this.rawSend(m) && m.t !== 'game.aim' && m.t !== 'ping') this.queue.push(m);
  }

  get serverNow(): number { return Date.now() + this.clockOffset; }
}
