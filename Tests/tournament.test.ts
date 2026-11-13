import { describe, expect, it } from 'vitest';
import { recordFrame, resolve, startTournament, standings, forfeitMatch, toSnapshot, type TournamentData, type TEntry } from '../Backend/src/tournament';

function make(format: TournamentData['format'], n: number, size: TournamentData['size'] = 8, bestOf: 1 | 3 | 5 = 3): TournamentData {
  const entries: TEntry[] = Array.from({ length: n }, (_, i) => ({ id: `E${i + 1}`, name: `P${i + 1}`, memberIds: [`p${i}`], memberNames: [`P${i + 1}`] }));
  const t: TournamentData = {
    code: 'TEST01', name: 't', size, format, gameMode: 'eightball', teamMode: 'solo', bestOf, isPublic: true,
    status: 'registration', adminHash: '', entries, matches: [], groups: [], koBuilt: false, champion: null, seed: 123, createdAt: 0,
  };
  startTournament(t);
  return t;
}

/** Chơi đến hết: người có số thứ tự nhỏ hơn luôn thắng. */
function playAll(t: TournamentData) {
  let guard = 0;
  while (t.status !== 'finished' && guard++ < 2000) {
    const m = t.matches.find((x) => x.status === 'ready' || x.status === 'playing');
    if (!m) break;
    const rank = (id: string) => Number(id.slice(1));
    const w = rank(m.a!) < rank(m.b!) ? m.a! : m.b!;
    while (!recordFrame(t, m.id, w));
  }
}

describe('Single Elimination', () => {
  for (const n of [2, 3, 4, 5, 8, 11, 16, 32]) {
    it(`${n} người: có nhà vô địch là hạt giống mạnh nhất, mỗi người chỉ thua tối đa 1 trận`, () => {
      const t = make('single', n, 32);
      playAll(t);
      expect(t.status).toBe('finished');
      expect(t.champion).toBe('E1');
      const losses = new Map<string, number>();
      for (const m of t.matches) if (!m.bye && m.loser) losses.set(m.loser, (losses.get(m.loser) ?? 0) + 1);
      for (const v of losses.values()) expect(v).toBe(1);
      expect(t.matches.filter((m) => !m.bye).length).toBe(n - 1);
    });
  }
  it('BYE tự động đi tiếp, không cần đánh', () => {
    const t = make('single', 5, 8);
    expect(t.matches.filter((m) => m.bye).length).toBe(3);
    expect(t.matches.filter((m) => m.status === 'ready').length).toBe(2); // 4v5 và 2v3 (hạt giống 1 có BYE vòng 1)
  });
  it('BO3: thắng 2 ván thì xong trận, tỉ số 2-1', () => {
    const t = make('single', 4, 4, 3);
    const m = t.matches.find((x) => x.status === 'ready')!;
    expect(recordFrame(t, m.id, m.a!)).toBe(false);
    expect(recordFrame(t, m.id, m.b!)).toBe(false);
    expect(recordFrame(t, m.id, m.a!)).toBe(true);
    expect([m.scoreA, m.scoreB]).toEqual([2, 1]);
    expect(m.winner).toBe(m.a);
  });
  it('xử thua: bên còn lại thắng và đi tiếp', () => {
    const t = make('single', 4, 4, 3);
    const m = t.matches.find((x) => x.status === 'ready')!;
    forfeitMatch(t, m.id, m.a!);
    expect(m.winner).toBe(m.b);
    const final = t.matches.find((x) => x.roundNo === 2)!;
    expect([final.a, final.b]).toContain(m.b);
  });
});

