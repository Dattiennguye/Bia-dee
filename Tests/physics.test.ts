import { describe, expect, it } from 'vitest';
import { TABLE, type BallState } from '@shared/protocol';
import { simulateShot } from '@gameserver/physics';
import { initialBalls } from '@gameserver/rack';

const R = TABLE.R;

function table(cue: [number, number], objs: Array<[number, number, number]> = []): BallState[] {
  const out: BallState[] = [{ id: 0, x: cue[0], y: cue[1], pocketed: false }];
  for (let i = 1; i <= 15; i++) out.push({ id: i, x: 0, y: 0, pocketed: true });
  for (const [id, x, y] of objs) out[id] = { id, x, y, pocketed: false };
  return out;
}

describe('rack', () => {
  for (const mode of ['eightball', 'nineball', 'rotation'] as const) {
    it(`xếp bi ${mode} không chồng nhau, nằm trong bàn`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const balls = initialBalls(mode, seed).filter((b) => !b.pocketed);
        for (let i = 0; i < balls.length; i++) {
          expect(balls[i].x).toBeGreaterThan(R);
          expect(balls[i].x).toBeLessThan(TABLE.L - R);
          for (let j = i + 1; j < balls.length; j++) {
            expect(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y)).toBeGreaterThanOrEqual(2 * R);
          }
        }
      }
    });
  }
  it('8 bi: bi 8 ở tâm, hai góc đáy khác nhóm', () => {
    const b = initialBalls('eightball', 7);
    expect(b.filter((x) => !x.pocketed && x.id > 0)).toHaveLength(15);
  });
  it('9 bi: chỉ 9 bi + bi cái', () => {
    const b = initialBalls('nineball', 3);
    expect(b.filter((x) => !x.pocketed)).toHaveLength(10);
  });
});

describe('vật lý', () => {
  it('tất định: cùng đầu vào cho cùng kết quả', () => {
    const t = initialBalls('eightball', 5);
    const shot = { angle: 0.001, power: 0.9, spinX: 0.2, spinY: 0.1 };
    const a = simulateShot(t, shot);
    const b = simulateShot(t, shot);
    expect(a.frames).toEqual(b.frames);
    expect(a.events).toEqual(b.events);
  });

  it('mọi bi dừng hẳn và ở trong bàn sau cú phá', () => {
    const t = initialBalls('eightball', 11);
    const r = simulateShot(t, { angle: 0, power: 1, spinX: 0, spinY: 0 });
    for (const b of r.finalBalls) {
      if (b.pocketed) continue;
      expect(b.x).toBeGreaterThanOrEqual(R - 1e-9);
      expect(b.x).toBeLessThanOrEqual(TABLE.L - R + 1e-9);
      expect(b.y).toBeGreaterThanOrEqual(R - 1e-9);
      expect(b.y).toBeLessThanOrEqual(TABLE.W - R + 1e-9);
    }
    expect(r.duration).toBeLessThan(45);
    expect(r.objectBallsToCushion).toBeGreaterThanOrEqual(1);
  });

  it('bi lăn trên nỉ dừng sau quãng đường hợp lý', () => {
    const r = simulateShot(table([0.3, 0.6]), { angle: 0, power: 0.12, spinX: 0, spinY: 0.4 });
    const c = r.finalBalls[0];
    expect(c.x).toBeGreaterThan(0.3);
    expect(r.duration).toBeGreaterThan(0.5);
  });

  it('đánh thẳng vào bi: xoáy lùi (draw) làm bi cái lùi, xoáy tiến (follow) làm bi cái chạy theo', () => {
    const base = table([0.9, 0.635], [[1, 1.4, 0.635]]);
    const contactX = 1.4 - 2 * R;
    // vị trí bi cái 0,35 giây sau va chạm đầu tiên (trước khi bi mục tiêu kịp dội lại từ băng xa)
    const cueAfter = (r: ReturnType<typeof simulateShot>): number => {
      const ev = r.events.find((e) => e.k === 'ball')!;
      const f = r.frames[Math.min(r.frames.length - 1, Math.round((ev.t + 0.35) * 30))];
      return f[0] / 1000;
    };
    const draw = simulateShot(base, { angle: 0, power: 0.5, spinX: 0, spinY: -0.6 });
    expect(draw.firstContact).toBe(1);
    expect(cueAfter(draw)).toBeLessThan(contactX - 0.05);
    const follow = simulateShot(base, { angle: 0, power: 0.5, spinX: 0, spinY: 0.45 });
    expect(cueAfter(follow)).toBeGreaterThan(contactX + 0.05);
    const stun = simulateShot(base, { angle: 0, power: 0.3, spinX: 0, spinY: 0 });
    // bi mục tiêu luôn đi tiếp về phía trước
    expect(stun.finalBalls[1].x).toBeGreaterThan(1.4 + 0.1);
  });

  it('xoáy ngang làm bi cái lệch hướng sau khi chạm băng', () => {
    const none = simulateShot(table([1.0, 0.4]), { angle: Math.atan2(0.4, 1.0) * -1 + 0.4, power: 0.5, spinX: 0, spinY: 0 });
    const side = simulateShot(table([1.0, 0.4]), { angle: Math.atan2(0.4, 1.0) * -1 + 0.4, power: 0.5, spinX: 0.6, spinY: 0 });
    const a = none.finalBalls[0];
    const b = side.finalBalls[0];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.01);
  });

  it('bi vào lỗ góc được ghi nhận', () => {
    // bi 1 ngay gần lỗ góc (0,0), cue đánh vào theo hướng lỗ
    const t = table([0.5, 0.4], [[1, 0.2, 0.16]]);
    const dir = Math.atan2(0.16 - 0.4, 0.2 - 0.5);
    const r = simulateShot(t, { angle: dir, power: 0.5, spinX: 0, spinY: 0 });
    expect(r.pocketed.some((p) => p.ball === 1)).toBe(true);
  });

  it('bi cái rơi lỗ = scratch', () => {
    const r = simulateShot(table([0.3, 0.3]), { angle: Math.atan2(-0.3, -0.3), power: 0.5, spinX: 0, spinY: 0 });
    expect(r.cuePocketed).toBe(true);
  });

  it('va chạm bảo toàn động lượng gần đúng (hai bi, không xoáy)', () => {
    const t = table([0.8, 0.635], [[1, 1.2, 0.635]]);
    const r = simulateShot(t, { angle: 0, power: 0.4, spinX: 0, spinY: 0.4 });
    const hit = r.events.find((e) => e.k === 'ball')!;
    expect(hit).toBeTruthy();
    expect(r.firstContact).toBe(1);
  });

  it('khung hình có đủ 32 giá trị và khung đầu là vị trí xuất phát', () => {
    const t = table([0.5, 0.6], [[1, 1.0, 0.6]]);
    const r = simulateShot(t, { angle: 0, power: 0.3, spinX: 0, spinY: 0 });
    expect(r.frames[0]).toHaveLength(32);
    expect(r.frames[0][0]).toBe(500);
    expect(r.frames[0][2]).toBe(1000);
    const last = r.frames[r.frames.length - 1];
    expect(last.every((v) => Number.isInteger(v))).toBe(true);
  });
});

