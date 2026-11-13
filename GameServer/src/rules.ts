/**
 * Luật chơi: 8 bi, 9 bi, Rotation (61 điểm) cho 2–4 người (solo) hoặc 2 đội x 2 người.
 *
 * Quy ước chung:
 *  - Không có "gọi lỗ": bi vào lỗ nào cũng tính.
 *  - Phạm lỗi => đối thủ tiếp theo được đặt bi cái tự do ("ball in hand") trên toàn bàn.
 *  - Lỗi: bi cái rơi lỗ, không chạm bi nào, chạm sai bi đầu tiên, hoặc không có bi nào
 *    vào lỗ / chạm băng sau va chạm đầu tiên.
 */
import { TABLE, type BallState, type GameMode, type TeamMode } from '@shared/protocol';
import type { SimResult } from './physics.js';
import { FOOT_SPOT, HEAD_SPOT, findFreeSpot } from './rack.js';

export interface RuleConfig {
  mode: GameMode;
  teamMode: TeamMode;
  seats: number;
}

export interface RuleState {
  cfg: RuleConfig;
  currentSeat: number;
  breakShot: boolean;
  ballInHand: null | { seat: number; headStringOnly: boolean };
  /** Theo đội: nhóm bi (chỉ 8 bi) */
  groups: Array<'solid' | 'stripe' | null>;
  /** Điểm theo đội (Rotation); các chế độ khác = số bi đã vào lỗ hợp lệ */
  scores: number[];
  eliminated: boolean[];
  winnerTeam: number | null;
  lastScoringTeam: number | null;
  message: string;
}

export function validateConfig(cfg: RuleConfig): string | null {
  const { mode, teamMode, seats } = cfg;
  if (seats < 2 || seats > 4) return 'Số người chơi phải từ 2 đến 4';
  if (teamMode === 'team' && seats !== 4) return 'Chế độ đội 2v2 cần đúng 4 người';
  if (mode === 'eightball' && teamMode === 'solo' && seats !== 2) return 'Bida 8 bi cá nhân chỉ dành cho 2 người (dùng chế độ đội cho 4 người)';
  return null;
}

export function teamOf(cfg: RuleConfig, seat: number): number {
  return cfg.teamMode === 'team' ? seat % 2 : seat;
}

export function teamCount(cfg: RuleConfig): number {
  return cfg.teamMode === 'team' ? 2 : cfg.seats;
}

export function newRuleState(cfg: RuleConfig, breakerSeat: number): RuleState {
  const tc = teamCount(cfg);
  return {
    cfg,
    currentSeat: breakerSeat,
    breakShot: true,
    ballInHand: { seat: breakerSeat, headStringOnly: true },
    groups: new Array(tc).fill(null),
    scores: new Array(tc).fill(0),
    eliminated: new Array(cfg.seats).fill(false),
    winnerTeam: null,
    lastScoringTeam: null,
    message: 'Cú phá bi! Đặt bi cái sau vạch đầu bàn.',
  };
}

export const isSolid = (id: number) => id >= 1 && id <= 7;
export const isStripe = (id: number) => id >= 9 && id <= 15;

function onTable(balls: BallState[]): number[] {
  return balls.filter((b) => b.id !== 0 && !b.pocketed).map((b) => b.id);
}

export function lowestBall(balls: BallState[]): number | null {
  const ids = onTable(balls);
  return ids.length ? Math.min(...ids) : null;
}

/** Danh sách bi hợp lệ để đánh trúng đầu tiên */
export function legalTargets(rs: RuleState, balls: BallState[]): number[] {
  const ids = onTable(balls);
  if (rs.cfg.mode !== 'eightball') {
    const low = lowestBall(balls);
    return low === null ? [] : [low];
  }
  const team = teamOf(rs.cfg, rs.currentSeat);
  const g = rs.groups[team];
  if (!g) return ids.filter((i) => i !== 8);
  const own = ids.filter((i) => (g === 'solid' ? isSolid(i) : isStripe(i)));
  return own.length ? own : ids.includes(8) ? [8] : [];
}

export function nextSeat(rs: RuleState, from: number): number {
  const n = rs.cfg.seats;
  for (let i = 1; i <= n; i++) {
    const s = (from + i) % n;
    if (!rs.eliminated[s]) return s;
  }
  return from;
}

export interface EvalOutcome {
  rs: RuleState;
  balls: BallState[];
  foul: boolean;
  foulReason: string | null;
  frameOver: boolean;
}

