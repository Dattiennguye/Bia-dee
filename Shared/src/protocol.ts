/**
 * Giao thức giữa Game Client (Unity) và Backend/Game Server.
 * Mọi thông điệp là JSON qua WebSocket: { t: "<loại>", ... }.
 * Đơn vị: mét, giây, radian. Hệ tọa độ bàn: x dọc theo chiều dài (0..L), y theo chiều rộng (0..W).
 */

export const TABLE = {
  /** Chiều dài mặt bàn (m) - bàn 9 feet */
  L: 2.54,
  /** Chiều rộng mặt bàn (m) */
  W: 1.27,
  /** Bán kính bi (m) */
  R: 0.028575,
  /** Bán kính vùng hút của lỗ góc (tính từ tâm lỗ) */
  CORNER_POCKET_R: 0.075,
  /** Bán kính vùng hút của lỗ giữa */
  SIDE_POCKET_R: 0.065,
} as const;

/** Tâm 6 lỗ: 0..3 là góc (0,0) (L,0) (0,W) (L,W); 4,5 là lỗ giữa (L/2,0) (L/2,W) */
export const POCKETS: ReadonlyArray<{ x: number; y: number; r: number }> = [
  { x: 0, y: 0, r: TABLE.CORNER_POCKET_R },
  { x: TABLE.L, y: 0, r: TABLE.CORNER_POCKET_R },
  { x: 0, y: TABLE.W, r: TABLE.CORNER_POCKET_R },
  { x: TABLE.L, y: TABLE.W, r: TABLE.CORNER_POCKET_R },
  { x: TABLE.L / 2, y: 0, r: TABLE.SIDE_POCKET_R },
  { x: TABLE.L / 2, y: TABLE.W, r: TABLE.SIDE_POCKET_R },
];

export type GameMode = 'eightball' | 'nineball' | 'rotation';
/** solo: mỗi người một mình; team: 2 đội, mỗi đội 2 người (cần đúng 4 người) */
export type TeamMode = 'solo' | 'team';

export const FRAME_HZ = 30;

export interface BallState {
  id: number; // 0 = bi cái, 1..15
  x: number;
  y: number;
  /** true nếu đã rơi lỗ (không còn trên bàn) */
  pocketed: boolean;
}

export interface ShotInput {
  /** Hướng đánh (rad), 0 = +x */
  angle: number;
  /** 0..1 */
  power: number;
  /** Điểm tiếp xúc ngang trên bi cái, -1..1 (phải dương) */
  spinX: number;
  /** Điểm tiếp xúc dọc, -1..1 (trên dương = bi tiến, dưới = bi lùi) */
  spinY: number;
}

export type TableEvent =
  | { t: number; k: 'cue'; speed: number }
  | { t: number; k: 'ball'; a: number; b: number; speed: number }
  | { t: number; k: 'cushion'; ball: number; speed: number }
  | { t: number; k: 'pocket'; ball: number; pocket: number };

export interface PlayerPublic {
  id: string;
  name: string;
  seat: number;
  team: number;
  connected: boolean;
  isBot: boolean;
  isHost: boolean;
}

export interface RoomConfig {
  mode: GameMode;
  teamMode: TeamMode;
  maxPlayers: 2 | 3 | 4;
  /** Số ván cần thắng (BO1=1, BO3=2, BO5=3) */
  winsNeeded: number;
  tournament?: { code: string; matchId: string };
}

export interface GameSnapshot {
  balls: BallState[];
  currentSeat: number;
  /** Bi cái đang trong tay: người chơi được đặt bi */
  ballInHand: null | { seat: number; headStringOnly: boolean };
  scores: Record<string, number>;
  /** 8 bi: nhóm của từng đội: "solid" | "stripe" | null */
  groups: Record<string, 'solid' | 'stripe' | null>;
  breakShot: boolean;
  phase: 'playing' | 'simulating' | 'over';
  turnDeadline: number | null;
  message: string;
}

export interface RoomSnapshot {
  code: string;
  config: RoomConfig;
  status: 'lobby' | 'playing' | 'finished';
  players: PlayerPublic[];
  frameWins: number[]; // theo đội
  frameNo: number;
  game: GameSnapshot | null;
  inviteUrl: string;
}

