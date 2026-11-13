/**
 * Engine vật lý bida 2D chạy trên máy chủ (nguồn sự thật duy nhất).
 *
 * Mô hình (không dùng rigidbody tổng quát):
 *  - Mỗi bi là hình cầu đặc, trạng thái: vị trí (x,y), vận tốc (vx,vy), vận tốc góc (wx,wy,wz).
 *  - Ma sát trượt Coulomb giữa bi và nỉ: bi vừa bị đánh thì TRƯỢT (có thể xoáy tiến/lùi/ngang),
 *    sau một thời gian chuyển sang LĂN thuần túy, sau đó bị lực cản lăn làm chậm dần.
 *  - Va chạm bi-bi: xung lượng pháp tuyến có độ nảy + ma sát tiếp tuyến (throw, truyền xoáy ngang).
 *  - Va chạm băng: độ nảy phụ thuộc tốc độ, ma sát tiếp tuyến ghép với xoáy ngang (english).
 *  - Lỗ: vùng hút quanh tâm lỗ (xem pocket capture), bi ở vòng ngoài chỉ rơi nếu đang đi hướng vào lỗ.
 *  - Bước thời gian cố định 1/480 s => kết quả tất định (cùng đầu vào, cùng đầu ra).
 */
import { TABLE, POCKETS, FRAME_HZ, type ShotInput, type TableEvent, type BallState } from '@shared/protocol';

export const PHYS = {
  g: 9.81,
  /** Hệ số ma sát trượt bi-nỉ */
  muSlide: 0.2,
  /** Hệ số cản lăn (giảm tốc khi lăn = muRoll * g) */
  muRoll: 0.035,
  /** Giảm tốc quay quanh trục đứng (rad/s^2) */
  spinZDecel: 40,
  eBall: 0.95,
  muBall: 0.05,
  muCushion: 0.2,
  vMax: 8.5,
  dt: 1 / 480,
  rest: 0.003,
  maxTime: 45,
};

const R = TABLE.R;
const L = TABLE.L;
const W = TABLE.W;
const I_FACTOR = 5 / (2 * R); // (5/2)/R : mô-men quán tính cầu đặc

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
  wz: number;
  pocketed: boolean;
}

export interface SimResult {
  /** Mỗi khung: mảng phẳng toạ độ mm của bi 0..15, bi đã rơi lỗ = -1 */
  frames: number[][];
  events: TableEvent[];
  finalBalls: BallState[];
  firstContact: number | null;
  /** Danh sách bi rơi lỗ theo thứ tự thời gian */
  pocketed: Array<{ ball: number; pocket: number; t: number }>;
  /** Có bi nào chạm băng sau khi bi cái chạm bi đầu tiên */
  railAfterContact: boolean;
  /** Số bi mục tiêu (không phải bi cái) đã chạm băng */
  objectBallsToCushion: number;
  cuePocketed: boolean;
  duration: number;
}

export function makeBalls(states: BallState[]): Ball[] {
  const balls: Ball[] = [];
  for (let i = 0; i < 16; i++) {
    const s = states.find((b) => b.id === i);
    balls.push({
      id: i,
      x: s ? s.x : 0,
      y: s ? s.y : 0,
      vx: 0,
      vy: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      pocketed: s ? s.pocketed : true,
    });
  }
  return balls;
}

