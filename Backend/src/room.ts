/**
 * Phòng chơi: quản lý người chơi, lượt đánh, đồng hồ, mất kết nối/kết nối lại, nhiều ván (BO1/3/5).
 * Máy chủ là nguồn xác nhận cuối cùng: mọi cú đánh đều được mô phỏng và kiểm luật tại đây.
 */
import {
  EMOTE_COUNT,
  FRAME_HZ,
  PROFILE_COUNTS,
  type GameMode,
  type Profile,
  type PlayerPublic,
  type RoomConfig,
  type RoomSnapshot,
  type ServerMsg,
  type ShotInput,
  type TeamMode,
} from '@shared/protocol';
import { Game } from '@gameserver/game';
import { chooseMove } from '@gameserver/ai';
import { mulberry32 } from '@gameserver/rack';
import { teamCount, teamOf, validateConfig } from '@gameserver/rules';

export interface Conn {
  send(msg: ServerMsg): void;
}

export interface Session {
  sessionId: string;
  playerId: string;
  name: string;
  conn: Conn | null;
  roomCode: string | null;
  lastSeen: number;
  prof?: Profile;
}

export interface RoomOptions {
  turnTimeMs: number;
  graceMs: number;
  botDelayMs: number;
  /** Hệ số thời gian chờ hoạt ảnh (1 = thật, 0 = không chờ — dùng khi kiểm thử) */
  animScale: number;
  nextFrameDelayMs: number;
  publicUrl: string;
}

export const DEFAULT_OPTIONS: RoomOptions = {
  turnTimeMs: 60000,
  graceMs: 60000,
  botDelayMs: 1200,
  animScale: 1,
  nextFrameDelayMs: 4000,
  publicUrl: 'http://localhost:8080',
};

export interface RoomHooks {
  /** Một ván kết thúc. forfeitTeam != null nếu do bỏ cuộc. */
  onFrameEnd?(room: Room, info: { winnerTeam: number; matchOver: boolean; forfeitTeam: number | null }): void;
  onEmpty?(room: Room): void;
  onChange?(room: Room): void;
}

interface RoomPlayer {
  id: string;
  name: string;
  seat: number;
  isBot: boolean;
  connected: boolean;
  session: Session | null;
  left: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  prof?: Profile;
  lastEmote?: number;
}

export class Room {
  readonly code: string;
  readonly config: RoomConfig;
  status: RoomSnapshot['status'] = 'lobby';
  players: RoomPlayer[] = [];
  hostId = '';
  frameWins: number[];
  frameNo = 0;
  game: Game | null = null;
  /** Kế hoạch ghế cho phòng giải đấu: playerId -> đội */
  seatPlan: Map<string, number> | null = null;

  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;
  private turnRemaining: number | null = null;
  private animUntil = 0;
  private seq = 0;
  private broken = false;
  private forfeitTeam: number | null = null;
  private closed = false;
  private rnd: () => number;

  constructor(
    code: string,
    config: RoomConfig,
    private opts: RoomOptions,
    private hooks: RoomHooks = {},
  ) {
    this.code = code;
    this.config = config;
    this.frameWins = new Array(teamCount({ mode: config.mode, teamMode: config.teamMode, seats: config.maxPlayers })).fill(0);
    this.rnd = mulberry32(Math.floor(Math.random() * 2 ** 31));
  }

  static validate(mode: GameMode, teamMode: TeamMode, maxPlayers: number): string | null {
    return validateConfig({ mode, teamMode, seats: maxPlayers });
  }

  // ---------- thông tin ----------
  private cfg() {
    return { mode: this.config.mode, teamMode: this.config.teamMode, seats: this.config.maxPlayers };
  }

  activePlayers(): RoomPlayer[] {
    return this.players.filter((p) => !p.left);
  }

  humanCount(): number {
    return this.activePlayers().filter((p) => !p.isBot).length;
  }

  playerById(id: string): RoomPlayer | undefined {
    return this.activePlayers().find((p) => p.id === id);
  }