export interface ShotResultMsg {
  t: 'game.shotResult';
  seq: number;
  seat: number;
  shot: ShotInput;
  cueStart: { x: number; y: number };
  /**
   * Quỹ đạo 16 bi (id 0..15) lấy mẫu ở frameHz. tracks[i] = [x0,y0,x1,y1,...] (mm, số nguyên);
   * bi đã vào lỗ = -1,-1. Mảng được cắt ngắn khi bi dừng: sau mẫu cuối, bi đứng yên tại vị trí cuối.
   */
  tracks: number[][];
  /** Tổng số khung hình của cú đánh (bi dừng cuối cùng ở khung frameCount-1) */
  frameCount: number;
  frameHz: number;
  events: TableEvent[];
  snapshot: GameSnapshot;
  foul: boolean;
  foulReason: string | null;
}

export interface TournamentMatchPublic {
  id: string;
  round: string;
  bracket: 'W' | 'L' | 'GF' | 'RR' | 'GS' | 'KO';
  a: string | null; // entry id
  b: string | null;
  scoreA: number;
  scoreB: number;
  winner: string | null;
  status: 'waiting' | 'ready' | 'playing' | 'done';
  roomCode: string | null;
  /** true nếu là trận miễn đấu (một bên trống) */
  bye: boolean;
  /** số ván cần thắng của trận */
  winsNeeded: number;
}

export interface TournamentEntryPublic {
  id: string;
  name: string;
  members: string[];
}

export interface TournamentSnapshot {
  code: string;
  name: string;
  size: 4 | 8 | 16 | 32;
  format: 'single' | 'double' | 'roundrobin' | 'groupko';
  gameMode: GameMode;
  teamMode: TeamMode;
  bestOf: 1 | 3 | 5;
  isPublic: boolean;
  status: 'registration' | 'locked' | 'running' | 'finished';
  entries: TournamentEntryPublic[];
  matches: TournamentMatchPublic[];
  standings: Array<{ entry: string; played: number; wins: number; losses: number; diff: number; group?: string }>;
  champion: string | null;
}

// ---------- Client -> Server ----------
export type ClientMsg =
  | { t: 'auth'; sessionId?: string; name?: string }
  | { t: 'ping'; c: number }
  | { t: 'setName'; name: string }
  | { t: 'room.create'; mode: GameMode; teamMode: TeamMode; maxPlayers: 2 | 3 | 4; bestOf?: 1 | 3 | 5 }
  | { t: 'room.join'; code: string }
  | { t: 'room.leave' }
  | { t: 'room.addBot' }
  | { t: 'room.start' }
  | { t: 'game.place'; x: number; y: number }
  | { t: 'game.shot'; shot: ShotInput; cue?: { x: number; y: number } }
  | { t: 'game.aim'; angle: number; power: number }
  | { t: 'game.sync' }
  | { t: 'tour.create'; name: string; size: 4 | 8 | 16 | 32; format: TournamentSnapshot['format']; gameMode: GameMode; teamMode: TeamMode; bestOf: 1 | 3 | 5; isPublic: boolean }
  | { t: 'tour.join'; code: string; teamName?: string }
  | { t: 'tour.leave'; code: string }
  | { t: 'tour.watch'; code: string }
  | { t: 'tour.list' }
  | { t: 'tour.lock'; code: string; adminToken: string }
  | { t: 'tour.start'; code: string; adminToken: string }
  | { t: 'tour.forfeit'; code: string; adminToken: string; matchId: string; entryId: string }
  | { t: 'tour.joinMatch'; code: string; matchId: string };

// ---------- Server -> Client ----------
export type ServerMsg =
  | { t: 'auth.ok'; sessionId: string; playerId: string; name: string; serverTime: number; room: RoomSnapshot | null }
  | { t: 'pong'; c: number; serverTime: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'room.state'; room: RoomSnapshot }
  | { t: 'room.closed'; reason: string }
  | { t: 'game.start'; room: RoomSnapshot }
  | ShotResultMsg
  | { t: 'game.state'; room: RoomSnapshot }
  | { t: 'game.aim'; seat: number; angle: number; power: number }
  | { t: 'game.over'; room: RoomSnapshot; winnerTeam: number; frameWinnerTeam: number; matchOver: boolean; reason: string }
  | { t: 'player.status'; playerId: string; connected: boolean; graceMs: number }
  | { t: 'tour.created'; tournament: TournamentSnapshot; adminToken: string }
  | { t: 'tour.state'; tournament: TournamentSnapshot }
  | { t: 'tour.list'; tournaments: Array<{ code: string; name: string; size: number; entries: number; status: string; format: string }> }
  | { t: 'tour.matchRoom'; code: string; matchId: string; roomCode: string };