/** Áp dụng kết quả mô phỏng vào luật; trả về trạng thái mới. */
export function evaluateShot(prev: RuleState, before: BallState[], sim: SimResult): EvalOutcome {
  const rs: RuleState = JSON.parse(JSON.stringify(prev));
  const balls: BallState[] = sim.finalBalls.map((b) => ({ ...b }));
  const cfg = rs.cfg;
  const shooter = rs.currentSeat;
  const team = teamOf(cfg, shooter);
  const objPocketed = sim.pocketed.filter((p) => p.ball !== 0).map((p) => p.ball);
  const scratch = sim.cuePocketed;
  const wasBreak = rs.breakShot;
  rs.breakShot = false;
  rs.ballInHand = null;

  let foul = false;
  let reason: string | null = null;
  const setFoul = (r: string) => {
    if (!foul) {
      foul = true;
      reason = r;
    }
  };

  if (scratch) setFoul('Bi cái rơi lỗ');

  const legalBefore = legalTargets(prev, before);
  const lowest = lowestBall(before);

  if (wasBreak) {
    const legalBreak = objPocketed.length > 0 || sim.objectBallsToCushion >= 4;
    if (!legalBreak) setFoul('Cú phá không hợp lệ (cần ít nhất 4 bi chạm băng hoặc có bi vào lỗ)');
    if (cfg.mode !== 'eightball' && sim.firstContact !== null && sim.firstContact !== lowest) {
      setFoul(`Phải chạm bi số ${lowest} đầu tiên`);
    }
    if (sim.firstContact === null) setFoul('Bi cái không chạm bi nào');
  } else {
    if (sim.firstContact === null) setFoul('Bi cái không chạm bi nào');
    else if (!legalBefore.includes(sim.firstContact)) {
      setFoul(
        cfg.mode === 'eightball'
          ? `Chạm sai bi (bi số ${sim.firstContact} không thuộc nhóm của bạn)`
          : `Phải chạm bi số ${lowest} đầu tiên`,
      );
    }
    if (objPocketed.length === 0 && !sim.railAfterContact && sim.firstContact !== null) {
      setFoul('Không có bi nào vào lỗ hoặc chạm băng sau va chạm');
    }
  }

  let frameOver = false;
  const respot: Array<{ id: number; at: { x: number; y: number } }> = [];

  if (cfg.mode === 'eightball') {
    const g = rs.groups[team];
    const hadOwn = g ? before.some((b) => b.id !== 0 && !b.pocketed && (g === 'solid' ? isSolid(b.id) : isStripe(b.id))) : true;
    const onEight = !!g && !hadOwn;
    const eightIn = objPocketed.includes(8);
    if (eightIn && wasBreak) {
      respot.push({ id: 8, at: FOOT_SPOT });
    } else if (eightIn) {
      frameOver = true;
      const opp = team === 0 ? 1 : 0;
      if (onEight && !foul) {
        rs.winnerTeam = team;
        rs.message = 'Đánh vào bi số 8 — chiến thắng!';
      } else {
        rs.winnerTeam = opp;
        rs.message = foul ? 'Phạm lỗi khi đánh bi số 8 — thua ván' : 'Bi số 8 vào lỗ quá sớm — thua ván';
      }
    }
    if (!frameOver && !wasBreak && !g && !foul) {
      const first = objPocketed.find((id) => id !== 8);
      if (first !== undefined) {
        const type = isSolid(first) ? 'solid' : 'stripe';
        rs.groups[team] = type;
        rs.groups[team === 0 ? 1 : 0] = type === 'solid' ? 'stripe' : 'solid';
      }
    }
    const gNow = rs.groups[team];
    const scored = !foul && objPocketed.some((id) => id !== 8 && (!gNow ? true : gNow === 'solid' ? isSolid(id) : isStripe(id)));
    for (const id of objPocketed) if (id !== 8) {
      const t = isSolid(id) ? 'solid' : 'stripe';
      const owner = rs.groups.indexOf(t);
      if (owner >= 0) rs.scores[owner]++;
    }
    if (!frameOver) finishTurn(rs, shooter, scored, foul, reason);
  } else if (cfg.mode === 'nineball') {
    const nineIn = objPocketed.includes(9);
    if (nineIn) {
      if (!foul) {
        frameOver = true;
        rs.winnerTeam = team;
        rs.message = 'Bi số 9 vào lỗ — chiến thắng!';
      } else {
        respot.push({ id: 9, at: FOOT_SPOT });
      }
    }
    for (const id of objPocketed) if (!(id === 9 && foul)) rs.scores[team]++;
    if (!frameOver) finishTurn(rs, shooter, !foul && objPocketed.length > 0, foul, reason);
  } else {
    // Rotation
    if (!scratch) {
      const pts = objPocketed.reduce((a, b) => a + b, 0);
      if (pts > 0) {
        rs.scores[team] += pts;
        rs.lastScoringTeam = team;
      }
    }
    if (foul) rs.scores[team] = Math.max(0, rs.scores[team] - 1);
    const remaining = onTable(balls).length;
    const best = Math.max(...rs.scores);
    if (best >= 61 || remaining === 0) {
      frameOver = true;
      let winner = rs.scores.indexOf(best);
      const tied = rs.scores.filter((s) => s === best).length > 1;
      if (tied) winner = rs.lastScoringTeam ?? winner;
      rs.winnerTeam = winner;
      rs.message = `Kết thúc ván: ${rs.scores.join(' - ')}`;
    } else {
      finishTurn(rs, shooter, !foul && objPocketed.length > 0, foul, reason);
    }
  }

  // Đặt lại bi (8 khi phá, 9 khi lỗi)
  for (const r of respot) {
    const b = balls.find((x) => x.id === r.id)!;
    const spot = findFreeSpot(balls, r.at, r.id);
    b.x = spot.x;
    b.y = spot.y;
    b.pocketed = false;
  }

  // Bi cái rơi lỗ: đưa lại lên bàn để chờ người chơi đặt
  if (!frameOver && rs.ballInHand) {
    const c = balls.find((b) => b.id === 0)!;
    if (c.pocketed) {
      const spot = findFreeSpot(balls, HEAD_SPOT, 0);
      c.x = spot.x;
      c.y = spot.y;
      c.pocketed = false;
    }
  }

  if (frameOver) rs.ballInHand = null;
  return { rs, balls, foul, foulReason: reason, frameOver };
}

