import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../Backend/src/server';
import { chooseMove } from '@gameserver/ai';
import { mulberry32 } from '@gameserver/rack';
import type { ClientMsg, RoomSnapshot, ServerMsg } from '@shared/protocol';
import type { RuleState } from '@gameserver/rules';

let srv: RunningServer;
const url = () => `ws://127.0.0.1:${srv.port}/ws`;

class Client {
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  sessionId = '';
  playerId = '';
  room: RoomSnapshot | null = null;
  waiters: Array<{ pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }> = [];
  constructor(public name: string) {}
  async connect(sessionId?: string) {
    this.ws = new WebSocket(url());
    await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j); });
    this.ws.on('message', (d) => this.onMsg(JSON.parse(d.toString())));
    this.send({ t: 'auth', name: this.name, sessionId });
    const ok = (await this.wait((m) => m.t === 'auth.ok')) as Extract<ServerMsg, { t: 'auth.ok' }>;
    this.sessionId = ok.sessionId;
    this.playerId = ok.playerId;
    return ok;
  }
  onMsg(m: ServerMsg) {
    this.msgs.push(m);
    if ('room' in m && m.room) this.room = m.room;
    if (m.t === 'game.shotResult' && this.room?.game) this.room.game = m.snapshot;
    for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (m: ServerMsg) => boolean, ms = 20000): Promise<ServerMsg> {
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('timeout waiting; last msgs: ' + JSON.stringify(this.msgs.slice(-3)).slice(0, 600))), ms);
      this.waiters.push({ pred, res: (m) => { clearTimeout(to); res(m); } });
    });
  }
  mark() { this.msgs.length = 0; }
  close() { this.ws.close(); }
  get mySeat() { return this.room?.players.find((p) => p.id === this.playerId)?.seat ?? -1; }
}

beforeAll(async () => {
  srv = await startServer({
    port: 0, webRoot: null, publicUrl: 'http://test', dataDir: null,
    turnTimeMs: 60000, graceMs: 600, botDelayMs: 0, animScale: 0, nextFrameDelayMs: 50,
  });
});
afterAll(async () => { await srv.close(); });

/** Chơi tự động: mỗi client khi đến lượt sẽ gửi cú đánh do bot tính từ trạng thái nhận được. */
function autoplay(c: Client, skill = 0.9) {
  const rnd = mulberry32(c.name.length * 31 + 7);
  let busy = false;
  const handler = (m: ServerMsg) => {
    if (m.t !== 'game.start' && m.t !== 'game.shotResult' && m.t !== 'game.state') return;
    const g = m.t === 'game.shotResult' ? m.snapshot : m.room.game;
    if (!g || g.phase === 'over') return;
    if (g.currentSeat !== c.mySeat || busy) return;
    busy = true;
    setTimeout(() => {
      busy = false;
      const rs = { cfg: { mode: c.room!.config.mode, teamMode: c.room!.config.teamMode, seats: c.room!.config.maxPlayers }, breakShot: g.breakShot, ballInHand: g.ballInHand, groups: Object.values(g.groups), currentSeat: g.currentSeat } as unknown as RuleState;
      const mv = chooseMove(rs, g.balls, rnd, skill);
      c.send({ t: 'game.shot', shot: mv.shot, cue: mv.cue });
    }, 5);
  };
  c.ws.on('message', (d) => handler(JSON.parse(d.toString())));
}

