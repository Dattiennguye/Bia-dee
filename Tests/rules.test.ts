import { describe, expect, it } from 'vitest';
import { TABLE, type BallState } from '@shared/protocol';
import type { SimResult } from '@gameserver/physics';
import { Game } from '@gameserver/game';
import { chooseMove } from '@gameserver/ai';
import { mulberry32 } from '@gameserver/rack';
import { evaluateShot, newRuleState, teamOf, validateConfig, legalTargets, type RuleState } from '@gameserver/rules';

function balls(on: number[], cue: [number, number] = [0.6, 0.6]): BallState[] {
  const out: BallState[] = [{ id: 0, x: cue[0], y: cue[1], pocketed: false }];
  for (let i = 1; i <= 15; i++) {
    const idx = on.indexOf(i);
    out.push({ id: i, x: idx >= 0 ? 1.0 + idx * 0.07 : 0, y: idx >= 0 ? 0.3 + (idx % 3) * 0.2 : 0, pocketed: idx < 0 });
  }
  return out;
}

function sim(before: BallState[], o: Partial<SimResult> & { pocketedIds?: number[] }): SimResult {
  const pocketed = (o.pocketedIds ?? []).map((ball, i) => ({ ball, pocket: 0, t: i }));
  const finalBalls = before.map((b) => ({ ...b, pocketed: b.pocketed || pocketed.some((p) => p.ball === b.id) }));
  return {
    frames: [],
    events: [],
    finalBalls,
    firstContact: o.firstContact === undefined ? null : o.firstContact,
    pocketed,
    railAfterContact: o.railAfterContact ?? false,
    objectBallsToCushion: o.objectBallsToCushion ?? 0,
    cuePocketed: pocketed.some((p) => p.ball === 0),
    duration: 1,
  };
}

const cfg8 = { mode: 'eightball', teamMode: 'solo', seats: 2 } as const;

function midGame(cfg: RuleState['cfg'], seat = 0): RuleState {
  const rs = newRuleState(cfg, seat);
  rs.breakShot = false;
  rs.ballInHand = null;
  return rs;
}

describe('cấu hình', () => {
  it('kiểm tra số người hợp lệ', () => {
    expect(validateConfig({ mode: 'eightball', teamMode: 'solo', seats: 2 })).toBeNull();
    expect(validateConfig({ mode: 'eightball', teamMode: 'team', seats: 4 })).toBeNull();
    expect(validateConfig({ mode: 'eightball', teamMode: 'team', seats: 2 })).not.toBeNull();
    expect(validateConfig({ mode: 'eightball', teamMode: 'solo', seats: 4 })).not.toBeNull();
    expect(validateConfig({ mode: 'rotation', teamMode: 'solo', seats: 4 })).toBeNull();
    expect(validateConfig({ mode: 'nineball', teamMode: 'solo', seats: 5 })).not.toBeNull();
  });
  it('đội 2v2: ghế chẵn đội 0, ghế lẻ đội 1', () => {
    const c = { mode: 'nineball', teamMode: 'team', seats: 4 } as const;
    expect([0, 1, 2, 3].map((s) => teamOf(c, s))).toEqual([0, 1, 0, 1]);
  });
});

