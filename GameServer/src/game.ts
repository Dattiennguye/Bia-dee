import { FRAME_HZ, TABLE, type BallState, type GameSnapshot, type ShotInput, type ShotResultMsg } from '@shared/protocol';
import { simulateShot } from './physics.js';
import { initialBalls } from './rack.js';
import {
  eliminateSeat,
  evaluateShot,
  isValidCuePlacement,
  newRuleState,
  nextSeat,
  teamOf,
  validateConfig,
  type RuleConfig,
  type RuleState,
} from './rules.js';

/** Chuyển danh sách khung hình sang quỹ đạo từng bi, cắt phần đứng yên ở cuối để giảm dung lượng. */
export function framesToTracks(frames: number[][]): number[][] {
  const tracks: number[][] = [];
  for (let i = 0; i < 16; i++) {
    let last = 0;
    for (let k = 1; k < frames.length; k++) {
      if (frames[k][2 * i] !== frames[k - 1][2 * i] || frames[k][2 * i + 1] !== frames[k - 1][2 * i + 1]) last = k;
    }
    const t: number[] = [];
    for (let k = 0; k <= last; k++) t.push(frames[k][2 * i], frames[k][2 * i + 1]);
    tracks.push(t);
  }
  return tracks;
}

export interface ShotOutcome {
  result: Omit<ShotResultMsg, 'seq'>;
  frameOver: boolean;
  winnerTeam: number | null;
}

/** Một ván bida do máy chủ điều khiển (server-authoritative). */
export class Game {
  balls: BallState[];
  rs: RuleState;
  phase: 'playing' | 'over' = 'playing';
  readonly seed: number;

  constructor(cfg: RuleConfig, seed: number, breakerSeat: number) {
    const err = validateConfig(cfg);
    if (err) throw new Error(err);
    this.seed = seed;
    this.balls = initialBalls(cfg.mode, seed);
    this.rs = newRuleState(cfg, breakerSeat);
  }

  isOver(): boolean {
    return this.phase === 'over';
  }

  get currentSeat(): number {
    return this.rs.currentSeat;
  }

  cueBall(): BallState {
    return this.balls[0];
  }

  snapshot(turnDeadline: number | null, simulating = false): GameSnapshot {
    const scores: Record<string, number> = {};
    const groups: Record<string, 'solid' | 'stripe' | null> = {};
    this.rs.scores.forEach((s, i) => (scores[String(i)] = s));
    this.rs.groups.forEach((g, i) => (groups[String(i)] = g));
    return {
      balls: this.balls.map((b) => ({ ...b })),
      currentSeat: this.rs.currentSeat,
      ballInHand: this.rs.ballInHand ? { ...this.rs.ballInHand } : null,
      scores,
      groups,
      breakShot: this.rs.breakShot,
      phase: this.phase === 'over' ? 'over' : simulating ? 'simulating' : 'playing',
      turnDeadline,
      message: this.rs.message,
    };
  }

  /** Đặt bi cái (chỉ khi được phép). Trả về lỗi hoặc null nếu thành công. */
  place(seat: number, x: number, y: number): string | null {
    if (this.phase !== 'playing') return 'Ván đấu đã kết thúc';
    const bih = this.rs.ballInHand;
    if (!bih || bih.seat !== seat) return 'Bạn không được đặt bi cái lúc này';
    if (!isValidCuePlacement(this.balls, x, y, bih.headStringOnly)) return 'Vị trí đặt bi cái không hợp lệ';
    this.balls[0].x = x;
    this.balls[0].y = y;
    return null;
  }

  /** Thực hiện một cú đánh. Ném lỗi (Error) nếu đầu vào không hợp lệ. */
  shoot(seat: number, shot: ShotInput, cue?: { x: number; y: number }): ShotOutcome {
    if (this.phase !== 'playing') throw new Error('Ván đấu đã kết thúc');
    if (seat !== this.rs.currentSeat) throw new Error('Chưa đến lượt của bạn');
    if (!shot || ![shot.angle, shot.power, shot.spinX, shot.spinY].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error('Cú đánh không hợp lệ');
    }
    const bih = this.rs.ballInHand;
    if (bih && bih.seat === seat) {
      if (cue) {
        const err = this.place(seat, cue.x, cue.y);
        if (err) throw new Error(err);
      } else if (!isValidCuePlacement(this.balls, this.balls[0].x, this.balls[0].y, bih.headStringOnly)) {
        throw new Error('Hãy đặt bi cái vào vị trí hợp lệ trước khi đánh');
      }
    }
    const safeShot: ShotInput = {
      angle: shot.angle,
      power: Math.min(1, Math.max(0, shot.power)),
      spinX: Math.min(1, Math.max(-1, shot.spinX)),
      spinY: Math.min(1, Math.max(-1, shot.spinY)),
    };
    const before = this.balls.map((b) => ({ ...b }));
    const cueStart = { x: before[0].x, y: before[0].y };
    const sim = simulateShot(before, safeShot);
    const out = evaluateShot(this.rs, before, sim);
    this.balls = out.balls;
    this.rs = out.rs;
    if (out.frameOver) this.phase = 'over';
    return {
      result: {
        t: 'game.shotResult',
        seat,
        shot: safeShot,
        cueStart,
        tracks: framesToTracks(sim.frames),
        frameCount: sim.frames.length,
        frameHz: FRAME_HZ,
        events: sim.events,
        snapshot: this.snapshot(null),
        foul: out.foul,
        foulReason: out.foulReason,
      },
      frameOver: out.frameOver,
      winnerTeam: this.rs.winnerTeam,
    };
  }

  /** Hết giờ: coi như phạm lỗi, chuyển lượt cho người kế tiếp. */
  timeoutFoul(): void {
    if (this.phase !== 'playing') return;
    const shooter = this.rs.currentSeat;
    const nxt = nextSeat(this.rs, shooter);
    this.rs.currentSeat = nxt;
    this.rs.ballInHand = { seat: nxt, headStringOnly: this.rs.breakShot };
    if (this.rs.cfg.mode === 'rotation') {
      const t = teamOf(this.rs.cfg, shooter);
      this.rs.scores[t] = Math.max(0, this.rs.scores[t] - 1);
    }
    this.rs.message = 'Hết giờ đánh — đổi lượt, người tiếp theo được đặt bi cái.';
  }

  /** Loại một người chơi khỏi ván (rời trận / mất kết nối quá lâu). */
  forfeit(seat: number): void {
    if (this.phase !== 'playing') return;
    eliminateSeat(this.rs, seat);
    if (this.rs.winnerTeam !== null) this.phase = 'over';
  }

  /** Cho phép người ngoài đặt bi cái "ảo" để xem trước (không đổi trạng thái) */
  static tableBounds() {
    return { L: TABLE.L, W: TABLE.W, R: TABLE.R };
  }
}
