import { TABLE, type BallState, type GameMode } from '@shared/protocol';

const R = TABLE.R;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const HEAD_SPOT = { x: TABLE.L * 0.25, y: TABLE.W / 2 };
export const FOOT_SPOT = { x: TABLE.L * 0.75, y: TABLE.W / 2 };

const GAP = 1.004; // khe hở ~0.2mm giữa các bi để không chồng nhau

/** Toạ độ các vị trí trong tam giác 15 bi (hàng 0 = đỉnh). */
export function triangleSlots(): Array<{ x: number; y: number; row: number; col: number }> {
  const out: Array<{ x: number; y: number; row: number; col: number }> = [];
  const dx = Math.sqrt(3) * R * GAP;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      out.push({ x: FOOT_SPOT.x + row * dx, y: FOOT_SPOT.y + (col - row / 2) * 2 * R * GAP, row, col });
    }
  }
  return out;
}

export function diamondSlots(): Array<{ x: number; y: number }> {
  const rows = [1, 2, 3, 2, 1];
  const dx = Math.sqrt(3) * R * GAP;
  const out: Array<{ x: number; y: number }> = [];
  rows.forEach((n, row) => {
    for (let c = 0; c < n; c++) {
      out.push({ x: FOOT_SPOT.x + row * dx, y: FOOT_SPOT.y + (c - (n - 1) / 2) * 2 * R * GAP });
    }
  });
  return out;
}

/** Xếp bi cho từng chế độ. Bi cái (id 0) ở chấm đầu bàn. */
export function initialBalls(mode: GameMode, seed: number): BallState[] {
  const rnd = mulberry32(seed);
  const balls: BallState[] = [];
  const cue: BallState = { id: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, pocketed: false };
  const jitter = () => (rnd() - 0.5) * 0.0001; // ±0.05mm cho mỗi lần phá khác nhau một chút

  if (mode === 'nineball') {
    const slots = diamondSlots(); // 9 vị trí: [0]=đỉnh, [4]=tâm
    const others = shuffle([2, 3, 4, 5, 6, 7, 8], rnd);
    const order: number[] = new Array(9);
    order[0] = 1;
    order[4] = 9;
    const rest = [1, 2, 3, 5, 6, 7, 8];
    rest.forEach((slot, i) => (order[slot] = others[i]));
    slots.forEach((s, i) => balls.push({ id: order[i], x: s.x + jitter(), y: s.y + jitter(), pocketed: false }));
  } else if (mode === 'eightball') {
    const slots = triangleSlots(); // index: 0 đỉnh; 4 = tâm hàng 3 ; 10 và 14 = hai góc đáy
    const solids = shuffle([1, 2, 3, 4, 5, 6, 7], rnd);
    const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], rnd);
    const order: number[] = new Array(15);
    order[4] = 8;
    order[10] = solids.pop()!;
    order[14] = stripes.pop()!;
    const rest = shuffle([...solids, ...stripes], rnd);
    for (let i = 0; i < 15; i++) if (order[i] === undefined) order[i] = rest.pop()!;
    slots.forEach((s, i) => balls.push({ id: order[i], x: s.x + jitter(), y: s.y + jitter(), pocketed: false }));
  } else {
    // rotation: 1 ở đỉnh, 2 và 3 ở hai góc đáy, 15 ở tâm
    const slots = triangleSlots();
    const order: number[] = new Array(15);
    order[0] = 1;
    order[10] = 2;
    order[14] = 3;
    order[4] = 15;
    const rest = shuffle([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], rnd);
    for (let i = 0; i < 15; i++) if (order[i] === undefined) order[i] = rest.pop()!;
    slots.forEach((s, i) => balls.push({ id: order[i], x: s.x + jitter(), y: s.y + jitter(), pocketed: false }));
  }
  balls.push(cue);
  balls.sort((a, b) => a.id - b.id);
  // Bi không dùng trong chế độ 9 bi: đánh dấu đã rơi lỗ để không chiếm chỗ
  const present = new Set(balls.map((b) => b.id));
  for (let i = 1; i <= 15; i++) if (!present.has(i)) balls.push({ id: i, x: 0, y: 0, pocketed: true });
  balls.sort((a, b) => a.id - b.id);
  return balls;
}

/** Tìm vị trí trống gần `want` nhất (dùng để đặt lại bi 8/9 sau khi phạm lỗi). */
export function findFreeSpot(balls: BallState[], want: { x: number; y: number }, ignoreId: number): { x: number; y: number } {
  const free = (x: number, y: number) =>
    balls.every((b) => b.id === ignoreId || b.pocketed || Math.hypot(b.x - x, b.y - y) >= 2 * R * 1.001);
  if (free(want.x, want.y)) return want;
  for (let k = 1; k < 200; k++) {
    const x = want.x + k * R * 0.5;
    if (x < TABLE.L - R && free(x, want.y)) return { x, y: want.y };
    const x2 = want.x - k * R * 0.5;
    if (x2 > R && free(x2, want.y)) return { x: x2, y: want.y };
  }
  return want;
}
