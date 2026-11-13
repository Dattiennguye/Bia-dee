/**
 * Logic giải đấu thuần (không phụ thuộc mạng): tạo nhánh, tiến vòng, bảng xếp hạng.
 * Hỗ trợ: Single Elimination, Double Elimination (có trận chung kết phụ), Round Robin,
 * Group Stage + Knockout. Số người tham dự tối đa 4/8/16/32; nếu thiếu người, các vị trí trống = BYE.
 */
import type { GameMode, TeamMode, TournamentMatchPublic, TournamentSnapshot } from '@shared/protocol';
import { mulberry32 } from '@gameserver/rack';

export const BYE = 'BYE';

type Slot =
  | { kind: 'entry'; id: string }
  | { kind: 'winner'; from: string }
  | { kind: 'loser'; from: string }
  | { kind: 'none' };

export interface TMatch {
  id: string;
  round: string;
  roundNo: number;
  bracket: TournamentMatchPublic['bracket'];
  group?: string;
  slotA: Slot;
  slotB: Slot;
  a: string | null;
  b: string | null;
  scoreA: number;
  scoreB: number;
  winner: string | null;
  loser: string | null;
  bye: boolean;
  status: TournamentMatchPublic['status'];
  roomCode: string | null;
}

export interface TEntry {
  id: string;
  name: string;
  memberIds: string[];
  memberNames: string[];
}

export interface TournamentData {
  code: string;
  name: string;
  size: 4 | 8 | 16 | 32;
  format: TournamentSnapshot['format'];
  gameMode: GameMode;
  teamMode: TeamMode;
  bestOf: 1 | 3 | 5;
  isPublic: boolean;
  status: TournamentSnapshot['status'];
  adminHash: string;
  entries: TEntry[];
  matches: TMatch[];
  groups: string[][]; // danh sách entry id theo bảng
  koBuilt: boolean;
  champion: string | null;
  seed: number;
  createdAt: number;
}

export function winsNeeded(bestOf: number): number {
  return Math.ceil(bestOf / 2);
}

function nextPow2(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/** Thứ tự hạt giống chuẩn: hạt giống 1 gặp hạt giống P ở vòng 1, BYE dồn về các hạt giống đầu */
export function seedOrder(P: number): number[] {
  let order = [1, 2];
  while (order.length < P) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s, n + 1 - s);
    }
    order = next;
  }
  return order;
}

function newMatch(partial: Partial<TMatch> & Pick<TMatch, 'id' | 'round' | 'roundNo' | 'bracket' | 'slotA' | 'slotB'>): TMatch {
  return {
    a: null,
    b: null,
    scoreA: 0,
    scoreB: 0,
    winner: null,
    loser: null,
    bye: false,
    status: 'waiting',
    roomCode: null,
    ...partial,
  };
}

function roundName(roundsLeft: number, prefix = ''): string {
  if (roundsLeft === 0) return prefix + 'Chung kết';
  if (roundsLeft === 1) return prefix + 'Bán kết';
  if (roundsLeft === 2) return prefix + 'Tứ kết';
  return prefix + `Vòng ${roundsLeft + 1}`;
}

function buildSingle(ids: string[], ordered: boolean, bracket: 'W' | 'KO', idPrefix: string): TMatch[] {
  const P = nextPow2(ids.length);
  const slots: string[] = new Array(P);
  if (ordered) {
    for (let i = 0; i < P; i++) slots[i] = ids[i] ?? BYE;
  } else {
    const order = seedOrder(P);
    order.forEach((seed, pos) => (slots[pos] = ids[seed - 1] ?? BYE));
  }
  const R = Math.log2(P);
  const matches: TMatch[] = [];
  for (let r = 1; r <= R; r++) {
    const count = P / 2 ** r;
    for (let i = 0; i < count; i++) {
      const id = `${idPrefix}${r}-${i + 1}`;
      const label = roundName(R - r);
      if (r === 1) {
        matches.push(newMatch({ id, round: label, roundNo: r, bracket, slotA: { kind: 'entry', id: slots[2 * i] }, slotB: { kind: 'entry', id: slots[2 * i + 1] } }));
      } else {
        matches.push(
          newMatch({
            id,
            round: label,
            roundNo: r,
            bracket,
            slotA: { kind: 'winner', from: `${idPrefix}${r - 1}-${2 * i + 1}` },
            slotB: { kind: 'winner', from: `${idPrefix}${r - 1}-${2 * i + 2}` },
          }),
        );
      }
    }
  }
  return matches;
}