describe('kết nối và phòng', () => {
  it('auth tạo phiên, ping/pong, từ chối khi chưa xác thực', async () => {
    const c = new Client('An');
    const ok = await c.connect();
    expect(ok.name).toBe('An');
    c.send({ t: 'ping', c: 5 });
    const p = (await c.wait((m) => m.t === 'pong')) as any;
    expect(p.c).toBe(5);
    c.close();
    const raw = new WebSocket(url());
    await new Promise((r) => raw.once('open', r));
    const got = new Promise<any>((r) => raw.once('message', (d) => r(JSON.parse(d.toString()))));
    raw.send(JSON.stringify({ t: 'room.create', mode: 'eightball', teamMode: 'solo', maxPlayers: 2 }));
    expect((await got).code).toBe('unauthenticated');
    raw.close();
  });

  it('tạo phòng, nhập mã, vào phòng chờ, sai mã báo lỗi, cấu hình sai bị từ chối', async () => {
    const a = new Client('A'); const b = new Client('B');
    await a.connect(); await b.connect();
    a.send({ t: 'room.create', mode: 'eightball', teamMode: 'team', maxPlayers: 2 });
    expect(((await a.wait((m) => m.t === 'error')) as any).code).toBe('bad_config');
    a.mark();
    a.send({ t: 'room.create', mode: 'eightball', teamMode: 'solo', maxPlayers: 2 });
    const st = (await a.wait((m) => m.t === 'room.state')) as any;
    const code = st.room.code as string;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    expect(st.room.inviteUrl).toBe(`http://test/invite/${code}`);
    b.send({ t: 'room.join', code: 'ZZZZZ' });
    expect(((await b.wait((m) => m.t === 'error')) as any).code).toBe('room_not_found');
    b.mark();
    b.send({ t: 'room.join', code: code.toLowerCase() });
    await b.wait((m) => m.t === 'room.state');
    expect(b.room!.players.map((p) => p.name).sort()).toEqual(['A', 'B']);
    expect(b.room!.players.find((p) => p.isHost)!.name).toBe('A');
    // người thứ ba không vào được
    const c = new Client('C'); await c.connect();
    c.send({ t: 'room.join', code });
    expect(((await c.wait((m) => m.t === 'error')) as any).code).toBe('join_failed');
    // chỉ chủ phòng mới bắt đầu được
    b.mark(); b.send({ t: 'room.start' });
    expect(((await b.wait((m) => m.t === 'error')) as any).code).toBe('cannot_start');
    [a, b, c].forEach((x) => x.close());
  });

  it('REST: kiểm tra phòng tồn tại', async () => {
    const a = new Client('R'); await a.connect();
    a.send({ t: 'room.create', mode: 'nineball', teamMode: 'solo', maxPlayers: 2 });
    const st = (await a.wait((m) => m.t === 'room.state')) as any;
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/rooms/${st.room.code}`);
    expect((await r.json()).exists).toBe(true);
    expect((await fetch(`http://127.0.0.1:${srv.port}/api/rooms/NOPE2`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${srv.port}/health`)).status).toBe(200);
    a.close();
  });
});

describe('trận 2 người qua mạng', () => {
  it('hai người chơi trọn một trận 8 bi, cả hai nhận cùng kết quả, server từ chối đánh sai lượt', async () => {
    const a = new Client('Hai-A'); const b = new Client('Hai-B');
    await a.connect(); await b.connect();
    a.send({ t: 'room.create', mode: 'eightball', teamMode: 'solo', maxPlayers: 2, bestOf: 1 });
    const code = ((await a.wait((m) => m.t === 'room.state')) as any).room.code;
    b.send({ t: 'room.join', code });
    await b.wait((m) => m.t === 'room.state');
    autoplay(a); autoplay(b);
    a.mark();
    a.send({ t: 'room.start' });
    const startA = await a.wait((m) => m.t === 'game.start');
    await b.wait((m) => m.t === 'game.start');
    expect((startA as any).room.game.breakShot).toBe(true);
    // người không có lượt đánh -> lỗi
    const other = (startA as any).room.game.currentSeat === a.mySeat ? b : a;
    other.mark();
    other.send({ t: 'game.shot', shot: { angle: 0, power: 0.5, spinX: 0, spinY: 0 } });
    expect(((await other.wait((m) => m.t === 'error')) as any).code).toBe('bad_shot');
    const [oa, ob] = (await Promise.all([a.wait((m) => m.t === 'game.over', 120000), b.wait((m) => m.t === 'game.over', 120000)])) as any[];
    expect(oa.matchOver).toBe(true);
    expect(oa.winnerTeam).toBe(ob.winnerTeam);
    expect(oa.room.game.balls).toEqual(ob.room.game.balls);
    expect(oa.room.frameWins[oa.winnerTeam]).toBe(1);
    a.close(); b.close();
  }, 180000);

  it('chơi với máy (bot): thêm bot rồi chơi hết trận 9 bi', async () => {
    const a = new Client('Solo');
    await a.connect();
    a.send({ t: 'room.create', mode: 'nineball', teamMode: 'solo', maxPlayers: 2, bestOf: 1 });
    await a.wait((m) => m.t === 'room.state');
    a.send({ t: 'room.addBot' });
    await a.wait((m) => m.t === 'room.state' && (m as any).room.players.length === 2);
    autoplay(a);
    a.send({ t: 'room.start' });
    const over = (await a.wait((m) => m.t === 'game.over', 120000)) as any;
    expect(over.matchOver).toBe(true);
    a.close();
  }, 180000);
});

