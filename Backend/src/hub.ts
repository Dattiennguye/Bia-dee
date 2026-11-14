/**
 * Hub: điều phối toàn bộ phiên người chơi, phòng chơi và giải đấu.
 * Không phụ thuộc WebSocket: nhận ClientMsg, trả ServerMsg qua Conn.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILE_COUNTS, type ClientMsg, type Profile, type GameMode, RoomConfig, ServerMsg, TeamMode, TournamentSnapshot } from '@shared/protocol';
import { Room, DEFAULT_OPTIONS, type Conn, type RoomOptions, type Session } from './room.js';
import {
  forfeitMatch,
  minEntries,
  recordFrame,
  startTournament,
  toSnapshot,
  winsNeeded,
  type TEntry,
  type TournamentData,
} from './tournament.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len: number): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function sanitizeProf(p: unknown): Profile | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const o = p as Record<string, unknown>;
  const f = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < max ? (v as number) : 0);
  return { a: f(o.a, PROFILE_COUNTS.avatar), c: f(o.c, PROFILE_COUNTS.cue), f: f(o.f, PROFILE_COUNTS.fx) };
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const n = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n.length ? n : fallback;
}

const MODES: GameMode[] = ['eightball', 'nineball', 'rotation'];
const TEAM_MODES: TeamMode[] = ['solo', 'team'];

export interface HubOptions extends RoomOptions {
  dataDir: string | null;
}

export class Hub {
  readonly sessions = new Map<string, Session>();
  readonly rooms = new Map<string, Room>();
  readonly tournaments = new Map<string, TournamentData>();
  private watchers = new Map<string, Set<string>>(); // tournament code -> sessionIds
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly opts: HubOptions = { ...DEFAULT_OPTIONS, dataDir: null }) {
    this.load();
    this.gcTimer = setInterval(() => this.gc(), 5 * 60 * 1000);
    this.gcTimer.unref?.();
  }

  shutdown(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    for (const r of this.rooms.values()) r.close('Máy chủ đang bảo trì');
    this.saveNow();
  }

  // ---------- phiên ----------
  private err(conn: Conn, code: string, message: string): void {
    conn.send({ t: 'error', code, message });
  }

  /** Xử lý thông điệp từ một kết nối. `ctx.session` được thiết lập sau 'auth'. */
  handle(ctx: { session: Session | null; conn: Conn }, msg: ClientMsg): void {
    const { conn } = ctx;
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return this.err(conn, 'bad_request', 'Thông điệp không hợp lệ');
    if (msg.t === 'ping') {
      conn.send({ t: 'pong', c: Number((msg as { c: number }).c) || 0, serverTime: Date.now() });
      return;
    }
    if (msg.t === 'auth') {
      this.auth(ctx, msg);
      return;
    }
    const s = ctx.session;
    if (!s) return this.err(conn, 'unauthenticated', 'Chưa xác thực');
    s.lastSeen = Date.now();
    try {
      this.dispatch(s, msg);
    } catch (e) {
      this.err(conn, 'server_error', 'Lỗi máy chủ: ' + (e as Error).message);
    }
  }

  private auth(ctx: { session: Session | null; conn: Conn }, msg: Extract<ClientMsg, { t: 'auth' }>): void {
    let s = msg.sessionId ? this.sessions.get(String(msg.sessionId)) : undefined;
    if (!s) {
      const id = randomUUID();
      s = {
        sessionId: id,
        playerId: randomBytes(6).toString('hex'),
        name: sanitizeName(msg.name, 'Khách ' + (1000 + Math.floor(Math.random() * 9000))),
        prof: sanitizeProf(msg.prof),
        conn: null,
        roomCode: null,
        lastSeen: Date.now(),
      };
      this.sessions.set(id, s);
    } else {
      if (msg.name) s.name = sanitizeName(msg.name, s.name);
      if (msg.prof) s.prof = sanitizeProf(msg.prof);
    }
    // đá kết nối cũ (nếu có)
    const old = s.conn;
    s.conn = ctx.conn;
    ctx.session = s;
    s.lastSeen = Date.now();
    if (old && old !== ctx.conn) (old as { close?: () => void }).close?.();
    let room = s.roomCode ? this.rooms.get(s.roomCode) ?? null : null;
    if (room && room.isClosed) room = null;
    if (room) room.join(s); // kết nối lại
    else s.roomCode = null;
    ctx.conn.send({ t: 'auth.ok', sessionId: s.sessionId, playerId: s.playerId, name: s.name, serverTime: Date.now(), room: room ? room.snapshot() : null });
  }

  /** Gọi khi một kết nối WebSocket đóng */
  onClose(session: Session | null, conn: Conn): void {
    if (!session || session.conn !== conn) return;
    session.conn = null;
    const room = session.roomCode ? this.rooms.get(session.roomCode) : undefined;
    room?.onDisconnect(session.playerId);
  }

  private dispatch(s: Session, msg: ClientMsg): void {
    const conn = s.conn!;
    let room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    // Phòng đã kết thúc trận: tự rời khi người chơi bắt đầu việc khác
    if (room && (room.isClosed || (room.status === 'finished' && ['room.create', 'room.join', 'tour.joinMatch'].includes(msg.t)))) {
      if (!room.isClosed) room.leave(s.playerId);
      s.roomCode = null;
      room = undefined;
    }
    switch (msg.t) {
      case 'setProfile': {
        s.prof = sanitizeProf(msg.prof);
        if (room) room.broadcast({ t: 'room.state', room: room.snapshot() });
        return;
      }
      case 'emote': {
        room?.emote(s.playerId, Number(msg.e));
        return;
      }
      case 'setName': {
        s.name = sanitizeName(msg.name, s.name);
        return;
      }
      case 'room.create': {
        if (room && !room.isClosed) return this.err(conn, 'in_room', 'Bạn đang ở trong một phòng, hãy rời phòng trước');
        if (!MODES.includes(msg.mode) || !TEAM_MODES.includes(msg.teamMode)) return this.err(conn, 'bad_request', 'Chế độ không hợp lệ');
        const max = Number(msg.maxPlayers);
        if (![2, 3, 4].includes(max)) return this.err(conn, 'bad_request', 'Số người không hợp lệ');
        const v = Room.validate(msg.mode, msg.teamMode, max);
        if (v) return this.err(conn, 'bad_config', v);
        const bo = msg.bestOf ?? 1;
        if (![1, 3, 5].includes(bo)) return this.err(conn, 'bad_request', 'Thể thức không hợp lệ');
        if (this.rooms.size > 5000) return this.err(conn, 'busy', 'Máy chủ đang quá tải');
        const r = this.createRoom({ mode: msg.mode, teamMode: msg.teamMode, maxPlayers: max as 2 | 3 | 4, winsNeeded: winsNeeded(bo) });
        const e = r.join(s);
        if (e) return this.err(conn, 'join_failed', e);
        return;
      }
      case 'room.join': {
        if (room && !room.isClosed) return this.err(conn, 'in_room', 'Bạn đang ở trong một phòng, hãy rời phòng trước');
        const code = String(msg.code ?? '').trim().toUpperCase();
        const r = this.rooms.get(code);
        if (!r || r.isClosed) return this.err(conn, 'room_not_found', 'Không tìm thấy phòng ' + code);
        if (r.config.tournament) return this.err(conn, 'tournament_room', 'Đây là phòng của giải đấu, hãy vào từ danh sách trận');
        const e = r.join(s);
        if (e) return this.err(conn, 'join_failed', e);
        return;
      }
      case 'room.leave': {
        if (room) room.leave(s.playerId);
        s.roomCode = null;
        return;
      }
      case 'room.addBot': {
        if (!room) return this.err(conn, 'no_room', 'Bạn chưa ở trong phòng');
        const e = room.addBot(s.playerId);
        if (e) this.err(conn, 'cannot_add_bot', e);
        return;
      }
      case 'room.start': {
        if (!room) return this.err(conn, 'no_room', 'Bạn chưa ở trong phòng');
        const e = room.start(s.playerId);
        if (e) this.err(conn, 'cannot_start', e);
        return;
      }
      case 'game.place': {
        if (!room) return this.err(conn, 'no_room', 'Bạn chưa ở trong phòng');
        const e = room.place(s.playerId, Number(msg.x), Number(msg.y));
        if (e) this.err(conn, 'bad_place', e);
        return;
      }
      case 'game.shot': {
        if (!room) return this.err(conn, 'no_room', 'Bạn chưa ở trong phòng');
        const e = room.shoot(s.playerId, msg.shot, msg.cue);
        if (e) this.err(conn, 'bad_shot', e);
        return;
      }
      case 'game.aim': {
        room?.aim(s.playerId, Number(msg.angle), Number(msg.power));
        return;
      }
      case 'game.sync': {
        room?.sync(s.playerId);
        return;
      }
      default:
        break;
    }
    this.dispatchTournament(s, msg);
  }

  createRoom(config: RoomConfig): Room {
    let code = randomCode(5);
    while (this.rooms.has(code)) code = randomCode(5);
    const room = new Room(code, config, this.opts, {
      onFrameEnd: (r, info) => this.onFrameEnd(r, info),
      onEmpty: (r) => this.removeRoom(r),
    });
    this.rooms.set(code, room);
    return room;
  }

  private removeRoom(r: Room): void {
    this.rooms.delete(r.code);
  }

  // ---------- giải đấu ----------
  private dispatchTournament(s: Session, msg: ClientMsg): void {
    const conn = s.conn!;
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    const getT = (code: unknown): TournamentData | null => {
      const t = this.tournaments.get(String(code ?? '').trim().toUpperCase());
      if (!t) this.err(conn, 'tournament_not_found', 'Không tìm thấy giải đấu');
      return t ?? null;
    };
    const isAdmin = (t: TournamentData, token: unknown): boolean => {
      if (typeof token !== 'string' || !token) return false;
      const a = Buffer.from(hash(token));
      const b = Buffer.from(t.adminHash);
      return a.length === b.length && timingSafeEqual(a, b);
    };
    switch (msg.t) {
      case 'tour.create': {
        const size = Number(msg.size);
        if (![4, 8, 16, 32].includes(size)) return this.err(conn, 'bad_request', 'Số người phải là 4, 8, 16 hoặc 32');
        if (!['single', 'double', 'roundrobin', 'groupko'].includes(msg.format)) return this.err(conn, 'bad_request', 'Thể thức không hợp lệ');
        if (!MODES.includes(msg.gameMode) || !TEAM_MODES.includes(msg.teamMode)) return this.err(conn, 'bad_request', 'Chế độ không hợp lệ');
        if (![1, 3, 5].includes(Number(msg.bestOf))) return this.err(conn, 'bad_request', 'BO không hợp lệ');
        if (msg.teamMode === 'team' && msg.gameMode === 'rotation') {
          /* hợp lệ: Rotation theo đội */
        }
        if (this.tournaments.size > 2000) return this.err(conn, 'busy', 'Máy chủ đang quá tải');
        let code = randomCode(6);
        while (this.tournaments.has(code)) code = randomCode(6);
        const adminToken = randomBytes(16).toString('hex');
        const t: TournamentData = {
          code,
          name: sanitizeName(msg.name, 'Giải đấu ' + code),
          size: size as 4 | 8 | 16 | 32,
          format: msg.format,
          gameMode: msg.gameMode,
          teamMode: msg.teamMode,
          bestOf: msg.bestOf,
          isPublic: !!msg.isPublic,
          status: 'registration',
          adminHash: hash(adminToken),
          entries: [],
          matches: [],
          groups: [],
          koBuilt: false,
          champion: null,
          seed: Math.floor(Math.random() * 2 ** 31),
          createdAt: Date.now(),
        };
        this.tournaments.set(code, t);
        this.watch(code, s);
        this.save();
        conn.send({ t: 'tour.created', tournament: toSnapshot(t), adminToken });
        return;
      }
      case 'tour.list': {
        const list = [...this.tournaments.values()]
          .filter((t) => t.isPublic && t.status !== 'finished')
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 50)
          .map((t) => ({ code: t.code, name: t.name, size: t.size, entries: t.entries.length, status: t.status, format: t.format }));
        conn.send({ t: 'tour.list', tournaments: list });
        return;
      }
      case 'tour.watch': {
        const t = getT(msg.code);
        if (!t) return;
        this.watch(t.code, s);
        conn.send({ t: 'tour.state', tournament: toSnapshot(t) });
        return;
      }
      case 'tour.join': {
        const t = getT(msg.code);
        if (!t) return;
        if (t.status !== 'registration') return this.err(conn, 'registration_closed', 'Giải đã khóa đăng ký');
        if (t.entries.some((e) => e.memberIds.includes(s.playerId))) return this.err(conn, 'already_joined', 'Bạn đã đăng ký giải này');
        if (t.teamMode === 'team') {
          const teamName = sanitizeName(msg.teamName, '');
          if (!teamName) return this.err(conn, 'bad_request', 'Cần đặt tên đội');
          const ex = t.entries.find((e) => e.name.toLowerCase() === teamName.toLowerCase());
          if (ex) {
            if (ex.memberIds.length >= 2) return this.err(conn, 'team_full', 'Đội đã đủ 2 người');
            ex.memberIds.push(s.playerId);
            ex.memberNames.push(s.name);
          } else {
            if (t.entries.length >= t.size) return this.err(conn, 'tournament_full', 'Giải đã đủ đội');
            t.entries.push(newEntry(t, teamName, s));
          }
        } else {
          if (t.entries.length >= t.size) return this.err(conn, 'tournament_full', 'Giải đã đủ người');
          t.entries.push(newEntry(t, s.name, s));
        }
        this.watch(t.code, s);
        this.touch(t);
        return;
      }
      case 'tour.leave': {
        const t = getT(msg.code);
        if (!t) return;
        if (t.status !== 'registration') return this.err(conn, 'registration_closed', 'Giải đã khóa đăng ký');
        const e = t.entries.find((x) => x.memberIds.includes(s.playerId));
        if (!e) return;
        const i = e.memberIds.indexOf(s.playerId);
        e.memberIds.splice(i, 1);
        e.memberNames.splice(i, 1);
        if (e.memberIds.length === 0) t.entries = t.entries.filter((x) => x !== e);
        this.touch(t);
        return;
      }
      case 'tour.lock': {
        const t = getT(msg.code);
        if (!t) return;
        if (!isAdmin(t, msg.adminToken)) return this.err(conn, 'forbidden', 'Sai mã quản lý giải');
        if (t.status === 'registration') t.status = 'locked';
        this.touch(t);
        return;
      }
      case 'tour.start': {
        const t = getT(msg.code);
        if (!t) return;
        if (!isAdmin(t, msg.adminToken)) return this.err(conn, 'forbidden', 'Sai mã quản lý giải');
        if (t.status !== 'registration' && t.status !== 'locked') return this.err(conn, 'bad_state', 'Giải đã bắt đầu');
        if (t.teamMode === 'team' && t.entries.some((e) => e.memberIds.length < 2)) return this.err(conn, 'incomplete_teams', 'Còn đội chưa đủ 2 người');
        if (t.entries.length < minEntries(t.format)) return this.err(conn, 'not_enough', `Cần ít nhất ${minEntries(t.format)} ${t.teamMode === 'team' ? 'đội' : 'người'}`);
        startTournament(t);
        this.touch(t);
        return;
      }
      case 'tour.forfeit': {
        const t = getT(msg.code);
        if (!t) return;
        if (!isAdmin(t, msg.adminToken)) return this.err(conn, 'forbidden', 'Sai mã quản lý giải');
        const m = t.matches.find((x) => x.id === msg.matchId);
        if (m?.roomCode) this.rooms.get(m.roomCode)?.close('Người tổ chức đã xử thua một bên');
        if (!forfeitMatch(t, String(msg.matchId), String(msg.entryId))) return this.err(conn, 'bad_request', 'Không xử thua được trận này');
        this.touch(t);
        return;
      }
      case 'tour.joinMatch': {
        const t = getT(msg.code);
        if (!t) return;
        const m = t.matches.find((x) => x.id === msg.matchId);
        if (!m || !m.a || !m.b || m.bye) return this.err(conn, 'bad_request', 'Trận đấu chưa sẵn sàng');
        if (m.status === 'done') return this.err(conn, 'bad_state', 'Trận đấu đã kết thúc');
        const ea = t.entries.find((e) => e.id === m.a)!;
        const eb = t.entries.find((e) => e.id === m.b)!;
        const team = ea.memberIds.includes(s.playerId) ? 0 : eb.memberIds.includes(s.playerId) ? 1 : -1;
        if (team < 0) return this.err(conn, 'forbidden', 'Bạn không thuộc trận đấu này');
        let r = m.roomCode ? this.rooms.get(m.roomCode) : undefined;
        if (r && r.isClosed) r = undefined;
        if (room && room !== r) return this.err(conn, 'in_room', 'Bạn đang ở trong một phòng khác');
        if (!r) {
          const players = t.teamMode === 'team' ? 4 : 2;
          r = this.createRoom({
            mode: t.gameMode,
            teamMode: t.teamMode,
            maxPlayers: players as 2 | 4,
            winsNeeded: winsNeeded(t.bestOf),
            tournament: { code: t.code, matchId: m.id },
          });
          r.seatPlan = new Map();
          for (const id of ea.memberIds) r.seatPlan.set(id, 0);
          for (const id of eb.memberIds) r.seatPlan.set(id, 1);
          m.roomCode = r.code;
          if (m.status === 'ready') m.status = 'playing';
          this.touch(t);
        }
        const e = r.join(s);
        if (e) return this.err(conn, 'join_failed', e);
        conn.send({ t: 'tour.matchRoom', code: t.code, matchId: m.id, roomCode: r.code });
        return;
      }
      default:
        this.err(conn, 'unknown_message', 'Thông điệp không được hỗ trợ: ' + (msg as { t: string }).t);
    }
  }

  private onFrameEnd(r: Room, info: { winnerTeam: number; matchOver: boolean; forfeitTeam: number | null }): void {
    const ref = r.config.tournament;
    if (!ref) return;
    const t = this.tournaments.get(ref.code);
    if (!t) return;
    const m = t.matches.find((x) => x.id === ref.matchId);
    if (!m || m.status === 'done' || !m.a || !m.b) return;
    let done: boolean;
    if (info.forfeitTeam !== null) {
      done = forfeitMatch(t, m.id, info.forfeitTeam === 0 ? m.a : m.b);
    } else {
      done = recordFrame(t, m.id, info.winnerTeam === 0 ? m.a : m.b);
    }
    this.touch(t);
    if (done) {
      // đóng phòng sau khi người chơi kịp xem kết quả
      setTimeout(() => {
        if (!r.isClosed) r.close('Trận đấu giải đã kết thúc');
        this.removeRoom(r);
      }, 30000).unref?.();
    }
  }

  private watch(code: string, s: Session): void {
    let set = this.watchers.get(code);
    if (!set) this.watchers.set(code, (set = new Set()));
    set.add(s.sessionId);
  }

  /** Lưu và thông báo cho những người đang theo dõi giải */
  private touch(t: TournamentData): void {
    const snap: TournamentSnapshot = toSnapshot(t);
    for (const id of this.watchers.get(t.code) ?? []) {
      this.sessions.get(id)?.conn?.send({ t: 'tour.state', tournament: snap });
    }
    this.save();
  }

  // ---------- lưu trữ ----------
  private file(): string | null {
    return this.opts.dataDir ? join(this.opts.dataDir, 'tournaments.json') : null;
  }

  private load(): void {
    const f = this.file();
    if (!f || !existsSync(f)) return;
    try {
      const arr = JSON.parse(readFileSync(f, 'utf8')) as TournamentData[];
      for (const t of arr) {
        // phòng đã mất khi máy chủ khởi động lại
        for (const m of t.matches) {
          m.roomCode = null;
          if (m.status === 'playing') m.status = 'ready';
        }
        this.tournaments.set(t.code, t);
      }
    } catch (e) {
      console.error('Không đọc được dữ liệu giải đấu:', (e as Error).message);
    }
  }

  private save(): void {
    if (!this.file() || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 500);
    this.saveTimer.unref?.();
  }

  saveNow(): void {
    const f = this.file();
    if (!f) return;
    try {
      mkdirSync(this.opts.dataDir!, { recursive: true });
      const tmp = f + '.tmp';
      writeFileSync(tmp, JSON.stringify([...this.tournaments.values()]));
      renameSync(tmp, f);
    } catch (e) {
      console.error('Không lưu được dữ liệu giải đấu:', (e as Error).message);
    }
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (!s.conn && !s.roomCode && now - s.lastSeen > 6 * 3600 * 1000) this.sessions.delete(id);
    }
    for (const [code, t] of this.tournaments) {
      if (t.status === 'finished' && now - t.createdAt > 30 * 24 * 3600 * 1000) this.tournaments.delete(code);
    }
    for (const [code, r] of this.rooms) if (r.isClosed) this.rooms.delete(code);
  }
}

function newEntry(t: TournamentData, name: string, s: Session): TEntry {
  let n = t.entries.length + 1;
  while (t.entries.some((e) => e.id === `E${n}`)) n++;
  return { id: `E${n}`, name, memberIds: [s.playerId], memberNames: [s.name] };
}