function buildDouble(ids: string[]): TMatch[] {
  const P = nextPow2(Math.max(4, ids.length));
  const R = Math.log2(P);
  const wb = buildSingle(ids.length < 4 ? [...ids, ...new Array(4 - ids.length).fill(BYE)] : ids, false, 'W', 'W');
  wb.forEach((m) => (m.round = roundName(R - m.roundNo, 'Nhánh thắng · ')));
  const matches: TMatch[] = [...wb];
  // Nhánh thua: 2(R-1) vòng
  let prev: string[] = [];
  let lbRound = 0;
  // LB1: loser của WB vòng 1 ghép cặp
  {
    lbRound++;
    const cnt = P / 4;
    const cur: string[] = [];
    for (let i = 0; i < cnt; i++) {
      const id = `L${lbRound}-${i + 1}`;
      matches.push(newMatch({ id, round: `Nhánh thua · Vòng ${lbRound}`, roundNo: lbRound, bracket: 'L', slotA: { kind: 'loser', from: `W1-${2 * i + 1}` }, slotB: { kind: 'loser', from: `W1-${2 * i + 2}` } }));
      cur.push(id);
    }
    prev = cur;
  }
  for (let k = 2; k <= R; k++) {
    // major: LB winners vs WB round k losers
    lbRound++;
    const wbCount = P / 2 ** k;
    const cur: string[] = [];
    for (let i = 0; i < wbCount; i++) {
      const id = `L${lbRound}-${i + 1}`;
      // đảo thứ tự loser để tránh gặp lại ngay
      const lw = `W${k}-${wbCount - i}`;
      matches.push(newMatch({ id, round: `Nhánh thua · Vòng ${lbRound}`, roundNo: lbRound, bracket: 'L', slotA: { kind: 'winner', from: prev[i] }, slotB: { kind: 'loser', from: lw } }));
      cur.push(id);
    }
    prev = cur;
    if (k < R) {
      // minor: ghép cặp các LB winners
      lbRound++;
      const cur2: string[] = [];
      for (let i = 0; i < prev.length / 2; i++) {
        const id = `L${lbRound}-${i + 1}`;
        matches.push(newMatch({ id, round: `Nhánh thua · Vòng ${lbRound}`, roundNo: lbRound, bracket: 'L', slotA: { kind: 'winner', from: prev[2 * i] }, slotB: { kind: 'winner', from: prev[2 * i + 1] } }));
        cur2.push(id);
      }
      prev = cur2;
    }
  }
  const wbFinal = `W${R}-1`;
  matches.push(newMatch({ id: 'GF-1', round: 'Chung kết tổng', roundNo: 1, bracket: 'GF', slotA: { kind: 'winner', from: wbFinal }, slotB: { kind: 'winner', from: prev[0] } }));
  return matches;
}

function buildRoundRobin(ids: string[], bracket: 'RR' | 'GS', prefix: string, group?: string): TMatch[] {
  const list = ids.slice();
  if (list.length % 2) list.push(BYE);
  const n = list.length;
  const out: TMatch[] = [];
  const arr = list.slice();
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      out.push(newMatch({ id: `${prefix}${r + 1}-${out.length + 1}`, round: `${group ? 'Bảng ' + group + ' · ' : ''}Lượt ${r + 1}`, roundNo: r + 1, bracket, group, slotA: { kind: 'entry', id: a }, slotB: { kind: 'entry', id: b } }));
    }
    arr.splice(1, 0, arr.pop()!);
  }
  return out;
}