describe('8 bi', () => {
  it('gán nhóm theo bi đầu tiên vào lỗ hợp lệ và được đánh tiếp', () => {
    const rs = midGame(cfg8);
    const b = balls([1, 2, 9, 10, 8]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 1, pocketedIds: [1], railAfterContact: true }));
    expect(out.foul).toBe(false);
    expect(out.rs.groups[0]).toBe('solid');
    expect(out.rs.groups[1]).toBe('stripe');
    expect(out.rs.currentSeat).toBe(0);
  });
  it('chạm sai nhóm là lỗi, đối thủ được đặt bi tự do', () => {
    const rs = midGame(cfg8);
    rs.groups = ['solid', 'stripe'];
    const b = balls([1, 2, 9, 10, 8]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 9, railAfterContact: true }));
    expect(out.foul).toBe(true);
    expect(out.rs.currentSeat).toBe(1);
    expect(out.rs.ballInHand).toEqual({ seat: 1, headStringOnly: false });
  });
  it('bi cái rơi lỗ là lỗi và bi cái được đưa lại bàn để đặt', () => {
    const rs = midGame(cfg8);
    const b = balls([1, 9, 8]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 1, pocketedIds: [0], railAfterContact: true }));
    expect(out.foul).toBe(true);
    expect(out.balls[0].pocketed).toBe(false);
  });
  it('không bi nào vào lỗ/chạm băng là lỗi', () => {
    const rs = midGame(cfg8);
    const b = balls([1, 9, 8]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 1 }));
    expect(out.foul).toBe(true);
  });
  it('bi 8 vào lỗ khi chưa hết nhóm => thua ván', () => {
    const rs = midGame(cfg8);
    rs.groups = ['solid', 'stripe'];
    const b = balls([1, 9, 8]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 1, pocketedIds: [8], railAfterContact: true }));
    expect(out.frameOver).toBe(true);
    expect(out.rs.winnerTeam).toBe(1);
  });
  it('hết nhóm rồi đánh bi 8 vào lỗ hợp lệ => thắng', () => {
    const rs = midGame(cfg8);
    rs.groups = ['solid', 'stripe'];
    const b = balls([9, 8]);
    expect(legalTargets(rs, b)).toEqual([8]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 8, pocketedIds: [8], railAfterContact: true }));
    expect(out.rs.winnerTeam).toBe(0);
  });
  it('bi 8 vào lỗ kèm bi cái rơi lỗ => thua', () => {
    const rs = midGame(cfg8);
    rs.groups = ['solid', 'stripe'];
    const b = balls([9, 8]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 8, pocketedIds: [0, 8], railAfterContact: true }));
    expect(out.rs.winnerTeam).toBe(1);
  });
  it('phá bi: bi 8 vào lỗ được đặt lại, không thắng/thua', () => {
    const rs = newRuleState(cfg8, 0);
    const b = balls([1, 2, 8, 9]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 1, pocketedIds: [8], objectBallsToCushion: 4 }));
    expect(out.frameOver).toBe(false);
    expect(out.balls[8].pocketed).toBe(false);
  });
  it('phá bi không hợp lệ là lỗi', () => {
    const rs = newRuleState(cfg8, 0);
    const b = balls([1, 2, 8, 9]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 1, objectBallsToCushion: 2 }));
    expect(out.foul).toBe(true);
  });
});

describe('9 bi', () => {
  const cfg9 = { mode: 'nineball', teamMode: 'solo', seats: 2 } as const;
  it('phải chạm bi nhỏ nhất đầu tiên', () => {
    const rs = midGame(cfg9);
    const b = balls([2, 3, 9]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 3, railAfterContact: true }));
    expect(out.foul).toBe(true);
  });
  it('bi 9 vào lỗ hợp lệ => thắng', () => {
    const rs = midGame(cfg9);
    const b = balls([2, 9]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 2, pocketedIds: [9], railAfterContact: true }));
    expect(out.rs.winnerTeam).toBe(0);
  });
  it('bi 9 vào lỗ khi phạm lỗi => đặt lại bi 9', () => {
    const rs = midGame(cfg9);
    const b = balls([2, 9]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 9, pocketedIds: [9], railAfterContact: true }));
    expect(out.frameOver).toBe(false);
    expect(out.balls[9].pocketed).toBe(false);
  });
});