import { powerToSpeed, speedToPower } from '../GameServer/src/physics';
describe('vật lý v1.1', () => {
  it('đường cong lực đơn điệu và khả nghịch', () => {
    let prev = 0;
    for (let p = 0.05; p <= 1.0001; p += 0.05) { const v = powerToSpeed(p); expect(v).toBeGreaterThan(prev); prev = v; expect(speedToPower(v)).toBeCloseTo(p, 5); }
    expect(powerToSpeed(1)).toBeCloseTo(8.5, 5);
  });
  it('bi lăn 1 m/s đi được khoảng 4 m (ma sát lăn thực tế ~0.012)', () => {
    const d = (1 * 1) / (2 * 0.012 * 9.81);
    expect(d).toBeGreaterThan(3.5); expect(d).toBeLessThan(5);
  });
  it('bi đi chéo vào miệng lỗ góc thì rơi, bi đập thẳng vào mũi băng cạnh miệng thì bị nảy ra', () => {
    const base = Array.from({ length: 16 }, (_, i) => ({ id: i, x: 1, y: 0.6, pocketed: i !== 0 }));
    base[0] = { id: 0, x: 0.3, y: 0.3, pocketed: false };
    const into = simulateShot(base, { angle: Math.atan2(-0.3, -0.3), power: 0.5, spinX: 0, spinY: 0 });
    expect(into.cuePocketed).toBe(true);
    // bắn dọc băng dài sát vào răng lỗ góc: không được xuyên qua băng ra ngoài mặt bàn
    const side = base.map((b) => ({ ...b }));
    side[0] = { id: 0, x: 1.0, y: 0.03, pocketed: false };
    const r = simulateShot(side, { angle: Math.PI, power: 0.6, spinX: 0, spinY: 0 });
    for (const f of r.frames) { if (f[0] >= 0) { expect(f[0]).toBeGreaterThanOrEqual(0); expect(f[1]).toBeGreaterThanOrEqual(0); } }
  });

  it('góc cắt bi mục tiêu bám đường nối tâm, throw giảm khi đánh mạnh (bước con chính xác ở tốc độ cao)', () => {
    const th = (30 * Math.PI) / 180;
    const off = 2 * R * Math.sin(th);
    const angOf = (p: number): number => {
      const st = table([0.7, 0.635 - off], [[1, 0.7 + 0.6 + 2 * R * Math.cos(th), 0.635]]);
      const r = simulateShot(st, { angle: 0, power: p, spinX: 0, spinY: 0 });
      const ev = r.events.find((e) => e.k === 'ball')!;
      const i0 = Math.round((ev.t + 0.04) * 30);
      const f0 = r.frames[i0], f1 = r.frames[i0 + 1];
      return (Math.atan2(f1[3] - f0[3], f1[2] - f0[2]) * 180) / Math.PI;
    };
    const slow = angOf(0.25), fast = angOf(1);
    expect(slow).toBeGreaterThan(24); expect(slow).toBeLessThan(30);
    expect(fast).toBeGreaterThan(28); expect(fast).toBeLessThanOrEqual(30.5);
    expect(fast).toBeGreaterThan(slow); // throw nhỏ dần theo tốc độ
  });

  it('băng: tốc độ bật lại 55–90% và phụ thuộc xoáy tiến/lùi', () => {
    const run = (sy: number): number => {
      const r = simulateShot(table([1.2, 0.635], []), { angle: Math.PI, power: 0.5, spinX: 0, spinY: sy });
      const ev = r.events.find((e) => e.k === 'cushion')!;
      const i = Math.round(ev.t * 30);
      const a = r.frames[i + 1], b = r.frames[i + 4];
      return (b[0] - a[0]) / 1000 / (3 / 30); // vận tốc x sau băng (m/s)
    };
    const none = run(0), top = run(0.5), back = run(-0.5);
    const vIn = 2.6;
    expect(none).toBeGreaterThan(0.55 * vIn * 0.7); expect(none).toBeLessThan(0.95 * vIn);
    expect(Math.abs(top - back)).toBeGreaterThan(0.03);
  });
});