describe('trận 4 người', () => {
  it('2v2 đội: bốn người, bi đồng bộ, chơi trọn trận', async () => {
    const cs = ['P1', 'P2x', 'P3xx', 'P4xxx'].map((n) => new Client(n));
    for (const c of cs) await c.connect();
    cs[0].send({ t: 'room.create', mode: 'eightball', teamMode: 'team', maxPlayers: 4, bestOf: 1 });
    const code = ((await cs[0].wait((m) => m.t === 'room.state')) as any).room.code;
    for (const c of cs.slice(1)) { c.send({ t: 'room.join', code }); await c.wait((m) => m.t === 'room.state'); }
    cs[0].send({ t: 'room.start' });
    await Promise.all(cs.map((c) => c.wait((m) => m.t === 'game.start')));
    expect(new Set(cs.map((c) => c.mySeat)).size).toBe(4);
    cs.forEach((c) => autoplay(c));
    // kích hoạt lượt đầu (autoplay chỉ phản ứng với thông điệp mới)
    cs.forEach((c) => c.send({ t: 'game.sync' }));
    cs.forEach((c) => c.ws.emit('message', JSON.stringify({ t: 'game.state', room: c.room })));
    const overs = (await Promise.all(cs.map((c) => c.wait((m) => m.t === 'game.over', 150000)))) as any[];
    expect(new Set(overs.map((o) => o.winnerTeam)).size).toBe(1);
    expect(new Set(overs.map((o) => JSON.stringify(o.room.game.balls))).size).toBe(1);
    cs.forEach((c) => c.close());
  }, 200000);

  it('Rotation 3 người solo được tạo và bắt đầu', async () => {
    const cs = ['Q1', 'Q2x', 'Q3xx'].map((n) => new Client(n));
    for (const c of cs) await c.connect();
    cs[0].send({ t: 'room.create', mode: 'rotation', teamMode: 'solo', maxPlayers: 3 });
    const code = ((await cs[0].wait((m) => m.t === 'room.state')) as any).room.code;
    for (const c of cs.slice(1)) { c.send({ t: 'room.join', code }); await c.wait((m) => m.t === 'room.state'); }
    cs[0].send({ t: 'room.start' });
    const st = (await cs[2].wait((m) => m.t === 'game.start')) as any;
    expect(st.room.players).toHaveLength(3);
    expect(st.room.game.balls.filter((b: any) => !b.pocketed)).toHaveLength(16);
    cs.forEach((c) => c.close());
  });
});

describe('mất kết nối', () => {
  it('mất mạng giữa trận rồi kết nối lại: trạng thái bàn được khôi phục', async () => {
    const a = new Client('Re-A'); const b = new Client('Re-B');
    await a.connect(); await b.connect();
    a.send({ t: 'room.create', mode: 'eightball', teamMode: 'solo', maxPlayers: 2 });
    const code = ((await a.wait((m) => m.t === 'room.state')) as any).room.code;
    b.send({ t: 'room.join', code }); await b.wait((m) => m.t === 'room.state');
    a.send({ t: 'room.start' });
    await a.wait((m) => m.t === 'game.start'); await b.wait((m) => m.t === 'game.start');
    const before = JSON.stringify(b.room!.game!.balls);
    b.mark();
    a.close();
    const st = (await b.wait((m) => m.t === 'player.status')) as any;
    expect(st.connected).toBe(false);
    // kết nối lại trong thời gian chờ
    const a2 = new Client('Re-A');
    const ok = await a2.connect(a.sessionId);
    expect(ok.playerId).toBe(a.playerId);
    expect(ok.room?.code).toBe(code);
    expect(JSON.stringify(ok.room!.game!.balls)).toBe(before);
    const back = (await b.wait((m) => m.t === 'player.status' && (m as any).connected === true)) as any;
    expect(back.playerId).toBe(a.playerId);
    a2.close(); b.close();
  });

  it('không quay lại sau thời gian chờ: bị xử thua, đối thủ thắng', async () => {
    const a = new Client('Gone-A'); const b = new Client('Gone-B');
    await a.connect(); await b.connect();
    a.send({ t: 'room.create', mode: 'nineball', teamMode: 'solo', maxPlayers: 2 });
    const code = ((await a.wait((m) => m.t === 'room.state')) as any).room.code;
    b.send({ t: 'room.join', code }); await b.wait((m) => m.t === 'room.state');
    a.send({ t: 'room.start' });
    await b.wait((m) => m.t === 'game.start');
    a.close();
    const over = (await b.wait((m) => m.t === 'game.over', 5000)) as any;
    expect(over.matchOver).toBe(true);
    expect(over.winnerTeam).toBe(b.room!.players.find((p) => p.id === b.playerId)!.team);
    b.close();
  });
});

