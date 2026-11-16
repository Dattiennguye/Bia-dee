/**
 * Chế độ OFFLINE: chạy phòng chơi (cùng mã nguồn luật + vật lý với máy chủ) ngay trong ứng dụng,
 * để chơi với máy mà không cần Internet hay máy chủ.
 */
import type { ClientMsg, GameMode, Profile, ServerMsg, TeamMode } from '@shared/protocol';
import { Room, type Session } from '@backend/room';

export class LocalServer {
  readonly session: Session;
  private room: Room | null = null;

  constructor(name: string, private emit: (m: ServerMsg) => void, prof?: Profile) {
    this.session = {
      sessionId: 'local',
      playerId: 'local-player',
      name,
      conn: { send: (m) => queueMicrotask(() => this.emit(m)) },
      roomCode: null,
      lastSeen: Date.now(),
      prof,
    };
  }

  private err(message: string): void {
    this.session.conn!.send({ t: 'error', code: 'local', message });
  }

  /** Tạo phòng offline: người chơi + máy điền đủ ghế, bắt đầu ngay. */
  createAndStart(mode: GameMode, teamMode: TeamMode, maxPlayers: 2 | 3 | 4, bestOf: 1 | 3 | 5): void {
    const bad = Room.validate(mode, teamMode, maxPlayers);
    if (bad) return this.err(bad);
    this.room?.close('Phòng mới');
    this.room = new Room(
      'OFFLN',
      { mode, teamMode, maxPlayers, winsNeeded: Math.ceil(bestOf / 2) },
      { turnTimeMs: 120000, graceMs: 600000, botDelayMs: 900, animScale: 1, nextFrameDelayMs: 3500, publicUrl: '' },
    );
    this.room.join(this.session);
    for (let i = 1; i < maxPlayers; i++) this.room.addBot(this.session.playerId);
    this.room.start(this.session.playerId);
  }

  handle(msg: ClientMsg): void {
    const r = this.room;
    switch (msg.t) {
      case 'game.place': r?.place(this.session.playerId, Number(msg.x), Number(msg.y)) && this.err('Vị trí đặt bi cái không hợp lệ'); break;
      case 'game.shot': {
        const e = r?.shoot(this.session.playerId, msg.shot, msg.cue);
        if (e) this.session.conn!.send({ t: 'error', code: 'bad_shot', message: e });
        break;
      }
      case 'skipBot': {
        r?.skipBot(this.session.playerId);
        break;
      }
      case 'emote': {
        r?.emote(this.session.playerId, Number(msg.e));
        // máy phản ứng vui nhộn
        if (r && Math.random() < 0.6) setTimeout(() => { const b = r.players.find((p) => p.isBot); if (b) r.emote(b.id, Math.floor(Math.random() * 10)); }, 900 + Math.random() * 900);
        break;
      }
      case 'setProfile': this.session.prof = msg.prof; break;
      case 'game.aim': break; // không cần phát lại hướng ngắm trong chế độ một người
      case 'game.sync': r?.sync(this.session.playerId); break;
      case 'room.start': { const e = r?.start(this.session.playerId); if (e) this.err(e); break; }
      case 'room.leave': r?.leave(this.session.playerId); r?.close('Đã rời trận'); this.room = null; break;
      default: break; // các thao tác mạng/giải đấu không có ở chế độ offline
    }
  }

  stop(): void {
    this.room?.close('Dừng chế độ offline');
    this.room = null;
  }
}