  publicPlayers(): PlayerPublic[] {
    return this.activePlayers()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        team: teamOf(this.cfg(), p.seat),
        connected: p.connected,
        isBot: p.isBot,
        isHost: p.id === this.hostId,
        prof: p.isBot ? p.prof : p.session?.prof,
      }));
  }

  snapshot(simulating = false): RoomSnapshot {
    return {
      code: this.code,
      config: this.config,
      status: this.status,
      players: this.publicPlayers(),
      frameWins: this.frameWins.slice(),
      frameNo: this.frameNo,
      game: this.game ? this.game.snapshot(this.turnDeadline, simulating || Date.now() < this.animUntil) : null,
      inviteUrl: `${this.opts.publicUrl}/invite/${this.code}`,
    };
  }

  /** Biểu cảm nhanh (giới hạn tốc độ) */
  emote(playerId: string, e: number): void {
    const p = this.activePlayers().find((x) => x.id === playerId);
    if (!p || !Number.isInteger(e) || e < 0 || e >= EMOTE_COUNT) return;
    const now = Date.now();
    if (p.lastEmote && now - p.lastEmote < 1200) return;
    p.lastEmote = now;
    this.broadcast({ t: 'emote', seat: p.seat, e });
  }

  broadcast(msg: ServerMsg): void {
    for (const p of this.activePlayers()) p.session?.conn?.send(msg);
  }

  private changed(): void {
    this.hooks.onChange?.(this);
  }

  // ---------- vào / ra phòng ----------
  private freeSeat(preferTeam?: number): number {
    const used = new Set(this.activePlayers().map((p) => p.seat));
    for (let s = 0; s < this.config.maxPlayers; s++) {
      if (used.has(s)) continue;
      if (preferTeam !== undefined && teamOf(this.cfg(), s) !== preferTeam) continue;
      return s;
    }
    return -1;
  }

  join(session: Session): string | null {
    const existing = this.playerById(session.playerId);
    if (existing) {
      this.attach(existing, session);
      return null;
    }
    if (this.status !== 'lobby') return 'Trận đấu đã bắt đầu';
    const team = this.seatPlan?.get(session.playerId);
    if (this.seatPlan && team === undefined) return 'Bạn không thuộc trận đấu này';
    const seat = this.freeSeat(team);
    if (seat < 0) return 'Phòng đã đầy';
    const player: RoomPlayer = { id: session.playerId, name: session.name, seat, isBot: false, connected: true, session, left: false, graceTimer: null };
    this.players.push(player);
    if (!this.hostId || !this.playerById(this.hostId) || this.playerById(this.hostId)!.isBot) this.hostId = player.id;
    session.roomCode = this.code;
    this.broadcast({ t: 'room.state', room: this.snapshot() });
    this.changed();
    // phòng giải đấu tự bắt đầu khi đủ người
    if (this.config.tournament && this.activePlayers().length === this.config.maxPlayers) {
      setTimeout(() => {
        if (!this.closed && this.status === 'lobby' && this.activePlayers().length === this.config.maxPlayers) this.begin();
      }, 1500 * this.opts.animScale);
    }
    return null;
  }

  /** Người chơi kết nối lại (cùng session) */
  private attach(p: RoomPlayer, session: Session): void {
    p.session = session;
    p.connected = true;
    p.name = session.name;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    session.roomCode = this.code;
    this.broadcast({ t: 'player.status', playerId: p.id, connected: true, graceMs: 0 });
    // nếu đang chờ lượt của người này thì chạy tiếp đồng hồ
    if (this.game && this.status === 'playing' && this.game.currentSeat === p.seat && this.turnRemaining !== null) {
      this.startTurnTimer(this.turnRemaining);
    }
    this.broadcast({ t: 'room.state', room: this.snapshot() });
  }

  onDisconnect(playerId: string): void {
    const p = this.playerById(playerId);
    if (!p || p.isBot) return;
    p.connected = false;
    this.broadcast({ t: 'player.status', playerId: p.id, connected: false, graceMs: this.opts.graceMs });
    // tạm dừng đồng hồ nếu đang đến lượt người này
    if (this.game && this.status === 'playing' && this.game.currentSeat === p.seat && this.turnDeadline !== null) {
      this.turnRemaining = Math.max(5000, this.turnDeadline - Date.now());
      this.clearTurnTimer();
      this.turnDeadline = null;
    }
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = setTimeout(() => this.removePlayer(p.id, true), this.opts.graceMs);
    this.broadcast({ t: 'room.state', room: this.snapshot() });
    if (this.humanCount() > 0 && this.activePlayers().filter((x) => !x.isBot && x.connected).length === 0) {
      // tất cả người thật mất kết nối: vẫn giữ phòng trong thời gian chờ
    }
  }

  leave(playerId: string): void {
    this.removePlayer(playerId, false);
  }

  private removePlayer(playerId: string, timedOut: boolean): void {
    const p = this.playerById(playerId);
    if (!p) return;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    if (p.session && p.session.roomCode === this.code) p.session.roomCode = null;
    if (this.status === 'playing' && this.game && this.game.phase === 'playing') {
      this.broken = true;
      const team = teamOf(this.cfg(), p.seat);
      p.left = true;
      p.connected = false;
      this.game.forfeit(p.seat);
      this.broadcast({ t: 'player.status', playerId: p.id, connected: false, graceMs: 0 });
      if (this.game.isOver()) {
        this.forfeitTeam = team;
        this.endFrame(true);
      } else {
        // bàn nhiều người: ván tiếp tục không có người này
        this.afterTurnChange(0);
        this.broadcast({ t: 'game.state', room: this.snapshot() });
      }
    } else {
      p.left = true;
      p.connected = false;
      if (this.status === 'lobby') {
        if (this.hostId === p.id) {
          const nh = this.activePlayers().find((x) => !x.isBot);
          if (nh) this.hostId = nh.id;
        }
        this.broadcast({ t: 'room.state', room: this.snapshot() });
      }
    }
    void timedOut;
    if (this.humanCount() === 0) {
      this.close('Phòng không còn người chơi');
      this.hooks.onEmpty?.(this);
    } else {
      this.changed();
    }
  }

  addBot(byPlayerId: string): string | null {
    if (byPlayerId !== this.hostId) return 'Chỉ chủ phòng mới thêm được máy';
    if (this.status !== 'lobby') return 'Chỉ thêm máy ở phòng chờ';
    if (this.config.tournament) return 'Phòng giải đấu không dùng máy';
    const seat = this.freeSeat();
    if (seat < 0) return 'Phòng đã đầy';
    const n = this.players.filter((p) => p.isBot).length + 1;
    const rnd = (k: number) => Math.floor(Math.random() * k);
    this.players.push({ id: `bot${n}-${this.code}`, name: `Máy ${n}`, seat, isBot: true, connected: true, session: null, left: false, graceTimer: null, prof: { a: rnd(PROFILE_COUNTS.avatar), c: rnd(PROFILE_COUNTS.cue), f: rnd(PROFILE_COUNTS.fx) } });
    this.broadcast({ t: 'room.state', room: this.snapshot() });
    this.changed();
    return null;
  }

  // ---------- bắt đầu / ván đấu ----------
  start(byPlayerId: string): string | null {
    if (byPlayerId !== this.hostId) return 'Chỉ chủ phòng mới bắt đầu được';
    if (this.status === 'playing') return 'Trận đang diễn ra';
    if (this.activePlayers().length !== this.config.maxPlayers) {
      return `Cần đủ ${this.config.maxPlayers} người (còn thiếu ${this.config.maxPlayers - this.activePlayers().length})`;
    }
    this.begin();
    return null;
  }

  private begin(): void {
    this.frameWins = this.frameWins.map(() => 0);
    this.frameNo = 0;
    this.broken = false;
    this.forfeitTeam = null;
    this.status = 'playing';
    this.startFrame();
    this.broadcast({ t: 'game.start', room: this.snapshot() });
    this.changed();
  }

  private startFrame(): void {
    this.frameNo++;
    this.forfeitTeam = null;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const breaker = (this.frameNo - 1) % this.config.maxPlayers;
    this.game = new Game(this.cfg(), seed, breaker);
    this.animUntil = 0;
    this.afterTurnChange(1500 * this.opts.animScale);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private startTurnTimer(ms: number): void {
    this.clearTurnTimer();
    if (!this.game || this.game.phase !== 'playing') return;
    this.turnRemaining = null;
    this.turnDeadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), ms);
  }

  /** Sau khi đổi lượt: đặt đồng hồ và kích hoạt bot nếu cần. */
  private afterTurnChange(delayMs: number): void {
    this.clearTurnTimer();
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    if (!this.game || this.game.phase !== 'playing') return;
    const cur = this.activePlayers().find((p) => p.seat === this.game!.currentSeat);
    if (!cur) {
      // ghế trống (người đã rời): bỏ lượt
      this.game.timeoutFoul();
      return this.afterTurnChange(0);
    }
    if (cur.isBot) {
      this.turnDeadline = null;
      this.botTimer = setTimeout(() => this.botMove(), this.opts.botDelayMs + delayMs);
      return;
    }
    if (!cur.connected) {
      this.turnRemaining = this.opts.turnTimeMs;
      this.turnDeadline = null;
      return;
    }
    // đồng hồ bắt đầu sau khi hoạt ảnh kết thúc
    this.turnDeadline = Date.now() + delayMs + this.opts.turnTimeMs;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), delayMs + this.opts.turnTimeMs);
  }

  private onTurnTimeout(): void {
    if (!this.game || this.game.phase !== 'playing') return;
    this.game.timeoutFoul();
    this.afterTurnChange(0);
    this.broadcast({ t: 'game.state', room: this.snapshot() });
  }

  private botMove(): void {
    if (!this.game || this.game.phase !== 'playing' || this.closed) return;
    const cur = this.activePlayers().find((p) => p.seat === this.game!.currentSeat);
    if (!cur || !cur.isBot) return;
    try {
      const mv = chooseMove(this.game.rs, this.game.balls, this.rnd, 0.85);
      this.executeShot(cur.seat, mv.shot, mv.cue);
    } catch {
      this.game.timeoutFoul();
      this.afterTurnChange(0);
      this.broadcast({ t: 'game.state', room: this.snapshot() });
    }
  }

  // ---------- thao tác trong trận ----------
  place(playerId: string, x: number, y: number): string | null {
    const p = this.playerById(playerId);
    if (!p || !this.game || this.status !== 'playing') return 'Không trong trận';
    const err = this.game.place(p.seat, x, y);
    if (!err) this.broadcast({ t: 'game.state', room: this.snapshot() });
    return err;
  }

  aim(playerId: string, angle: number, power: number): void {
    const p = this.playerById(playerId);
    if (!p || !this.game || this.status !== 'playing' || this.game.currentSeat !== p.seat) return;
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return;
    for (const o of this.activePlayers()) if (o.id !== p.id) o.session?.conn?.send({ t: 'game.aim', seat: p.seat, angle, power: Math.min(1, Math.max(0, power)) });
  }

  shoot(playerId: string, shot: ShotInput, cue?: { x: number; y: number }): string | null {
    const p = this.playerById(playerId);
    if (!p || !this.game || this.status !== 'playing') return 'Không trong trận';
    if (Date.now() < this.animUntil) return 'Bi đang chuyển động';
    try {
      this.executeShot(p.seat, shot, cue);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  private executeShot(seat: number, shot: ShotInput, cue?: { x: number; y: number }): void {
    const game = this.game!;
    const remaining = this.turnDeadline !== null ? Math.max(1000, this.turnDeadline - Date.now()) : null;
    this.clearTurnTimer();
    let out;
    try {
      out = game.shoot(seat, shot, cue);
    } catch (e) {
      // cú đánh bị từ chối: giữ nguyên thời gian còn lại của lượt (không cho "câu giờ" bằng cách gửi lệnh sai)
      if (remaining !== null) {
        this.turnDeadline = Date.now() + remaining;
        this.turnTimer = setTimeout(() => this.onTurnTimeout(), remaining);
      }
      throw e;
    }
    this.turnDeadline = null;
    const animMs = Math.round(((out.result.frameCount / FRAME_HZ) * 1000 + 600) * this.opts.animScale);
    this.animUntil = Date.now() + animMs;
    this.seq++;
    const msg = { ...out.result, seq: this.seq, snapshot: this.snapshotForShot(out.result.snapshot, animMs) };
    this.broadcast(msg);
    if (out.frameOver) {
      this.animUntil = Date.now() + animMs;
      setTimeout(() => this.endFrame(false), animMs);
    } else {
      this.afterTurnChange(animMs);
    }
  }

  private snapshotForShot(g: RoomSnapshot['game'], animMs: number): NonNullable<RoomSnapshot['game']> {
    const snap = g!;
    snap.phase = 'simulating';
    snap.turnDeadline = this.turnDeadline ?? Date.now() + animMs + this.opts.turnTimeMs;
    return snap;
  }

  private endFrame(forfeit: boolean): void {
    if (!this.game || this.closed) return;
    const game = this.game;
    const winnerTeam = game.rs.winnerTeam ?? 0;
    this.frameWins[winnerTeam] = (this.frameWins[winnerTeam] ?? 0) + 1;
    const need = this.config.winsNeeded;
    const matchOver = forfeit || this.broken || this.frameWins[winnerTeam] >= need;
    this.clearTurnTimer();
    if (this.botTimer) clearTimeout(this.botTimer);
    this.turnDeadline = null;
    if (matchOver) this.status = 'finished';
    const forfeitTeam = forfeit ? this.forfeitTeam : null;
    this.broadcast({
      t: 'game.over',
      room: this.snapshot(),
      winnerTeam: matchOver ? this.bestTeam(winnerTeam) : winnerTeam,
      frameWinnerTeam: winnerTeam,
      matchOver,
      reason: game.rs.message,
    });
    this.hooks.onFrameEnd?.(this, { winnerTeam, matchOver, forfeitTeam });
    this.changed();
    if (!matchOver) {
      this.nextTimer = setTimeout(() => {
        if (this.closed) return;
        this.startFrame();
        this.broadcast({ t: 'game.start', room: this.snapshot() });
      }, this.opts.nextFrameDelayMs);
    }
  }

  private bestTeam(fallback: number): number {
    let best = fallback;
    this.frameWins.forEach((w, i) => {
      if (w > this.frameWins[best]) best = i;
    });
    return best;
  }

  sync(playerId: string): void {
    const p = this.playerById(playerId);
    if (!p) return;
    p.session?.conn?.send({ t: 'room.state', room: this.snapshot() });
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTurnTimer();
    for (const t of [this.botTimer, this.nextTimer]) if (t) clearTimeout(t);
    for (const p of this.players) {
      if (p.graceTimer) clearTimeout(p.graceTimer);
      if (p.session && p.session.roomCode === this.code) p.session.roomCode = null;
    }
    this.broadcast({ t: 'room.closed', reason });
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