/** Áp lực đánh lên bi cái: tính vận tốc và xoáy ban đầu từ điểm tiếp xúc của cơ */
export function applyCueStrike(cue: Ball, shot: ShotInput): number {
  const power = clamp(shot.power, 0, 1);
  const v0 = Math.max(0.05, PHYS.vMax * power);
  let a = clamp(shot.spinX, -1, 1);
  let b = clamp(shot.spinY, -1, 1);
  const mag = Math.hypot(a, b);
  const maxOff = 0.7; // vượt quá sẽ "miscue" -> giới hạn
  if (mag > maxOff) {
    a = (a / mag) * maxOff;
    b = (b / mag) * maxOff;
  }
  const dx = Math.cos(shot.angle);
  const dy = Math.sin(shot.angle);
  cue.vx = dx * v0;
  cue.vy = dy * v0;
  // xoáy dọc (b>0: tiến; b<0: lùi). b=0.4 => lăn thuần ngay lập tức.
  const wTop = (5 * v0 * b) / (2 * R);
  cue.wx = -dy * wTop;
  cue.wy = dx * wTop;
  // xoáy ngang (a>0: đánh bên phải => quay ngược chiều kim đồng hồ)
  cue.wz = (5 * v0 * a) / (2 * R);
  return v0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function moveBall(b: Ball, dt: number): void {
  let t = dt;
  // Pha trượt
  const ux = b.vx - R * b.wy;
  const uy = b.vy + R * b.wx;
  const us = Math.hypot(ux, uy);
  if (us > 1e-4) {
    const decel = 3.5 * PHYS.muSlide * PHYS.g; // tốc độ giảm của |u|
    const tSlide = Math.min(t, us / decel);
    const fx = ux / us;
    const fy = uy / us;
    const k = PHYS.muSlide * PHYS.g * tSlide;
    const ovx = b.vx;
    const ovy = b.vy;
    b.vx -= fx * k;
    b.vy -= fy * k;
    b.wx -= I_FACTOR * fy * k;
    b.wy += I_FACTOR * fx * k;
    // di chuyển trong thời gian trượt dùng vận tốc trung bình
    b.x += ((ovx + b.vx) / 2) * tSlide;
    b.y += ((ovy + b.vy) / 2) * tSlide;
    t -= tSlide;
    if (t > 1e-12) {
      // Kết thúc trượt => chuyển thành lăn thuần túy
      b.wy = b.vx / R;
      b.wx = -b.vy / R;
    }
  }
  if (t > 1e-12) {
    const sp = Math.hypot(b.vx, b.vy);
    const d = PHYS.muRoll * PHYS.g * t;
    if (sp <= d) {
      // dừng hẳn (di chuyển nốt quãng còn lại)
      const tt = sp / (PHYS.muRoll * PHYS.g);
      b.x += (b.vx / (sp || 1)) * sp * 0.5 * tt;
      b.y += (b.vy / (sp || 1)) * sp * 0.5 * tt;
      b.vx = b.vy = 0;
      b.wx = b.wy = 0;
    } else {
      const nx = b.vx / sp;
      const ny = b.vy / sp;
      const sp2 = sp - d;
      b.x += nx * ((sp + sp2) / 2) * t;
      b.y += ny * ((sp + sp2) / 2) * t;
      b.vx = nx * sp2;
      b.vy = ny * sp2;
      b.wy = b.vx / R;
      b.wx = -b.vy / R;
    }
  }
  // xoáy quanh trục đứng giảm dần
  if (b.wz !== 0) {
    const dz = PHYS.spinZDecel * dt;
    b.wz = Math.abs(b.wz) <= dz ? 0 : b.wz - Math.sign(b.wz) * dz;
  }
}

function isAtRest(b: Ball): boolean {
  return (
    Math.hypot(b.vx, b.vy) < PHYS.rest &&
    Math.hypot(b.wx, b.wy) * R < PHYS.rest &&
    Math.abs(b.wz) * R < PHYS.rest
  );
}

export function totalKineticSpeed(balls: Ball[]): number {
  let s = 0;
  for (const b of balls) if (!b.pocketed) s += b.vx * b.vx + b.vy * b.vy;
  return s;
}

/** Mô phỏng một cú đánh đến khi mọi bi dừng. */
export function simulateShot(start: BallState[], shot: ShotInput): SimResult {
  const balls = makeBalls(start);
  const cue = balls[0];
  const events: TableEvent[] = [];
  const pocketed: SimResult['pocketed'] = [];
  const objectCushion = new Set<number>();
  let firstContact: number | null = null;
  let railAfterContact = false;
  let t = 0;

  const v0 = applyCueStrike(cue, shot);
  events.push({ t: 0, k: 'cue', speed: v0 });

  const frames: number[][] = [snapshotFrame(balls)];
  const stepsPerFrame = Math.round(1 / PHYS.dt / FRAME_HZ);
  let step = 0;
  const maxSteps = Math.round(PHYS.maxTime / PHYS.dt);

  while (step < maxSteps) {
    step++;
    t = step * PHYS.dt;
    let anyMoving = false;
    for (const b of balls) {
      if (b.pocketed) continue;
      if (b.vx !== 0 || b.vy !== 0 || b.wx !== 0 || b.wy !== 0 || b.wz !== 0) {
        moveBall(b, PHYS.dt);
        anyMoving = true;
      }
    }
    // Va chạm bi-bi (2 lượt để xử lý chuỗi va chạm sát nhau)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 16; i++) {
        const a = balls[i];
        if (a.pocketed) continue;
        for (let j = i + 1; j < 16; j++) {
          const b = balls[j];
          if (b.pocketed) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R) continue;
          const d = Math.sqrt(d2) || 1e-9;
          const nx = dx / d;
          const ny = dy / d;
          const gap = 2 * R - d;
          a.x -= nx * gap * 0.5;
          a.y -= ny * gap * 0.5;
          b.x += nx * gap * 0.5;
          b.y += ny * gap * 0.5;
          const rvx = a.vx - b.vx;
          const rvy = a.vy - b.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn <= 1e-9) continue;
          const J = ((1 + PHYS.eBall) / 2) * vn;
          a.vx -= J * nx;
          a.vy -= J * ny;
          b.vx += J * nx;
          b.vy += J * ny;
          // ma sát tiếp tuyến
          const tx = -ny;
          const ty = nx;
          const slip = rvx * tx + rvy * ty + R * (a.wz + b.wz);
          const jt = Math.sign(slip) * Math.min(PHYS.muBall * J, Math.abs(slip) / 7);
          a.vx -= jt * tx;
          a.vy -= jt * ty;
          b.vx += jt * tx;
          b.vy += jt * ty;
          a.wz -= I_FACTOR * jt;
          b.wz -= I_FACTOR * jt;
          events.push({ t, k: 'ball', a: a.id, b: b.id, speed: vn });
          if (firstContact === null && (a.id === 0 || b.id === 0)) {
            firstContact = a.id === 0 ? b.id : a.id;
          }
        }
      }
    }
    // Lỗ và băng
    for (const b of balls) {
      if (b.pocketed) continue;
      const pk = pocketCheck(b);
      if (pk >= 0) {
        b.pocketed = true;
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        pocketed.push({ ball: b.id, pocket: pk, t });
        events.push({ t, k: 'pocket', ball: b.id, pocket: pk });
        continue;
      }
      const hit = cushion(b);
      if (hit > 0) {
        events.push({ t, k: 'cushion', ball: b.id, speed: hit });
        if (b.id !== 0) objectCushion.add(b.id);
        if (firstContact !== null) railAfterContact = true;
      }
    }
    // Dừng hẳn những bi đã gần đứng yên
    let allRest = true;
    for (const b of balls) {
      if (b.pocketed) continue;
      if (isAtRest(b)) {
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      } else allRest = false;
    }
    if (step % stepsPerFrame === 0) frames.push(snapshotFrame(balls));
    if (allRest && !anyMoving) break;
    if (allRest) {
      // tất cả dừng ngay trong bước này
      if (step % stepsPerFrame !== 0) frames.push(snapshotFrame(balls));
      break;
    }
  }
  // Nếu vì hết thời gian: ép dừng
  for (const b of balls) {
    b.vx = b.vy = b.wx = b.wy = b.wz = 0;
  }
  const last = snapshotFrame(balls);
  const prev = frames[frames.length - 1];
  if (!prev || prev.some((v, i) => v !== last[i])) frames.push(last);

  return {
    frames,
    events,
    finalBalls: balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed })),
    firstContact,
    pocketed,
    railAfterContact,
    objectBallsToCushion: objectCushion.size,
    cuePocketed: balls[0].pocketed,
    duration: t,
  };
}