function shuffleIds(ids: string[], seed: number): string[] {
  const rnd = mulberry32(seed);
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function groupLayout(n: number): { groups: number; advance: number } {
  if (n >= 8) {
    let g = 2;
    while (g * 2 * 4 <= n) g *= 2; // bảng ~4 người, số bảng là lũy thừa của 2
    return { groups: g, advance: 2 };
  }
  return { groups: 2, advance: 1 };
}

export function minEntries(format: TournamentSnapshot['format']): number {
  return format === 'roundrobin' || format === 'single' ? 2 : 4;
}

/** Sinh toàn bộ trận đấu khi bắt đầu giải */
export function startTournament(t: TournamentData): void {
  const ids = shuffleIds(
    t.entries.map((e) => e.id),
    t.seed,
  );
  t.groups = [];
  t.koBuilt = false;
  if (t.format === 'single') t.matches = buildSingle(ids, false, 'W', 'W');
  else if (t.format === 'double') t.matches = buildDouble(ids);
  else if (t.format === 'roundrobin') t.matches = buildRoundRobin(ids, 'RR', 'R');
  else {
    const { groups } = groupLayout(ids.length);
    const g: string[][] = Array.from({ length: groups }, () => []);
    ids.forEach((id, i) => {
      const row = Math.floor(i / groups);
      const col = i % groups;
      g[row % 2 === 0 ? col : groups - 1 - col].push(id); // chia rắn
    });
    t.groups = g;
    t.matches = g.flatMap((members, gi) => buildRoundRobin(members, 'GS', `G${String.fromCharCode(65 + gi)}`, String.fromCharCode(65 + gi)));
  }
  t.status = 'running';
  t.champion = null;
  resolve(t);
}

function matchById(t: TournamentData, id: string): TMatch | undefined {
  return t.matches.find((m) => m.id === id);
}

function slotValue(t: TournamentData, s: Slot): string | null {
  if (s.kind === 'entry') return s.id;
  if (s.kind === 'none') return null;
  const m = matchById(t, s.from);
  if (!m || m.status !== 'done') return null;
  return s.kind === 'winner' ? m.winner : m.loser;
}

/** Tính toán lại toàn bộ: điền người vào các vị trí, tự xử lý BYE, xác định vô địch. */
export function resolve(t: TournamentData): void {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const m of t.matches) {
      if (m.status === 'done') continue;
      const a = slotValue(t, m.slotA);
      const b = slotValue(t, m.slotB);
      if (a !== m.a) { m.a = a; changed = true; }
      if (b !== m.b) { m.b = b; changed = true; }
      if (m.a !== null && m.b !== null) {
        if (m.a === BYE || m.b === BYE) {
          m.bye = true;
          m.winner = m.a === BYE ? m.b : m.a;
          m.loser = BYE;
          m.status = 'done';
          changed = true;
        } else if (m.status === 'waiting') {
          m.status = 'ready';
          changed = true;
        }
      }
    }
    if (afterResolve(t)) changed = true;
  }
}

function afterResolve(t: TournamentData): boolean {
  let changed = false;
  if (t.format === 'double') {
    const gf1 = matchById(t, 'GF-1');
    if (gf1 && gf1.status === 'done' && !gf1.bye && gf1.winner === gf1.b && !matchById(t, 'GF-2')) {
      // người nhánh thua thắng chung kết tổng => đấu thêm một trận quyết định
      t.matches.push(newMatch({ id: 'GF-2', round: 'Chung kết phụ', roundNo: 2, bracket: 'GF', slotA: { kind: 'entry', id: gf1.a! }, slotB: { kind: 'entry', id: gf1.b! } }));
      changed = true;
    }
    const gf2 = matchById(t, 'GF-2');
    const final = gf2 ?? gf1;
    if (final && final.status === 'done' && !(final === gf1 && gf1.winner === gf1.b)) setChampion(t, final.winner);
    else if (gf2 && gf2.status === 'done') setChampion(t, gf2.winner);
  } else if (t.format === 'single') {
    const last = t.matches.filter((m) => m.bracket === 'W').sort((x, y) => y.roundNo - x.roundNo)[0];
    if (last && last.status === 'done') setChampion(t, last.winner);
  } else if (t.format === 'roundrobin') {
    if (t.matches.length > 0 && t.matches.every((m) => m.status === 'done')) {
      const st = standings(t);
      setChampion(t, st[0]?.entry ?? null);
    }
  } else if (t.format === 'groupko') {
    const gs = t.matches.filter((m) => m.bracket === 'GS');
    if (!t.koBuilt && gs.length > 0 && gs.every((m) => m.status === 'done')) {
      t.koBuilt = true;
      buildKnockoutFromGroups(t);
      changed = true;
    }
    if (t.koBuilt) {
      const ko = t.matches.filter((m) => m.bracket === 'KO');
      const last = ko.sort((x, y) => y.roundNo - x.roundNo)[0];
      if (last && last.status === 'done') setChampion(t, last.winner);
    }
  }
  return changed;
}

function setChampion(t: TournamentData, id: string | null): void {
  if (id && id !== BYE && t.champion !== id) {
    t.champion = id;
    t.status = 'finished';
  }
}

function buildKnockoutFromGroups(t: TournamentData): void {
  const { advance } = groupLayout(t.entries.length);
  const ranked = t.groups.map((_, gi) => standings(t, String.fromCharCode(65 + gi)).map((s) => s.entry));
  const G = ranked.length;
  const list: string[] = [];
  if (advance === 1) {
    for (let g = 0; g < G; g++) list.push(ranked[g][0]);
  } else {
    for (let g = 0; g < G; g += 2) {
      list.push(ranked[g][0], ranked[g + 1][1], ranked[g + 1][0], ranked[g][1]);
    }
  }
  t.matches.push(...buildSingle(list, true, 'KO', 'K'));
}