function finishTurn(rs: RuleState, shooter: number, scored: boolean, foul: boolean, reason: string | null): void {
  if (foul) {
    const nxt = nextSeat(rs, shooter);
    rs.currentSeat = nxt;
    rs.ballInHand = { seat: nxt, headStringOnly: false };
    rs.message = `Lỗi: ${reason}. Người tiếp theo được đặt bi cái tự do.`;
  } else if (scored) {
    rs.currentSeat = shooter;
    rs.message = 'Bi vào lỗ — được đánh tiếp.';
  } else {
    rs.currentSeat = nextSeat(rs, shooter);
    rs.message = 'Đổi lượt.';
  }
}

/** Kiểm tra vị trí đặt bi cái có hợp lệ không */
export function isValidCuePlacement(balls: BallState[], x: number, y: number, headStringOnly: boolean): boolean {
  const R = TABLE.R;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < R || x > TABLE.L - R || y < R || y > TABLE.W - R) return false;
  if (headStringOnly && x > TABLE.L * 0.25) return false;
  for (const b of balls) {
    if (b.id === 0 || b.pocketed) continue;
    if (Math.hypot(b.x - x, b.y - y) < 2 * R * 1.001) return false;
  }
  // không đặt trong miệng lỗ
  const pockets = [
    [0, 0, 0.1], [TABLE.L, 0, 0.1], [0, TABLE.W, 0.1], [TABLE.L, TABLE.W, 0.1],
    [TABLE.L / 2, 0, 0.09], [TABLE.L / 2, TABLE.W, 0.09],
  ];
  for (const [px, py, pr] of pockets) if (Math.hypot(px - x, py - y) < pr) return false;
  return true;
}

/** Loại một ghế (mất kết nối quá lâu). Trả về đội thắng nếu chỉ còn một đội. */
export function eliminateSeat(rs: RuleState, seat: number): void {
  rs.eliminated[seat] = true;
  const aliveTeams = new Set<number>();
  for (let s = 0; s < rs.cfg.seats; s++) if (!rs.eliminated[s]) aliveTeams.add(teamOf(rs.cfg, s));
  if (aliveTeams.size <= 1) {
    rs.winnerTeam = aliveTeams.size === 1 ? [...aliveTeams][0] : null;
    rs.message = 'Đối thủ rời trận — bạn thắng';
    rs.ballInHand = null;
  } else if (rs.currentSeat === seat) {
    rs.currentSeat = nextSeat(rs, seat);
    rs.ballInHand = { seat: rs.currentSeat, headStringOnly: false };
  }
}