describe('Double Elimination', () => {
  for (const n of [4, 5, 8, 13, 16]) {
    it(`${n} người: hạt giống 1 vô địch, ai thua 2 trận thì bị loại`, () => {
      const t = make('double', n, 16);
      playAll(t);
      expect(t.status).toBe('finished');
      expect(t.champion).toBe('E1');
      const losses = new Map<string, number>();
      for (const m of t.matches) if (!m.bye && m.loser) losses.set(m.loser, (losses.get(m.loser) ?? 0) + 1);
      for (const [id, v] of losses) {
        if (id !== t.champion) expect(v).toBe(2);
        else expect(v).toBeLessThanOrEqual(1);
      }
    });
  }
  it('người từ nhánh thua thắng chung kết tổng => có chung kết phụ', () => {
    const t = make('double', 4, 4, 1);
    // E2 thua một trận ở nhánh thắng nhưng sau đó đánh bại tất cả
    let guard = 0;
    const strongest = (m: any) => (m.a === 'E2' ? m.a : m.b === 'E2' ? m.b : null);
    // cho E1 thắng nhánh thắng, E2 thắng nhánh thua rồi thắng chung kết tổng
    while (t.status !== 'finished' && guard++ < 100) {
      const m = t.matches.find((x) => x.status === 'ready');
      if (!m) break;
      let w: string;
      if (m.id === 'GF-1') w = m.b!; // nhánh thua thắng
      else if (m.id === 'GF-2') w = m.a === 'E2' || m.b === 'E2' ? 'E2' : m.a!;
      else w = Number(m.a!.slice(1)) < Number(m.b!.slice(1)) ? m.a! : m.b!;
      recordFrame(t, m.id, w);
    }
    expect(t.matches.some((m) => m.id === 'GF-2')).toBe(true);
    expect(t.status).toBe('finished');
    void strongest;
  });
});

describe('Round Robin', () => {
  it('mọi cặp gặp nhau đúng 1 lần, bảng xếp hạng đúng thứ tự', () => {
    const t = make('roundrobin', 6, 8, 1);
    expect(t.matches.length).toBe(15);
    const pairs = new Set(t.matches.map((m) => [m.a, m.b].sort().join('-')));
    expect(pairs.size).toBe(15);
    playAll(t);
    expect(t.status).toBe('finished');
    expect(t.champion).toBe('E1');
    const st = standings(t);
    expect(st.map((s) => s.entry)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
    expect(st[0].wins).toBe(5);
  });
  it('số lẻ người: người nghỉ mỗi vòng không tạo trận', () => {
    const t = make('roundrobin', 5, 8, 1);
    expect(t.matches.length).toBe(10);
  });
});

describe('Group Stage + Knockout', () => {
  for (const [n, groups] of [[8, 2], [16, 4], [32, 8], [4, 2]] as const) {
    it(`${n} người chia ${groups} bảng rồi đấu loại trực tiếp`, () => {
      const t = make('groupko', n, 32, 1);
      expect(t.groups.length).toBe(groups);
      expect(t.matches.every((m) => m.bracket === 'GS')).toBe(true);
      playAll(t);
      expect(t.status).toBe('finished');
      expect(t.champion).toBe('E1');
      expect(t.matches.some((m) => m.bracket === 'KO')).toBe(true);
    });
  }
  it('mỗi bảng đi tiếp 2 người; vòng loại trực tiếp chỉ có người đi tiếp', () => {
    const t = make('groupko', 8, 8, 1);
    playAll(t);
    const koIds = new Set(t.matches.filter((m) => m.bracket === 'KO' && m.roundNo === 1).flatMap((m) => [m.a, m.b]));
    expect(koIds.size).toBe(4);
  });
});

describe('Snapshot', () => {
  it('snapshot công khai không lộ mã quản trị', () => {
    const t = make('single', 4, 4);
    t.adminHash = 'secret-hash';
    const s = JSON.stringify(toSnapshot(t));
    expect(s).not.toContain('secret-hash');
    expect(s).not.toContain('adminHash');
  });
  it('resolve idempotent', () => {
    const t = make('double', 8, 8);
    const before = JSON.stringify(t.matches);
    resolve(t);
    expect(JSON.stringify(t.matches)).toBe(before);
  });
});