export interface Standing {
  entry: string;
  played: number;
  wins: number;
  losses: number;
  diff: number;
  group?: string;
}

export function standings(t: TournamentData, group?: string): Standing[] {
  const rows = new Map<string, Standing>();
  const source = t.matches.filter((m) => (t.format === 'groupko' ? m.bracket === 'GS' : m.bracket === 'RR') && (!group || m.group === group));
  const ensure = (id: string, g?: string) => {
    if (!rows.has(id)) rows.set(id, { entry: id, played: 0, wins: 0, losses: 0, diff: 0, group: g });
    return rows.get(id)!;
  };
  if (t.format === 'groupko') {
    t.groups.forEach((members, gi) => {
      const label = String.fromCharCode(65 + gi);
      if (!group || group === label) members.forEach((id) => ensure(id, label));
    });
  } else {
    t.entries.forEach((e) => ensure(e.id));
  }
  const h2h = new Map<string, string>();
  for (const m of source) {
    if (m.status !== 'done' || !m.a || !m.b) continue;
    const ra = ensure(m.a, m.group);
    const rb = ensure(m.b, m.group);
    ra.played++;
    rb.played++;
    ra.diff += m.scoreA - m.scoreB;
    rb.diff += m.scoreB - m.scoreA;
    if (m.winner === m.a) { ra.wins++; rb.losses++; } else { rb.wins++; ra.losses++; }
    h2h.set(`${m.a}|${m.b}`, m.winner!);
    h2h.set(`${m.b}|${m.a}`, m.winner!);
  }
  return [...rows.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.diff !== x.diff) return y.diff - x.diff;
    const w = h2h.get(`${x.entry}|${y.entry}`);
    if (w === x.entry) return -1;
    if (w === y.entry) return 1;
    return x.entry.localeCompare(y.entry, undefined, { numeric: true });
  });
}

/** Ghi nhận một ván thắng trong một trận. Trả về true nếu trận đã kết thúc. */
export function recordFrame(t: TournamentData, matchId: string, winnerEntry: string): boolean {
  const m = matchById(t, matchId);
  if (!m || m.status === 'done' || !m.a || !m.b) return false;
  if (winnerEntry === m.a) m.scoreA++;
  else if (winnerEntry === m.b) m.scoreB++;
  else return false;
  m.status = 'playing';
  const need = winsNeeded(t.bestOf);
  if (m.scoreA >= need || m.scoreB >= need) {
    finishMatch(t, m, m.scoreA >= need ? m.a : m.b);
    return true;
  }
  return false;
}

function finishMatch(t: TournamentData, m: TMatch, winner: string): void {
  m.winner = winner;
  m.loser = winner === m.a ? m.b : m.a;
  m.status = 'done';
  m.roomCode = m.roomCode;
  resolve(t);
}

/** Xử thua một bên (người tổ chức quyết định hoặc bỏ cuộc): bên kia thắng với tỉ số tối đa. */
export function forfeitMatch(t: TournamentData, matchId: string, loserEntry: string): boolean {
  const m = matchById(t, matchId);
  if (!m || m.status === 'done' || !m.a || !m.b) return false;
  if (loserEntry !== m.a && loserEntry !== m.b) return false;
  const need = winsNeeded(t.bestOf);
  const winner = loserEntry === m.a ? m.b : m.a;
  if (winner === m.a) m.scoreA = Math.max(m.scoreA, need);
  else m.scoreB = Math.max(m.scoreB, need);
  finishMatch(t, m, winner);
  return true;
}

export function publicMatch(t: TournamentData, m: TMatch): TournamentMatchPublic {
  return {
    id: m.id,
    round: m.round,
    bracket: m.bracket,
    a: m.a === BYE ? null : m.a,
    b: m.b === BYE ? null : m.b,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    winner: m.winner === BYE ? null : m.winner,
    status: m.status,
    roomCode: m.roomCode,
    bye: m.bye,
    winsNeeded: winsNeeded(t.bestOf),
  };
}

export function toSnapshot(t: TournamentData): TournamentSnapshot {
  return {
    code: t.code,
    name: t.name,
    size: t.size,
    format: t.format,
    gameMode: t.gameMode,
    teamMode: t.teamMode,
    bestOf: t.bestOf,
    isPublic: t.isPublic,
    status: t.status,
    entries: t.entries.map((e) => ({ id: e.id, name: e.name, members: e.memberNames, memberIds: e.memberIds })),
    matches: t.matches.map((m) => publicMatch(t, m)),
    standings: t.format === 'roundrobin' || (t.format === 'groupko' && t.matches.some((m) => m.bracket === 'GS')) ? standings(t) : [],
    champion: t.champion,
  };
}