describe('Rotation', () => {
  it('cộng điểm theo số bi, phạt 1 điểm khi lỗi', () => {
    const cfg = { mode: 'rotation', teamMode: 'solo', seats: 3 } as const;
    const rs = midGame(cfg);
    const b = balls([1, 2, 3, 15]);
    let out = evaluateShot(rs, b, sim(b, { firstContact: 1, pocketedIds: [1, 2], railAfterContact: true }));
    expect(out.rs.scores[0]).toBe(3);
    expect(out.rs.currentSeat).toBe(0);
    const rs2 = out.rs;
    const b2 = out.balls;
    out = evaluateShot(rs2, b2, sim(b2, { firstContact: 15, railAfterContact: true }));
    expect(out.foul).toBe(true);
    expect(out.rs.scores[0]).toBe(2);
    expect(out.rs.currentSeat).toBe(1);
  });
  it('đạt 61 điểm là thắng ván', () => {
    const cfg = { mode: 'rotation', teamMode: 'team', seats: 4 } as const;
    const rs = midGame(cfg, 1);
    rs.scores = [10, 55];
    const b = balls([6, 7, 15]);
    const out = evaluateShot(rs, b, sim(b, { firstContact: 6, pocketedIds: [6], railAfterContact: true }));
    expect(out.frameOver).toBe(true);
    expect(out.rs.winnerTeam).toBe(1);
  });
});

describe('Game', () => {
  it('từ chối cú đánh sai lượt hoặc dữ liệu hỏng', () => {
    const g = new Game(cfg8, 1, 0);
    expect(() => g.shoot(1, { angle: 0, power: 1, spinX: 0, spinY: 0 })).toThrow();
    expect(() => g.shoot(0, { angle: NaN, power: 1, spinX: 0, spinY: 0 })).toThrow();
    expect(() => g.shoot(0, { angle: 0, power: Infinity, spinX: 0, spinY: 0 })).toThrow();
  });
  it('chỉ cho đặt bi cái sau vạch đầu bàn khi phá', () => {
    const g = new Game(cfg8, 1, 0);
    expect(g.place(0, TABLE.L * 0.6, 0.6)).not.toBeNull();
    expect(g.place(1, 0.5, 0.6)).not.toBeNull();
    expect(g.place(0, 0.5, 0.6)).toBeNull();
  });
  it('hết giờ chuyển lượt và cho đối thủ đặt bi', () => {
    const g = new Game(cfg8, 1, 0);
    g.timeoutFoul();
    expect(g.currentSeat).toBe(1);
    expect(g.rs.ballInHand?.seat).toBe(1);
  });
  it('rời trận: đối thủ thắng', () => {
    const g = new Game(cfg8, 1, 0);
    g.forfeit(1);
    expect(g.phase).toBe('over');
    expect(g.rs.winnerTeam).toBe(0);
  });
  it('rời trận ở bàn 3 người: ván tiếp tục', () => {
    const g = new Game({ mode: 'rotation', teamMode: 'solo', seats: 3 }, 1, 0);
    g.forfeit(1);
    expect(g.phase).toBe('playing');
    expect(g.rs.eliminated[1]).toBe(true);
  });

  const modes = [
    ['eightball', 'solo', 2],
    ['nineball', 'solo', 2],
    ['rotation', 'solo', 3],
    ['eightball', 'team', 4],
    ['rotation', 'team', 4],
    ['nineball', 'team', 4],
  ] as const;
  for (const [mode, teamMode, seats] of modes) {
    it(`bot chơi hết một ván ${mode}/${teamMode}/${seats} người, mọi bất biến luôn đúng`, () => {
      const g = new Game({ mode, teamMode, seats }, 42, 0);
      const rnd = mulberry32(9);
      let shots = 0;
      while (g.phase === 'playing' && shots < 500) {
        const mv = chooseMove(g.rs, g.balls, rnd, 0.9);
        const o = g.shoot(g.currentSeat, mv.shot, mv.cue);
        shots++;
        const live = g.balls.filter((b) => !b.pocketed);
        for (const b of live) {
          expect(b.x).toBeGreaterThanOrEqual(TABLE.R - 1e-6);
          expect(b.x).toBeLessThanOrEqual(TABLE.L - TABLE.R + 1e-6);
        }
        for (let i = 0; i < live.length; i++)
          for (let j = i + 1; j < live.length; j++)
            expect(Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y)).toBeGreaterThan(2 * TABLE.R * 0.999);
        expect(o.result.frameCount).toBeGreaterThan(0);
      }
      expect(g.phase).toBe('over');
      expect(g.rs.winnerTeam).not.toBeNull();
    });
  }
});