describe('giải đấu', () => {
  it('giải 4 người đơn loại trực tiếp: đăng ký, chia nhánh, chơi, vô địch; mã quản lý được bảo vệ', async () => {
    const cs = ['T1', 'T2x', 'T3xx', 'T4xxx'].map((n) => new Client(n));
    for (const c of cs) await c.connect();
    const org = cs[0];
    org.send({ t: 'tour.create', name: 'Giải thử', size: 4, format: 'single', gameMode: 'nineball', teamMode: 'solo', bestOf: 1, isPublic: true });
    const created = (await org.wait((m) => m.t === 'tour.created')) as any;
    const code = created.tournament.code as string;
    const admin = created.adminToken as string;
    expect(JSON.stringify(created.tournament)).not.toContain(admin);
    for (const c of cs) { c.send({ t: 'tour.join', code }); await c.wait((m) => m.t === 'tour.state' && (m as any).tournament.entries.length >= 1); }
    await new Promise((r) => setTimeout(r, 100));
    // sai mã quản lý
    cs[1].mark();
    cs[1].send({ t: 'tour.start', code, adminToken: 'sai' });
    expect(((await cs[1].wait((m) => m.t === 'error')) as any).code).toBe('forbidden');
    // danh sách giải công khai
    cs[1].send({ t: 'tour.list' });
    const list = (await cs[1].wait((m) => m.t === 'tour.list')) as any;
    expect(list.tournaments.some((t: any) => t.code === code)).toBe(true);
    org.mark();
    org.send({ t: 'tour.lock', code, adminToken: admin });
    await org.wait((m) => m.t === 'tour.state' && (m as any).tournament.status === 'locked');
    cs[3].mark(); cs[3].send({ t: 'tour.join', code });
    // đã đăng ký rồi -> báo lỗi (hoặc khóa)
    expect(['registration_closed', 'already_joined']).toContain(((await cs[3].wait((m) => m.t === 'error')) as any).code);
    org.mark();
    org.send({ t: 'tour.start', code, adminToken: admin });
    let snap = ((await org.wait((m) => m.t === 'tour.state' && (m as any).tournament.status === 'running')) as any).tournament;
    expect(snap.matches.filter((m: any) => m.status === 'ready')).toHaveLength(2);
    cs.forEach((c) => autoplay(c, 0.95));

    const byEntry = new Map<string, Client>();
    for (const e of snap.entries) byEntry.set(e.id, cs.find((c) => c.name === e.members[0])!);

    const playRound = async (matchIds: string[]) => {
      for (const id of matchIds) {
        const m = (await new Promise<any>((r) => r(snap.matches.find((x: any) => x.id === id))));
        const pa = byEntry.get(m.a)!; const pb = byEntry.get(m.b)!;
        pa.send({ t: 'tour.joinMatch', code, matchId: id });
        pb.send({ t: 'tour.joinMatch', code, matchId: id });
      }
    };
    const ready = snap.matches.filter((m: any) => m.status === 'ready').map((m: any) => m.id);
    await playRound(ready);
    // chờ vòng 1 xong
    snap = await waitTour(org, (t) => t.matches.filter((m: any) => m.roundNo === 1 || m.id.startsWith('W1')).every((m: any) => m.status === 'done'));
    const finalM = snap.matches.find((m: any) => m.id === 'W2-1');
    expect(finalM.status).toBe('ready');
    await playRound(['W2-1']);
    snap = await waitTour(org, (t) => t.status === 'finished');
    expect(snap.champion).toBeTruthy();
    const winnerEntry = snap.matches.find((m: any) => m.id === 'W2-1').winner;
    expect(snap.champion).toBe(winnerEntry);
    cs.forEach((c) => c.close());
  }, 300000);

  async function waitTour(c: Client, pred: (t: any) => boolean): Promise<any> {
    const cur = c.msgs.filter((m) => m.t === 'tour.state').pop() as any;
    if (cur && pred(cur.tournament)) return cur.tournament;
    try {
      return ((await c.wait((m) => m.t === 'tour.state' && pred((m as any).tournament), 60000)) as any).tournament;
    } catch (e) {
      const dump = [...srv.hub.rooms.values()].map((r) => ({ code: r.code, status: r.status, players: r.activePlayers().map((p) => p.name + ':' + p.connected), game: r.game && { phase: r.game.phase, seat: r.game.currentSeat, bih: r.game.rs.ballInHand, msg: r.game.rs.message } }));
      const errs = c.msgs.filter((m) => m.t === 'error');
      const tt = [...srv.hub.tournaments.values()].map((t) => t.matches.map((m) => `${m.id}:${m.a}-${m.b}:${m.status}:${m.scoreA}-${m.scoreB}:${m.roomCode}`));
      throw new Error('STUCK ' + JSON.stringify(tt) + JSON.stringify(dump) + ' errs=' + JSON.stringify(errs.slice(-3)));
    }
  }
});
