/**
 * Bot đơn giản dùng kỹ thuật "bi ảo" (ghost ball): chọn bi + lỗ có góc cắt nhỏ và đường đi thông thoáng.
 * Dùng cho phòng chơi với máy và cho bộ kiểm thử tự động.
 */
import { POCKETS, TABLE, type BallState, type ShotInput } from '@shared/protocol';
import { HEAD_SPOT } from './rack.js';
import { isValidCuePlacement, legalTargets, type RuleState } from './rules.js';
import { speedToPower } from './physics.js';

const R = TABLE.R;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

interface Candidate {
  ball: number;
  pocket: number;
  angle: number;
  score: number;
  dist: number;
}

function bestShot(cue: { x: number; y: number }, balls: BallState[], targets: number[]): Candidate | null {
  const live = balls.filter((b) => b.id !== 0 && !b.pocketed);
  let best: Candidate | null = null;
  for (const id of targets) {
    const tb = live.find((b) => b.id === id);
    if (!tb) continue;
    for (let pi = 0; pi < POCKETS.length; pi++) {
      const p = POCKETS[pi];
      const pdx = p.x - tb.x;
      const pdy = p.y - tb.y;
      const pd = Math.hypot(pdx, pdy) || 1e-9;
      const ux = pdx / pd;
      const uy = pdy / pd;
      const gx = tb.x - ux * 2 * R;
      const gy = tb.y - uy * 2 * R;
      if (gx < R || gx > TABLE.L - R || gy < R || gy > TABLE.W - R) continue;
      const cdx = gx - cue.x;
      const cdy = gy - cue.y;
      const cd = Math.hypot(cdx, cdy);
      if (cd < 1e-6) continue;
      // góc cắt
      const cos = (cdx * ux + cdy * uy) / cd;
      if (cos < 0.35) continue;
      // đường đi bi cái -> bi ảo thông thoáng?
      let clear = true;
      for (const o of live) {
        if (o.id === id) continue;
        if (segDist(o.x, o.y, cue.x, cue.y, gx, gy) < 2 * R * 1.05) { clear = false; break; }
        if (segDist(o.x, o.y, tb.x, tb.y, p.x, p.y) < 2 * R * 1.05) { clear = false; break; }
      }
      if (!clear) continue;
      const score = cd + pd * 1.5 + (1 - cos) * 3;
      if (!best || score < best.score) {
        best = { ball: id, pocket: pi, angle: Math.atan2(cdy, cdx), score, dist: cd + pd };
      }
    }
  }
  return best;
}

export interface BotMove {
  cue?: { x: number; y: number };
  shot: ShotInput;
}

/** Chọn nước đi cho bot. `skill` 0..1 càng cao càng ít sai số. */
export function chooseMove(rs: RuleState, balls: BallState[], rnd: () => number, skill = 0.8): BotMove {
  const targets = legalTargets(rs, balls);
  let cue = { x: balls[0].x, y: balls[0].y };
  let placed: { x: number; y: number } | undefined;

  if (rs.ballInHand) {
    const head = rs.ballInHand.headStringOnly;
    let bestPos: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 60; i++) {
      const x = head ? R + rnd() * (TABLE.L * 0.25 - R) : R + rnd() * (TABLE.L - 2 * R);
      const y = R + rnd() * (TABLE.W - 2 * R);
      if (!isValidCuePlacement(balls, x, y, head)) continue;
      const c = bestShot({ x, y }, balls, targets);
      const sc = c ? c.score : 100;
      if (sc < bestScore) { bestScore = sc; bestPos = { x, y }; }
    }
    if (!bestPos) bestPos = isValidCuePlacement(balls, HEAD_SPOT.x, HEAD_SPOT.y, head) ? HEAD_SPOT : { x: R * 2, y: TABLE.W / 2 };
    placed = bestPos;
    cue = bestPos;
  }

  if (rs.breakShot) {
    const target = balls.find((b) => b.id !== 0 && !b.pocketed && b.x === Math.min(...balls.filter((q) => q.id !== 0 && !q.pocketed).map((q) => q.x)));
    const ang = target ? Math.atan2(target.y - cue.y, target.x - cue.x) : 0;
    return { cue: placed, shot: { angle: ang + (rnd() - 0.5) * 0.02, power: 0.95, spinX: 0, spinY: 0.1 } };
  }

  const cand = bestShot(cue, balls, targets);
  const noise = (1 - skill) * 0.05;
  if (cand) {
    const power = speedToPower(Math.min(6.5, Math.max(1.6, 1.4 + cand.dist * 1.7)));
    return {
      cue: placed,
      shot: { angle: cand.angle + (rnd() - 0.5) * noise, power, spinX: 0, spinY: 0.05 },
    };
  }
  // Không có đường thẳng: đánh vào bi hợp lệ gần nhất
  let nearest = targets.map((id) => balls.find((b) => b.id === id)!).filter(Boolean);
  nearest = nearest.sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y));
  const tb = nearest[0];
  const ang = tb ? Math.atan2(tb.y - cue.y, tb.x - cue.x) : rnd() * Math.PI * 2;
  return { cue: placed, shot: { angle: ang + (rnd() - 0.5) * 0.04, power: speedToPower(2 + rnd() * 1.5), spinX: 0, spinY: 0 } };
}