function snapshotFrame(balls: Ball[]): number[] {
  const out: number[] = new Array(32);
  for (let i = 0; i < 16; i++) {
    const b = balls[i];
    if (b.pocketed) {
      out[i * 2] = -1;
      out[i * 2 + 1] = -1;
    } else {
      out[i * 2] = Math.round(b.x * 1000);
      out[i * 2 + 1] = Math.round(b.y * 1000);
    }
  }
  return out;
}

/** Trả về chỉ số lỗ nếu bi rơi xuống lỗ, ngược lại -1 */
function pocketCheck(b: Ball): number {
  for (let i = 0; i < POCKETS.length; i++) {
    const p = POCKETS[i];
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < p.r * 0.7) return i;
    if (d < p.r) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 1e-6 && (b.vx * dx + b.vy * dy) / (sp * d) > 0.5) return i;
    }
  }
  return -1;
}

/** Xử lý va chạm băng. Trả về tốc độ pháp tuyến nếu có va chạm, 0 nếu không. */
function cushion(b: Ball): number {
  let hit = 0;
  if (b.x < R) {
    hit = Math.max(hit, bounce(b, 1, 0));
    b.x = R;
  } else if (b.x > L - R) {
    hit = Math.max(hit, bounce(b, -1, 0));
    b.x = L - R;
  }
  if (b.y < R) {
    hit = Math.max(hit, bounce(b, 0, 1));
    b.y = R;
  } else if (b.y > W - R) {
    hit = Math.max(hit, bounce(b, 0, -1));
    b.y = W - R;
  }
  return hit;
}

/** (nx,ny) là pháp tuyến hướng vào trong bàn */
function bounce(b: Ball, nx: number, ny: number): number {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  const tx = -ny;
  const ty = nx;
  const vt = b.vx * tx + b.vy * ty;
  const e = Math.max(0.6, 0.85 - 0.03 * Math.abs(vn));
  const newVn = -e * vn;
  // ma sát tiếp tuyến ghép xoáy ngang
  const slip = vt - R * b.wz;
  const maxImpulse = PHYS.muCushion * (1 + e) * Math.abs(vn);
  const dvt = -Math.sign(slip) * Math.min(maxImpulse, Math.abs(slip) / 3.5);
  const newVt = vt + dvt;
  b.wz += -I_FACTOR * dvt;
  b.vx = newVn * nx + newVt * tx;
  b.vy = newVn * ny + newVt * ty;
  return -vn;
}
