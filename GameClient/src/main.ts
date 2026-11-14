import './styles.css';
import { Net, LS, normalizeServer } from './net';
import { audio } from './audio';
import { ic } from './icons';
import { music } from './music';
import { BilliardScene, ballColor, ENVS, TABLE_THEMES, type CamMode, type Quality } from './scene';
import { initialBalls } from '@gameserver/rack';
import {
  TABLE,
  type GameMode,
  type GameSnapshot,
  type PlayerPublic,
  type RoomSnapshot,
  type ServerMsg,
  type ShotResultMsg,
  type TeamMode,
  type TournamentMatchPublic,
  type TournamentSnapshot,
} from '@shared/protocol';

const { L, W, R } = TABLE;
const SEAT_COLORS = ['#ff5fa8', '#57d6ff', '#ffd34d', '#8f6bff'];
const MODE_INFO: Record<GameMode, { name: string; desc: string }> = {
  eightball: { name: 'BIDA 8 BI', desc: 'Nhóm trơn / sọc, đánh bi số 8 cuối cùng để thắng.' },
  nineball: { name: 'BIDA 9 BI', desc: 'Đánh theo thứ tự 1→9, bi số 9 vào lỗ là thắng.' },
  rotation: { name: 'ROTATION 61', desc: 'Bi vào lỗ được điểm bằng số bi. Ai đạt 61 điểm trước thắng. Hợp chơi 3–4 người.' },
};

const net = new Net();
const ui = document.getElementById('ui') as HTMLElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const toastBox = document.getElementById('toast') as HTMLElement;
const banner = document.getElementById('net-banner') as HTMLElement;

let scene: BilliardScene;
try {
  scene = new BilliardScene(canvas);
} catch (e) {
  ui.innerHTML = `<div class="screen bg"><h2>Thiết bị không hỗ trợ đồ họa 3D (WebGL)</h2><p class="sub">${esc((e as Error).message)}</p></div>`;
  throw e;
}

type Screen = 'splash' | 'main' | 'create' | 'join' | 'lobby' | 'game' | 'result' | 'tcreate' | 'tlist' | 'tbracket' | 'settings' | 'help' | 'themes';
let screen: Screen = 'splash';
let room: RoomSnapshot | null = null;
let tour: TournamentSnapshot | null = null;
let tourList: Array<{ code: string; name: string; size: number; entries: number; status: string; format: string }> = [];
const adminTokens: Record<string, string> = (() => { try { return JSON.parse(LS.get('vigo.admin') ?? '{}'); } catch { return {}; } })();
let pendingJoin: string | null = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? null;
const qpServer = new URLSearchParams(location.search).get('server');
if (qpServer) { net.server = normalizeServer(qpServer); LS.set('vigo.server', net.server); }

// cấu hình tạo phòng / giải
const cfg = { mode: 'eightball' as GameMode, teamMode: 'solo' as TeamMode, maxPlayers: 2 as 2 | 3 | 4, bestOf: 1 as 1 | 3 | 5 };
const tcfg = { name: '', size: 8 as 4 | 8 | 16 | 32, format: 'single' as TournamentSnapshot['format'], gameMode: 'eightball' as GameMode, teamMode: 'solo' as TeamMode, bestOf: 3 as 1 | 3 | 5, isPublic: true };

// trạng thái ván
let aimSent = 0;
let placing = false;
let shotPending = false;
let spin = { x: 0, y: 0 };
let afterPlay: Array<() => void> = [];
let lastTurnSeat = -1;
let timerHandle = 0;
let inGameScreenStart = 0;
let quality: Quality = (LS.get('vigo.quality') as Quality) || 'auto';

const hex6 = (n: number) => '#' + n.toString(16).padStart(6, '0');
/** Chọn bàn và không gian xung quanh (xem trước ngay trên cảnh nền) */
function themePicker(): string {
  return `<div><label class="lbl">Bàn bi-a</label><div class="swatches">${TABLE_THEMES.map((t) => `<button class="sw ${scene.tableId === t.id ? 'on' : ''}" data-tbl="${t.id}" title="${t.name}" style="--a:${hex6(t.felt)};--b:${hex6(t.wood === 0xffffff ? 0x6e3a1f : t.wood)};--c:${hex6(t.brass)}"><i></i><span>${t.name}</span></button>`).join('')}</div></div>
  <div><label class="lbl">Không gian xung quanh</label><div class="chips">${ENVS.map((e) => `<button class="chip ${scene.envId === e.id ? 'on' : ''}" data-env="${e.id}">${e.name}</button>`).join('')}</div></div>`;
}

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
const el = <T extends HTMLElement>(sel: string) => ui.querySelector(sel) as T | null;
const seatNames: Record<number, string> = {};
const mySeat = () => room?.players.find((p) => p.id === net.playerId)?.seat ?? -1;
const myTeam = () => room?.players.find((p) => p.id === net.playerId)?.team ?? -1;
const isHost = () => !!room?.players.find((p) => p.id === net.playerId)?.isHost;

function toast(text: string, kind: '' | 'bad' | 'good' = '', ms = 2200): void {
  const d = document.createElement('div');
  d.className = 'toast ' + kind;
  d.textContent = text;
  toastBox.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

function vibrate(ms: number): void {
  try { navigator.vibrate?.(ms); } catch { /* bỏ qua */ }
}

// ============ điều hướng ============
function go(s: Screen): void {
  screen = s;
  scene.menuMode = s !== 'game' && s !== 'result';
  clearInterval(timerHandle);
  clearInterval(miniHandle);
  const menuBg = ['splash', 'main', 'create', 'join', 'lobby', 'settings', 'help', 'tcreate', 'tlist', 'tbracket', 'themes'].includes(s);
  if (menuBg) {
    if (!scene.playing) {
      scene.aim.visible = false;
      scene.setCamMode('cinema');
      scene.startCelebration();
      showDemoRack();
    }
  } else {
    scene.stopCelebration();
  }
  const fn: Record<Screen, () => void> = { splash, main, create, join, lobby, game, result: () => {}, tcreate, tlist, tbracket, settings, help, themes };
  fn[s]();
  music.set(s === 'game' ? 'game' : 'menu');
  updateBanner();
}

function showDemoRack(): void {
  scene.setBalls(initialBalls('eightball', 7));
}

function connPill(): string {
  const st = net.status;
  const cls = st === 'online' ? 'on' : st === 'offline' ? 'off' : 'wait';
  const txt = st === 'online' ? `Trực tuyến${net.rtt ? ' · ' + net.rtt + 'ms' : ''}` : st === 'offline' ? (net.server ? 'Ngoại tuyến' : 'Chưa có máy chủ') : 'Đang kết nối…';
  return `<div class="pill" data-act="settings"><span class="dot ${cls}"></span>${txt}</div>`;
}

function backBtn(to: string): string {
  return `<button class="btn ghost small back" data-act="${to}">‹ Quay lại</button>`;
}

// ============ màn hình ============
function splash(): void {
  ui.innerHTML = `<div class="screen glass" data-act="skip">
    <div class="logoball"><b>9</b></div>
    <div class="logo">VIGO<br/>BILLIARDS<br/>PARTY</div>
    <div class="sub">Bida 3D trực tuyến · 2–4 người · Không cần tài khoản</div>
    <div class="loading" style="margin-top:22px"></div></div>`;
  setTimeout(() => { if (screen === 'splash') go('main'); }, 1700);
}

function main(): void {
  ui.innerHTML = `<div class="screen glass">
    ${connPill()}
    <div class="logo" style="font-size:clamp(30px,6vw,56px)">VIGO BILLIARDS<br/>PARTY</div>
    <div class="sub">Xin chào, <b data-act="settings" style="color:var(--gold);cursor:pointer">${esc(net.name || 'Khách')}</b>! Tạo phòng và rủ bạn bè cùng chơi.</div>
    <div class="menu">
      <button class="btn primary" data-act="quick"><span class="ic">${ic('bot', 26)}</span>CHƠI VỚI MÁY (OFFLINE)</button>
      <button class="btn gold" data-act="create"><span class="ic">${ic('ball', 26)}</span>TẠO PHÒNG</button>
      <button class="btn cyan" data-act="join"><span class="ic">${ic('key', 26)}</span>THAM GIA PHÒNG</button>
      <button class="btn" data-act="tlist"><span class="ic">${ic('trophy', 26)}</span>GIẢI ĐẤU</button>
      <div class="row center">
        <button class="btn ghost small" data-act="themes">${ic('palette', 18)} Giao diện</button>
        <button class="btn ghost small" data-act="help">${ic('book', 18)} Hướng dẫn</button>
        <button class="btn ghost small" data-act="settings">${ic('gear', 18)} Cài đặt</button>
      </div>
    </div></div>`;
}

/** Màn hình chọn bàn + không gian: bảng dưới, cảnh 3D xem trước phía trên */
function themes(): void {
  ui.innerHTML = `<div class="screen sheet">
    ${backBtn('main')}
    <div class="sheetbox">
      <h2>${ic('palette', 22)} Giao diện bàn & không gian</h2>
      ${themePicker()}
      <button class="btn gold" data-act="main">Xong</button>
    </div></div>`;
  scene.stopCelebration();
  scene.setCamMode('persp');
  scene.setBalls(initialBalls('eightball', 7).map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed })));
}

function create(): void {
  const modeCards = (['eightball', 'nineball', 'rotation'] as GameMode[])
    .map((m) => `<button class="mode ${cfg.mode === m ? 'on' : ''}" data-mode="${m}"><span class="n">${MODE_INFO[m].name}</span><span class="d">${MODE_INFO[m].desc}</span></button>`)
    .join('') + `<div class="mode soon"><span class="n">PARTY <span class="badge">SẮP RA MẮT</span></span><span class="d">Bàn đặc biệt, chướng ngại vật, thử thách vui nhộn.</span></div>`;
  const valid = (n: number) => !roomCfgError(cfg.mode, cfg.teamMode, n);
  ui.innerHTML = `<div class="screen bg">${backBtn('main')}${connPill()}
    <div class="panel"><h2>🎱 Tạo phòng</h2>
      <label class="lbl">Chế độ chơi</label><div class="modecards">${modeCards}</div>
      <label class="lbl" style="margin-top:14px">Số người</label>
      <div class="chips">${[2, 3, 4].map((n) => `<button class="chip ${cfg.maxPlayers === n ? 'on' : ''}" data-players="${n}" ${valid(n) ? '' : 'disabled'}>${n} người</button>`).join('')}</div>
      <label class="lbl" style="margin-top:14px">Cách chơi</label>
      <div class="chips">
        <button class="chip ${cfg.teamMode === 'solo' ? 'on' : ''}" data-team="solo">Cá nhân</button>
        <button class="chip ${cfg.teamMode === 'team' ? 'on' : ''}" data-team="team">Đội 2 vs 2</button></div>
      <label class="lbl" style="margin-top:14px">Số ván</label>
      <div class="chips">${[1, 3, 5].map((n) => `<button class="chip ${cfg.bestOf === n ? 'on' : ''}" data-bo="${n}">BO${n}</button>`).join('')}</div>
      <div class="row" style="margin-top:18px"><button class="btn gold grow" data-act="docreate">TẠO PHÒNG ONLINE ›</button><button class="btn ghost grow" data-act="offline">🤖 CHƠI VỚI MÁY</button></div>
    </div></div>`;
}

function roomCfgError(mode: GameMode, team: TeamMode, n: number): string | null {
  if (team === 'team' && n !== 4) return 'Đội 2v2 cần đúng 4 người';
  if (mode === 'eightball' && team === 'solo' && n !== 2) return '8 bi cá nhân chỉ dành cho 2 người';
  return null;
}

function fixCfg(): void {
  if (cfg.teamMode === 'team') cfg.maxPlayers = 4;
  else if (cfg.mode === 'eightball') cfg.maxPlayers = 2;
  else if (cfg.maxPlayers < 2) cfg.maxPlayers = 2;
}

function join(): void {
  ui.innerHTML = `<div class="screen bg">${backBtn('main')}${connPill()}
    <div class="panel col" style="align-items:stretch"><h2>🔑 Tham gia phòng</h2>
      <label class="lbl">Nhập mã phòng (5 ký tự)</label>
      <input id="code" class="codeinput" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="•••••" />
      <button class="btn cyan block" data-act="dojoin">VÀO PHÒNG ›</button>
      <div class="sub">Hoặc mở đường dẫn mời mà bạn bè gửi — game sẽ tự vào phòng.</div>
    </div></div>`;
  const inp = el<HTMLInputElement>('#code')!;
  inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') act('dojoin'); });
  setTimeout(() => inp.focus(), 100);
}

function lobby(): void {
  if (!room) return go('main');
  const r = room;
  const max = r.config.maxPlayers;
  const slots = Array.from({ length: max }, (_, seat) => {
    const p = r.players.find((x) => x.seat === seat);
    if (!p) return `<div class="slot"><div class="avatar" style="background:rgba(255,255,255,.12)">?</div><div><div class="pname" style="color:var(--muted)">Đang chờ…</div><div class="pmeta">Ghế ${seat + 1}</div></div></div>`;
    const col = SEAT_COLORS[seat];
    return `<div class="slot filled" style="background:linear-gradient(135deg, ${col}33, rgba(255,255,255,.06)); border-color:${col}">
      <div class="avatar" style="background:${col}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
      <div style="min-width:0"><div class="pname">${esc(p.name)}${p.isHost ? '<span class="tag">CHỦ PHÒNG</span>' : ''}${p.isBot ? '<span class="tag bot">MÁY</span>' : ''}${!p.connected ? '<span class="tag off">MẤT KẾT NỐI</span>' : ''}</div>
      <div class="pmeta">${r.config.teamMode === 'team' ? 'Đội ' + (p.team + 1) : 'Ghế ' + (seat + 1)}${p.id === net.playerId ? ' · Bạn' : ''}</div></div></div>`;
  }).join('');
  const full = r.players.length === max;
  const host = isHost();
  const link = r.inviteUrl;
  const tourRoom = !!r.config.tournament;
  ui.innerHTML = `<div class="screen bg">${connPill()}<button class="btn ghost small back" data-act="leave">‹ Rời phòng</button>
    <div class="col" style="width:min(760px,100%);align-items:center">
      <div class="sub" style="margin:0">${tourRoom ? '🏆 TRẬN ĐẤU GIẢI' : 'MÃ PHÒNG'} · ${MODE_INFO[r.config.mode].name} · ${r.config.teamMode === 'team' ? '2 vs 2' : 'Cá nhân'} · BO${r.config.winsNeeded * 2 - 1}</div>
      <div class="roomcode" data-act="copycode">${esc(r.code)}</div>
      ${tourRoom ? '' : `<div class="row center"><button class="btn small cyan" data-act="copycode">📋 Sao chép mã</button><button class="btn small ghost" data-act="invite">🔗 Gửi lời mời</button></div>`}
      <div class="slots">${slots}</div>
      <div class="sub">${full ? (tourRoom ? 'Đủ người — trận sắp bắt đầu…' : host ? 'Đủ người! Bấm bắt đầu.' : 'Đủ người — chờ chủ phòng bắt đầu…') : `Còn thiếu ${max - r.players.length} người · Chia sẻ mã <b>${esc(r.code)}</b> cho bạn bè`}</div>
      <div class="row center">
        ${host && !tourRoom && !full ? `<button class="btn" data-act="addbot">🤖 Thêm máy</button>` : ''}
        ${host && !tourRoom ? `<button class="btn gold" data-act="start" ${full ? '' : 'disabled'}>▶ BẮT ĐẦU</button>` : ''}
      </div>
      <input type="hidden" id="linkval" value="${esc(link)}" />
    </div></div>`;
}

// ---------- GAME ----------
const CAM_LIST: CamMode[] = ['top', 'persp', 'shoot', 'free', 'cinema'];
const CAM_ICON: Record<CamMode, string> = { top: ic('camTop'), persp: ic('cam3d'), shoot: ic('camCue'), free: ic('camFree'), cinema: ic('camFilm') };
const CAM_NAME: Record<CamMode, string> = { top: 'Trên xuống', persp: '3D', shoot: 'Sau cơ', free: 'Tự do', cinema: 'Phim' };
let gaugeDrag: null | { id: number; y0: number; moved: boolean; tick: number } = null;
let miniHandle = 0;
let msgFade = 0;
let dialTotal = 0;

function game(): void {
  inGameScreenStart = performance.now();
  ui.innerHTML = `<div class="hud">
    <div class="tl"><div class="players" id="players"></div><div class="frames" id="frames"></div></div>
    <div class="tc" id="tc"></div>
    <div class="tr">
      <button class="rbtn" data-act="camtoggle" id="cambtn" aria-label="Góc nhìn"><span id="camicon">${CAM_ICON[scene.camMode]}</span></button>
      <button class="rbtn" data-act="themeovl" aria-label="Giao diện">${ic('palette')}</button>
      <button class="rbtn" data-act="mute" id="mutebtn" aria-label="Âm thanh">${audio.sfxVol > 0 ? ic('vol') : ic('mute')}</button>
    </div>
    <div class="camlist" id="camlist" hidden>
      ${CAM_LIST.map((m, i) => `<button class="camitem ${scene.camMode === m ? 'on' : ''}" data-cam="${m}" title="${i + 1}"><span class="i">${CAM_ICON[m]}</span>${CAM_NAME[m]}</button>`).join('')}
    </div>
    <div class="msgbar" id="msgbar" hidden></div>
    <div class="bl"><button class="rbtn menu" data-act="pause" aria-label="Menu">${ic('menu')}</button><canvas class="mini" id="mini" width="176" height="92"></canvas></div>
    <div class="hint" id="hint"></div>
    <div class="dial" id="dial"><span class="dl">◀</span><div class="dialtrack" id="dialtrack"></div><span class="dl">▶</span></div>
    <div class="spin" id="spinbox"><div class="spinball" id="spinball"><div class="spindot" id="spindot" style="left:50%;top:50%"></div></div></div>
    <div class="gauge idle" id="gauge">
      <div class="gval" id="gval">LỰC</div>
      <div class="gtrack" id="gtrack"><div class="gfill" id="gfill"></div><div class="gticks"></div><div class="gcue" id="gcue"></div><div class="ghint">KÉO XUỐNG · THẢ ĐỂ ĐÁNH</div></div>
    </div>
  </div>`;
  bindGauge();
  bindSpin();
  bindDial();
  timerHandle = window.setInterval(updateTimer, 250);
  miniHandle = window.setInterval(drawMini, 66);
  scene.resize();
  refreshTurn();
  updateHud();
}

/** Cập nhật hình cần lực (0..1) */
function powerSet(v: number): void {
  v = Math.min(1, Math.max(0, v));
  scene.aim.power = v;
  const g = el('#gauge');
  const tr = el('#gtrack');
  if (!g || !tr) return;
  const span = tr.clientHeight * GAUGE_SPAN;
  const cue = el('#gcue');
  const fill = el('#gfill');
  const val = el('#gval');
  if (cue) cue.style.transform = `translateY(${v * span}px)`;
  if (fill) fill.style.height = v * span + 6 + 'px';
  if (val) val.textContent = v < 0.005 ? 'LỰC' : Math.round(v * 100) + '%';
  g.classList.toggle('idle', v < 0.005 && !gaugeDrag);
  g.classList.toggle('cancel', !!gaugeDrag && v < MIN_PULL);
}

const GAUGE_SPAN = 0.8; // phần chiều cao thanh mà cần có thể kéo xuống
const MIN_PULL = 0.04; // kéo ít hơn mức này rồi thả = huỷ

function bindGauge(): void {
  const g = el('#gauge')!;
  const tr = el('#gtrack')!;
  const span = () => tr.clientHeight * GAUGE_SPAN || 1;
  g.addEventListener('pointerdown', (e) => {
    if (!isMyTurn() || placing || gaugeDrag) return;
    audio.unlock();
  music.unlock();
    g.setPointerCapture(e.pointerId);
    gaugeDrag = { id: e.pointerId, y0: e.clientY - scene.aim.power * span(), moved: false, tick: 0 };
    g.classList.add('drag');
    e.preventDefault();
  });
  g.addEventListener('pointermove', (e) => {
    if (!gaugeDrag || gaugeDrag.id !== e.pointerId) return;
    const p = (e.clientY - gaugeDrag.y0) / span();
    if (Math.abs(p - scene.aim.power) > 0.004) gaugeDrag.moved = true;
    powerSet(p);
    const t = Math.floor(Math.min(1, Math.max(0, p)) * 10);
    if (t !== gaugeDrag.tick) { gaugeDrag.tick = t; vibrate(5); }
    sendAim();
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!gaugeDrag || gaugeDrag.id !== e.pointerId) return;
    const d = gaugeDrag;
    gaugeDrag = null;
    g.classList.remove('drag');
    if (d.moved) {
      if (!cancelled && scene.aim.power >= MIN_PULL) shoot();
      else { powerSet(0); if (!cancelled) toast('Đã huỷ cú đánh', '', 700); }
    }
    powerSet(scene.aim.power);
  };
  g.addEventListener('pointerup', (e) => end(e, false));
  g.addEventListener('pointercancel', (e) => end(e, true));
  powerSet(0);
}

function bindDial(): void {
  const d = el('#dial')!;
  const track = el('#dialtrack')!;
  let id = -1;
  let lastX = 0;
  d.addEventListener('pointerdown', (e) => { if (!isMyTurn() || placing) return; d.setPointerCapture(e.pointerId); id = e.pointerId; lastX = e.clientX; });
  d.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    scene.aim.angle += dx * 0.00045;
    dialTotal = (dialTotal + dx) % 14;
    track.style.setProperty('--dx', dialTotal + 'px');
    sendAim();
  });
  const end = (e: PointerEvent) => { if (e.pointerId === id) id = -1; };
  d.addEventListener('pointerup', end);
  d.addEventListener('pointercancel', end);
}

function bindSpin(): void {
  const sb = el('#spinball')!;
  const set = (ev: PointerEvent) => {
    const r = sb.getBoundingClientRect();
    let nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
    let ny = ((ev.clientY - r.top) / r.height) * 2 - 1;
    const m = Math.hypot(nx, ny);
    const lim = 0.7;
    if (m > lim) { nx = (nx / m) * lim; ny = (ny / m) * lim; }
    spin = { x: nx, y: -ny };
    const d = el('#spindot');
    if (d) { d.style.left = 50 + nx * 50 + '%'; d.style.top = 50 + ny * 50 + '%'; }
  };
  sb.addEventListener('pointerdown', (e) => { sb.setPointerCapture(e.pointerId); set(e); });
  sb.addEventListener('pointermove', (e) => { if (sb.hasPointerCapture(e.pointerId)) set(e); });
  sb.addEventListener('dblclick', () => { spin = { x: 0, y: 0 }; const d = el('#spindot'); if (d) { d.style.left = '50%'; d.style.top = '50%'; } });
}

/** Bản đồ nhỏ góc dưới trái */
function drawMini(): void {
  const cv = el<HTMLCanvasElement>('#mini');
  if (!cv || screen !== 'game') return;
  const g = cv.getContext('2d');
  if (!g) return;
  const w = cv.width, h = cv.height, pad = 7;
  const flip = mySeat() % 2 === 1 && (scene.camMode === 'persp' || scene.camMode === 'cinema');
  const sx = (w - 2 * pad) / L, sy = (h - 2 * pad) / W;
  const X = (x: number) => (flip ? w - pad - x * sx : pad + x * sx);
  const Y = (y: number) => (flip ? h - pad - y * sy : pad + y * sy);
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(70,34,20,.92)';
  g.beginPath(); g.roundRect(0, 0, w, h, 12); g.fill();
  g.fillStyle = hex6(scene.tableTheme.felt);
  g.beginPath(); g.roundRect(pad - 2, pad - 2, w - 2 * pad + 4, h - 2 * pad + 4, 5); g.fill();
  g.fillStyle = '#050505';
  for (const p of [[0, 0], [L, 0], [0, W], [L, W], [L / 2, 0], [L / 2, W]]) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 5, 0, 6.3); g.fill(); }
  const balls = scene.currentBalls();
  const c = balls[0];
  if (scene.aim.visible && !c.pocketed) {
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(X(c.x), Y(c.y));
    g.lineTo(X(c.x + Math.cos(scene.aim.angle) * 0.7), Y(c.y + Math.sin(scene.aim.angle) * 0.7)); g.stroke(); g.setLineDash([]);
  }
  for (const b of balls) {
    if (b.pocketed) continue;
    g.fillStyle = ballColor(b.id);
    g.beginPath(); g.arc(X(b.x), Y(b.y), 3.6, 0, 6.3); g.fill();
    if (b.id > 8) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(b.x), Y(b.y), 1.5, 0, 6.3); g.fill(); }
  }
}

function teamLabel(team: number): string {
  if (!room) return '';
  if (room.config.teamMode === 'team') {
    const names = [0, 1, 2, 3].filter((s) => s % 2 === team && seatNames[s]).map((s) => seatNames[s]);
    return `Đội ${team + 1}` + (names.length ? ` (${names.join(' & ')})` : '');
  }
  return seatNames[team] ?? `Người ${team + 1}`;
}

function ballChip(id: number, g: GameSnapshot): string {
  const out = g.balls[id].pocketed;
  return `<span class="tb ${id > 8 ? 'stripe' : ''} ${out ? 'out' : ''}" style="--c:${ballColor(id)}"><i>${id}</i></span>`;
}

/** Khay bi ở giữa phía trên: bi còn lại của người đang đánh */
function trayHtml(g: GameSnapshot): string {
  if (!room) return '';
  const shooter = room.players.find((p) => p.seat === g.currentSeat);
  if (room.config.mode === 'eightball') {
    const grp = shooter ? g.groups[String(shooter.team)] : null;
    if (!grp) return '<div class="tray open">Bàn mở · chưa chọn nhóm</div>';
    const ids = (grp === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]).concat([8]);
    return `<div class="tray">${ids.map((id) => ballChip(id, g)).join('')}</div>`;
  }
  const n = room.config.mode === 'nineball' ? 9 : 15;
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  return `<div class="tray ${n > 9 ? 'two' : ''}">${ids.map((id) => ballChip(id, g)).join('')}</div>`;
}

function capSub(p: PlayerPublic, g: GameSnapshot): string {
  if (!room) return '';
  if (room.config.mode === 'eightball') {
    const grp = g.groups[String(p.team)];
    return grp ? (grp === 'solid' ? '● Bi đặc' : '◖ Bi sọc') : 'Chưa chọn nhóm';
  }
  return `${room.config.mode === 'rotation' ? 'Điểm' : 'Bi vào'}: ${g.scores[String(p.team)] ?? 0}`;
}

function updateHud(): void {
  if (screen !== 'game' || !room || !room.game) return;
  const g = room.game;
  const pl = el('#players');
  if (pl) {
    const compact = room.players.length > 2;
    pl.innerHTML = room.players.map((p) => {
      const col = SEAT_COLORS[p.seat];
      const turn = g.currentSeat === p.seat && g.phase !== 'over';
      const me = p.id === net.playerId;
      return `<div class="cap ${turn ? 'turn' : ''} ${p.connected ? '' : 'off'} ${compact && !turn ? 'mini' : ''}" style="--pc:${col}"><div class="capin">
        <div class="av" style="background:${col}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
        <div class="cn"><b>${esc(p.name)}${me ? ' ★' : ''}${!p.connected ? ' ⚠' : ''}</b><small>${esc(capSub(p, g))}</small></div>
        ${turn ? '<div class="ctime" id="timer">–</div>' : ''}</div></div>`;
    }).join('');
  }
  const tc = el('#tc');
  if (tc) tc.innerHTML = trayHtml(g);
  const fr = el('#frames');
  if (fr) {
    const need = room.config.winsNeeded;
    fr.innerHTML = `Ván ${room.frameNo} · ${need * 2 - 1 === 1 ? 'BO1' : 'BO' + (need * 2 - 1)} · ${room.frameWins.join(' - ')}`;
  }
  const mb = el('#msgbar');
  if (mb) {
    if (mb.textContent !== g.message) {
      mb.hidden = !g.message; mb.textContent = g.message; mb.classList.remove('fade');
      mb.classList.toggle('foul', /^Lỗi|Hết giờ/.test(g.message));
      window.clearTimeout(msgFade);
      msgFade = window.setTimeout(() => mb.classList.add('fade'), 3200);
    }
  }
  updateTimer();
  updateControls();
}

function updateTimer(): void {
  const t = el('#timer');
  if (!t || !room?.game) return;
  const dl = room.game.turnDeadline;
  if (!dl || room.game.phase === 'over') { t.textContent = '–'; t.classList.remove('low'); return; }
  const s = Math.max(0, Math.ceil((dl - net.serverNow) / 1000));
  t.textContent = String(Math.min(99, s));
  t.classList.toggle('low', s <= 10);
}

function isMyTurn(): boolean {
  const g = room?.game;
  return !!g && room?.status === 'playing' && g.phase !== 'over' && g.currentSeat === mySeat() && !scene.playing && !shotPending;
}

function updateControls(): void {
  if (screen !== 'game') return;
  const my = isMyTurn();
  const g = room?.game;
  const bih = !!g?.ballInHand && g.ballInHand.seat === mySeat();
  scene.aim.visible = my && !placing;
  const show = (sel: string, v: boolean) => { const e = el(sel); if (e) e.style.display = v ? '' : 'none'; };
  show('#gauge', my);
  show('#spinbox', my && !placing);
  show('#dial', my && !placing);
  el('#gauge')?.classList.toggle('off', placing);
  const pb = el<HTMLButtonElement>('#placebtn');
  if (pb) { pb.hidden = !(my && bih); pb.textContent = placing ? '✅ Xong đặt bi' : '✋ Đặt bi cái'; }
  const hint = el('#hint');
  if (hint) {
    if (!my) hint.textContent = g && g.phase !== 'over' ? `Lượt của ${room!.players.find((p) => p.seat === g.currentSeat)?.name ?? ''}…` : '';
    else if (placing) hint.textContent = g?.breakShot ? 'Chạm/kéo để đặt bi cái sau vạch đầu bàn' : 'Chạm/kéo để đặt bi cái ở bất kỳ đâu';
    else hint.textContent = scene.camMode === 'free' ? 'Chế độ tự do: chuyển sang góc khác để ngắm' : bih ? 'Chạm vào bi cái để đặt lại vị trí' : '';
  }
  scene.setPlaceRing(my && placing, scene.ballPos(0).x, scene.ballPos(0).y, true);
}

function refreshTurn(): void {
  if (!room?.game) return;
  const g = room.game;
  const my = isMyTurn();
  if (my && lastTurnSeat !== g.currentSeat) {
    audio.turn();
    vibrate(60);
    // hướng ngắm ban đầu: về phía bi hợp lệ gần nhất / tam giác bi
    const c = scene.ballPos(0);
    placing = !!g.ballInHand && g.ballInHand.seat === mySeat() && !cuePlacementValid(c.x, c.y);
    let tx = L * 0.75, ty = W / 2, bd = Infinity;
    for (const b of g.balls) {
      if (b.id === 0 || b.pocketed) continue;
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      if (d < bd) { bd = d; tx = b.x; ty = b.y; }
    }
    scene.aim.angle = Math.atan2(ty - c.y, tx - c.x);
    powerSet(0);
    if (!LS.get('vigo.tut')) { toast('👆 Vuốt ngang để xoay · kéo cần lực xuống rồi THẢ TAY để đánh', '', 4200); LS.set('vigo.tut', '1'); }
  }
  lastTurnSeat = my ? g.currentSeat : -1;
  if (!my) { placing = false; }
  updateControls();
  updateHud();
}

function sendAim(): void {
  const now = performance.now();
  if (now - aimSent < 90) return;
  aimSent = now;
  net.send({ t: 'game.aim', angle: scene.aim.angle, power: scene.aim.power });
}

function shoot(): void {
  if (!isMyTurn() || !room?.game || placing) return;
  const g = room.game;
  const bih = !!g.ballInHand && g.ballInHand.seat === mySeat();
  const c = scene.ballPos(0);
  const shot = { angle: scene.aim.angle, power: Math.max(0.03, scene.aim.power), spinX: spin.x, spinY: spin.y };
  powerSet(0);
  net.send({ t: 'game.shot', shot, cue: bih ? { x: c.x, y: c.y } : undefined });
  shotPending = true;
  scene.localStroke(shot.power, shot.angle);
  scene.aim.visible = false;
  updateControls();
  setTimeout(() => {
    // nếu máy chủ không phản hồi sau 4 giây, cho phép đánh lại
    if (shotPending && !scene.playing) { shotPending = false; refreshTurn(); net.send({ t: 'game.sync' }); }
  }, 4000);
}

function cuePlacementValid(x: number, y: number): boolean {
  if (!room?.game) return false;
  if (x < R || x > L - R || y < R || y > W - R) return false;
  if (room.game.ballInHand?.headStringOnly && x > L * 0.25) return false;
  for (const b of room.game.balls) {
    if (b.id === 0 || b.pocketed) continue;
    if (Math.hypot(b.x - x, b.y - y) < 2 * R * 1.001) return false;
  }
  for (const [px, py, pr] of [[0, 0, 0.1], [L, 0, 0.1], [0, W, 0.1], [L, W, 0.1], [L / 2, 0, 0.09], [L / 2, W, 0.09]]) {
    if (Math.hypot(px - x, py - y) < pr) return false;
  }
  return true;
}

// ============ đầu vào trên bàn ============
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
let aimDrag: null | { touch: boolean; prevAng: number } = null;

function tablePoint(ev: PointerEvent): { x: number; y: number } | null {
  const r = canvas.getBoundingClientRect();
  return scene.pickTable(((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1));
}

function aimTo(p: { x: number; y: number }, touch: boolean): void {
  const c = scene.ballPos(0);
  const ang = Math.atan2(p.y - c.y, p.x - c.x);
  if (touch && aimDrag) {
    let d = ang - aimDrag.prevAng;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    scene.aim.angle += d;
    aimDrag.prevAng = ang;
  } else {
    scene.aim.angle = ang;
  }
  sendAim();
}

canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (screen !== 'game') return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    aimDrag = null;
    return;
  }
  if (scene.camMode === 'free' || (e.pointerType === 'mouse' && e.button === 2)) return;
  if (!isMyTurn()) return;
  const p = tablePoint(e);
  if (!p) return;
  if (placing) {
    if (!room?.game?.ballInHand) return;
    scene.moveCueBall(Math.min(L - R, Math.max(R, p.x)), Math.min(W - R, Math.max(R, p.y)));
    updateControls();
    return;
  }
  const touch = e.pointerType !== 'mouse';
  const c = scene.ballPos(0);
  // bi cái đang "trong tay": chạm vào chính bi cái để đặt lại
  if (room?.game?.ballInHand && Math.hypot(p.x - c.x, p.y - c.y) < 0.07) { placing = true; updateControls(); return; }
  aimDrag = { touch, prevAng: Math.atan2(p.y - c.y, p.x - c.x) };
  if (!touch) aimTo(p, false);
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId)!;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (screen !== 'game') return;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0 && scene.camMode !== 'shoot') {
      scene.zoomView(pinchDist / d);
      // trọng tâm hai ngón dịch chuyển => xoay/nghiêng góc nhìn
      scene.orbitView((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2);
    }
    pinchDist = d;
    return;
  }
  if (scene.camMode === 'free' || (e.pointerType === 'mouse' && (e.buttons & 2))) {
    scene.orbitView(e.clientX - prev.x, e.clientY - prev.y);
    return;
  }
  if (!isMyTurn()) return;
  const p = tablePoint(e);
  if (!p) return;
  if (placing) {
    if (e.buttons || e.pointerType !== 'mouse') { scene.moveCueBall(Math.min(L - R, Math.max(R, p.x)), Math.min(W - R, Math.max(R, p.y))); updateControls(); }
    return;
  }
  if (aimDrag) {
    if (aimDrag.touch) {
      // vuốt ngang để xoay hướng ngắm: chậm = tinh, nhanh = xoay nhiều
      const dx = e.clientX - prev.x;
      scene.aim.angle += dx * (0.0016 + 0.00012 * Math.abs(dx));
      sendAim();
    } else aimTo(p, false);
  }
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  aimDrag = null;
  if (screen === 'game' && placing && isMyTurn() && scene.camMode !== 'free') {
    const c = scene.ballPos(0);
    if (cuePlacementValid(c.x, c.y)) {
      net.send({ t: 'game.place', x: c.x, y: c.y });
      placing = false;
      updateControls();
    } else if (pointers.size === 0) {
      toast('Vị trí không hợp lệ', 'bad', 900);
      scene.setPlaceRing(true, c.x, c.y, false);
    }
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { if (screen === 'game' && scene.camMode !== 'shoot') { e.preventDefault(); scene.zoomView(e.deltaY > 0 ? 1.08 : 0.92); } }, { passive: false });
canvas.addEventListener('dblclick', () => { if (screen === 'game') scene.resetView(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (screen !== 'game') return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text')) return;
  const fine = e.shiftKey ? 0.02 : 0.004;
  if (e.key === 'ArrowLeft') { scene.aim.angle -= fine; sendAim(); }
  else if (e.key === 'ArrowRight') { scene.aim.angle += fine; sendAim(); }
  else if (e.key === 'ArrowUp') { powerSet(scene.aim.power + 0.03); sendAim(); }
  else if (e.key === 'ArrowDown') { powerSet(scene.aim.power - 0.03); sendAim(); }
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shoot(); }
  else if (['1', '2', '3', '4', '5'].includes(e.key)) setCam((['top', 'persp', 'shoot', 'free', 'cinema'] as CamMode[])[Number(e.key) - 1]);
  else if (e.key === 'c' || e.key === 'C') { const order: CamMode[] = ['top', 'persp', 'shoot', 'free', 'cinema']; setCam(order[(order.indexOf(scene.camMode) + 1) % order.length]); }
});

function setCam(m: CamMode): void {
  scene.setCamMode(m);
  document.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
  const ci = el('#camicon'); if (ci) ci.innerHTML = CAM_ICON[m];
  const cl = el('#camlist'); if (cl) cl.hidden = true;
  LS.set('vigo.cam', m);
}

// ============ kết quả ============
function showResult(m: Extract<ServerMsg, { t: 'game.over' }>): void {
  screen = 'result';
  music.set('result');
  room = m.room;
  const mine = m.winnerTeam === myTeam();
  const tourRoom = !!room.config.tournament;
  const rows = room.frameWins.map((w, t) => `<tr><td style="color:${SEAT_COLORS[t]}">${esc(teamLabel(t))}</td><td>${w}</td></tr>`).join('');
  const host = isHost();
  ui.innerHTML = `<div class="screen glass result">
    <div class="trophy">${mine ? '🏆' : '😅'}</div>
    <div class="sub" style="font-size:20px">${mine ? 'CHIẾN THẮNG!' : 'KẾT THÚC TRẬN'}</div>
    <div class="winname">${esc(teamLabel(m.winnerTeam))}</div>
    <div class="sub">${esc(m.reason)}</div>
    <table class="scoretable"><tbody>${rows}</tbody></table>
    <div class="row center">
      ${tourRoom ? `<button class="btn gold" data-act="backtour">VỀ BẢNG ĐẤU</button>` : host ? `<button class="btn gold" data-act="rematch">🔁 CHƠI LẠI</button>` : `<div class="sub">Chờ chủ phòng chơi lại…</div>`}
      <button class="btn ghost" data-act="leave">THOÁT</button>
    </div></div>`;
  if (mine) { audio.win(); confetti(); scene.startCelebration(); scene.setCamMode('cinema'); }
  else audio.lose();
}

function confetti(): void {
  const box = document.createElement('div');
  box.className = 'confetti';
  const cols = ['#ff5fa8', '#ffd34d', '#57d6ff', '#8f6bff', '#4be3a0'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = cols[i % cols.length];
    p.style.animationDuration = 2.2 + Math.random() * 2.5 + 's';
    p.style.animationDelay = Math.random() * 0.8 + 's';
    box.appendChild(p);
  }
  ui.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}

// ============ giải đấu ============
function tcreate(): void {
  const chips = <T,>(key: string, opts: Array<[T, string]>, cur: T) => `<div class="chips">${opts.map(([v, l]) => `<button class="chip ${cur === v ? 'on' : ''}" data-t-${key}="${String(v)}">${l}</button>`).join('')}</div>`;
  ui.innerHTML = `<div class="screen bg">${backBtn('tlist')}${connPill()}
    <div class="panel"><h2>🏆 Tạo giải đấu</h2>
      <label class="lbl">Tên giải</label><input id="tname" maxlength="16" value="${esc(tcfg.name)}" placeholder="VD: Giải Bida Cuối Tuần" />
      <label class="lbl" style="margin-top:12px">Số người / đội</label>${chips('size', [[4, '4'], [8, '8'], [16, '16'], [32, '32']], tcfg.size)}
      <label class="lbl" style="margin-top:12px">Thể thức</label>${chips('format', [['single', 'Loại trực tiếp'], ['double', 'Nhánh thắng/thua'], ['roundrobin', 'Vòng tròn'], ['groupko', 'Bảng + Loại trực tiếp']], tcfg.format)}
      <label class="lbl" style="margin-top:12px">Chế độ thi đấu</label>${chips('mode', [['eightball', '8 bi'], ['nineball', '9 bi'], ['rotation', 'Rotation']], tcfg.gameMode)}
      <label class="lbl" style="margin-top:12px">Cá nhân / đội</label>${chips('team', [['solo', 'Cá nhân (1v1)'], ['team', 'Đội 2 người (2v2)']], tcfg.teamMode)}
      <label class="lbl" style="margin-top:12px">Số ván mỗi trận</label>${chips('bo', [[1, 'BO1'], [3, 'BO3'], [5, 'BO5']], tcfg.bestOf)}
      <label class="lbl" style="margin-top:12px">Hiển thị</label>${chips('pub', [[true, 'Công khai'], [false, 'Riêng tư (chỉ vào bằng mã)']], tcfg.isPublic)}
      <div class="row" style="margin-top:16px"><button class="btn gold grow" data-act="dotcreate">TẠO GIẢI ›</button></div>
    </div></div>`;
}

function tlist(): void {
  net.send({ t: 'tour.list' });
  renderTlist();
}

function renderTlist(): void {
  if (screen !== 'tlist') return;
  const items = tourList.length
    ? tourList.map((t) => `<div class="titem"><div><b>${esc(t.name)}</b><small>${t.entries}/${t.size} · ${fmtName(t.format)} · ${t.status === 'registration' ? 'Đang đăng ký' : t.status === 'running' ? 'Đang đấu' : t.status === 'locked' ? 'Đã khóa' : 'Kết thúc'} · ${esc(t.code)}</small></div><button class="btn small cyan" data-open="${esc(t.code)}">Xem</button></div>`).join('')
    : `<div class="empty">Chưa có giải công khai nào.<br/>Hãy tạo giải đầu tiên!</div>`;
  ui.innerHTML = `<div class="screen bg">${backBtn('main')}${connPill()}
    <div class="panel"><h2>🏆 Giải đấu</h2>
      <div class="row"><input id="tcode" class="grow" maxlength="6" placeholder="Nhập mã giải (6 ký tự)" style="text-transform:uppercase;letter-spacing:4px;font-weight:800" /><button class="btn cyan" data-act="topen">VÀO</button></div>
      <label class="lbl" style="margin-top:14px">Giải công khai</label><div class="tlist">${items}</div>
      <div class="row" style="margin-top:14px"><button class="btn gold grow" data-act="tcreate">＋ TẠO GIẢI MỚI</button><button class="btn ghost" data-act="trefresh">↻</button></div>
    </div></div>`;
  const inp = el<HTMLInputElement>('#tcode');
  inp?.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
}

const fmtName = (f: string) => ({ single: 'Loại trực tiếp', double: 'Nhánh thắng/thua', roundrobin: 'Vòng tròn', groupko: 'Bảng + Loại trực tiếp' } as Record<string, string>)[f] ?? f;

function entryName(t: TournamentSnapshot, id: string | null): string {
  if (!id) return '—';
  const e = t.entries.find((x) => x.id === id);
  if (!e) return id;
  return t.teamMode === 'team' ? `${e.name}` : e.name;
}

function tbracket(): void {
  const t = tour;
  if (!t) return go('tlist');
  const admin = adminTokens[t.code];
  const meEntry = t.entries.find((e) => e.memberIds.includes(net.playerId));
  const status = { registration: 'Đang đăng ký', locked: 'Đã khóa đăng ký', running: 'Đang thi đấu', finished: 'Đã kết thúc' }[t.status];
  const matchCard = (m: TournamentMatchPublic) => {
    if (m.bye) return '';
    const mine = meEntry && (m.a === meEntry.id || m.b === meEntry.id) && (m.status === 'ready' || m.status === 'playing');
    const row = (id: string | null, sc: number) => `<div class="tm ${m.winner && m.winner === id ? 'win' : ''}"><span>${esc(entryName(t, id))}</span><span class="sc">${m.a || m.b ? sc : ''}</span></div>`;
    const stTxt = m.status === 'done' ? 'Đã xong' : m.status === 'playing' ? 'Đang đấu' : m.status === 'ready' ? 'Sẵn sàng' : 'Chờ kết quả';
    return `<div class="mcard ${m.status}">${row(m.a, m.scoreA)}${row(m.b, m.scoreB)}<div class="st">${stTxt} · thắng ${m.winsNeeded} ván</div>
      ${mine ? `<button class="btn small gold" data-joinmatch="${m.id}">▶ VÀO TRẬN</button>` : ''}
      ${admin && (m.status === 'ready' || m.status === 'playing') && m.a && m.b ? `<div class="row" style="padding:2px 4px"><button class="btn small ghost" data-forfeit="${m.id}|${m.a}">Xử thua ${esc(entryName(t, m.a))}</button><button class="btn small ghost" data-forfeit="${m.id}|${m.b}">Xử thua ${esc(entryName(t, m.b))}</button></div>` : ''}</div>`;
  };
  const sections: Array<[string, TournamentMatchPublic['bracket']]> = [['Nhánh thắng', 'W'], ['Nhánh thua', 'L'], ['Chung kết tổng', 'GF'], ['Vòng bảng', 'GS'], ['Vòng loại trực tiếp', 'KO'], ['Vòng tròn', 'RR']];
  const secHtml = sections.map(([title, br]) => {
    const ms = t.matches.filter((m) => m.bracket === br);
    if (!ms.length) return '';
    const rounds: string[] = [];
    ms.forEach((m) => { if (!rounds.includes(m.round)) rounds.push(m.round); });
    const cols = rounds.map((r) => `<div class="bcol"><h4>${esc(r)}</h4>${ms.filter((m) => m.round === r).map(matchCard).join('')}</div>`).join('');
    return `<div class="bsec"><h3>${title}</h3><div class="cols">${cols}</div></div>`;
  }).join('');
  const standing = t.standings.length
    ? `<div class="bsec"><h3>Bảng xếp hạng</h3><table class="tbl"><tr><th>#</th><th>Tên</th><th>Trận</th><th>Thắng</th><th>Thua</th><th>Hiệu số</th></tr>${t.standings.map((s, i) => `<tr><td>${i + 1}${s.group ? ' (' + s.group + ')' : ''}</td><td>${esc(entryName(t, s.entry))}</td><td>${s.played}</td><td>${s.wins}</td><td>${s.losses}</td><td>${s.diff}</td></tr>`).join('')}</table></div>`
    : '';
  const entries = `<div class="bsec"><h3>Người tham gia (${t.entries.length}/${t.size})</h3><div class="chips">${t.entries.map((e) => `<span class="chip">${esc(e.name)}${t.teamMode === 'team' ? ` <small>(${e.members.map(esc).join(', ')})</small>` : ''}</span>`).join('') || '<span class="sub">Chưa có ai đăng ký</span>'}</div></div>`;
  const reg = t.status === 'registration'
    ? (meEntry
      ? `<button class="btn ghost" data-act="tleave">Huỷ đăng ký</button>`
      : `${t.teamMode === 'team' ? `<input id="teamname" maxlength="16" placeholder="Tên đội (nhập trùng tên để ghép đội)" style="max-width:300px" />` : ''}<button class="btn gold" data-act="tjoin">ĐĂNG KÝ</button>`)
    : '';
  const adm = admin
    ? `${t.status === 'registration' ? `<button class="btn small cyan" data-act="tlock">🔒 Khóa đăng ký</button>` : ''}${t.status === 'registration' || t.status === 'locked' ? `<button class="btn small primary" data-act="tstart">▶ Bắt đầu giải</button>` : ''}`
    : '';
  ui.innerHTML = `<div class="screen bg" style="justify-content:flex-start">${backBtn('tlist')}${connPill()}
    <div class="panel wide" style="margin-top:44px">
      <div class="row" style="justify-content:space-between"><div><h2 style="margin:0">🏆 ${esc(t.name)}</h2><div class="sub" style="text-align:left">${fmtName(t.format)} · ${MODE_INFO[t.gameMode].name} · ${t.teamMode === 'team' ? '2v2' : '1v1'} · BO${t.bestOf} · <b data-act="copytour" style="color:var(--gold);cursor:pointer">MÃ ${esc(t.code)} 📋</b> · ${status}</div></div>
      <div class="row">${reg}${adm}</div></div>
      ${t.champion ? `<div class="result" style="text-align:center"><div class="trophy">🏆</div><div class="winname">VÔ ĐỊCH: ${esc(entryName(t, t.champion))}</div></div>` : ''}
      ${admin ? '<div class="sub" style="text-align:left">Bạn là người tổ chức giải (mã quản lý được lưu trên máy này).</div>' : ''}
      ${entries}
      <div class="bracketwrap">${secHtml || (t.status === 'running' || t.status === 'finished' ? '' : '<div class="empty">Bảng đấu sẽ được tạo khi giải bắt đầu.</div>')}${standing}</div>
    </div></div>`;
}

// ============ cài đặt / hướng dẫn ============
function settings(): void {
  ui.innerHTML = `<div class="screen bg">${backBtn('main')}
    <div class="panel col" style="align-items:stretch"><h2>${ic('gear', 22)} Cài đặt</h2>
      <div><label class="lbl">Biệt danh (không cần tài khoản)</label><input id="sname" maxlength="16" value="${esc(net.name)}" placeholder="Biệt danh của bạn" /></div>
      <div><label class="lbl">Nhạc nền</label><input class="range" type="range" id="vmusic" min="0" max="1" step="0.05" value="${audio.musicVol}" /></div>
      <div><label class="lbl">Âm thanh hiệu ứng</label><input class="range" type="range" id="vsfx" min="0" max="1" step="0.05" value="${audio.sfxVol}" /></div>
      <div><label class="lbl">Chất lượng đồ họa</label><div class="chips">${(['auto', 'low', 'medium', 'high'] as Quality[]).map((q) => `<button class="chip ${quality === q ? 'on' : ''}" data-q="${q}">${{ auto: 'Tự động', low: 'Thấp', medium: 'Trung bình', high: 'Cao' }[q]}</button>`).join('')}</div></div>
      ${themePicker()}
      <div><label class="lbl">Máy chủ game</label><input id="sserver" value="${esc(net.server)}" placeholder="vd: bida.example.com" autocapitalize="none" autocomplete="off" />
      <div class="pmeta" style="margin-top:4px">Trạng thái: ${net.status === 'online' ? '🟢 đã kết nối' : net.status === 'offline' ? '🔴 ngoại tuyến' : '🟡 đang kết nối'} ${net.lastError && net.status !== 'online' ? '· ' + esc(net.lastError) : ''}</div></div>
      <button class="btn gold block" data-act="savesettings">LƯU</button>
    </div></div>`;
  el<HTMLInputElement>('#vmusic')!.addEventListener('input', (e) => { audio.unlock(); music.unlock(); audio.setMusic(Number((e.target as HTMLInputElement).value)); });
  el<HTMLInputElement>('#vsfx')!.addEventListener('input', (e) => { audio.unlock(); audio.setSfx(Number((e.target as HTMLInputElement).value)); audio.click(); });
}

function help(): void {
  ui.innerHTML = `<div class="screen bg" style="justify-content:flex-start">${backBtn('main')}
    <div class="panel" style="margin-top:44px"><h2>${ic('book', 22)} Hướng dẫn chơi</h2><ul class="slides">
      <li><b>Vào phòng:</b> một người bấm <b>Tạo phòng</b>, những người còn lại nhập <b>mã phòng</b> (hoặc mở đường dẫn mời). Không cần tài khoản.</li>
      <li><b>Ngắm:</b> kéo ngón tay (hoặc chuột) trên bàn để xoay hướng cơ. Dùng thanh <b>Tinh chỉnh</b> để chỉnh nhỏ. Vạch trắng là đường đi, vạch vàng là hướng bi bị đánh.</li>
      <li><b>Lực:</b> chạm cần ở mép phải, <b>kéo xuống</b> để lấy đà rồi <b>thả tay</b> để đánh. Kéo về lại đỉnh rồi thả = huỷ.</li>
      <li><b>Xoáy:</b> chạm vào quả bi trắng bên phải: <b>trên</b> = bi chạy theo, <b>dưới</b> = bi giật lùi, <b>trái/phải</b> = xoáy ngang. Nhấp đúp để về giữa.</li>
      <li><b>Camera:</b> Trên (nhìn từ trên xuống), 3D, Sau cơ, Tự do (kéo để xoay, cuộn/chụm để zoom) và Phim (tự động theo cú đánh).</li>
      <li><b>Phím tắt (PC):</b> ←/→ ngắm tinh, ↑/↓ lực, Space đánh, 1–5 đổi camera.</li>
      <li><b>8 bi:</b> đánh hết nhóm của mình rồi bi số 8. <b>9 bi:</b> luôn chạm bi nhỏ nhất trước; bi 9 vào lỗ là thắng. <b>Rotation:</b> bi vào lỗ được điểm bằng số bi, đạt 61 điểm thắng.</li>
      <li><b>Phạm lỗi</b> (bi cái rơi lỗ, chạm sai bi, không chạm băng…): đối thủ được <b>đặt bi cái tự do</b>.</li>
      <li><b>Mất mạng?</b> Cứ mở lại game — bạn sẽ được đưa về đúng bàn đang chơi trong 60 giây.</li>
    </ul></div></div>`;
}

// ============ xử lý hành động ============
function act(a: string, node?: HTMLElement): void {
  audio.unlock();
  if (a !== 'shoot') audio.click();
  switch (a) {
    case 'skip': if (screen === 'splash') go('main'); break;
    case 'main': go('main'); break;
    case 'create': fixCfg(); go('create'); break;
    case 'join': go('join'); break;
    case 'settings': go('settings'); break;
    case 'help': go('help'); break;
    case 'themes': go('themes'); break;
    case 'themeovl': {
      ui.querySelector('.themeovl')?.remove();
      const d = document.createElement('div');
      d.className = 'screen sheet themeovl';
      d.innerHTML = `<div class="sheetbox"><h2>${ic('palette', 22)} Bàn & không gian</h2>${themePicker()}<button class="btn gold" data-act="themeclose">Xong</button></div>`;
      ui.appendChild(d);
      break;
    }
    case 'themeclose': ui.querySelector('.themeovl')?.remove(); break;
    case 'tlist': go('tlist'); break;
    case 'tcreate': go('tcreate'); break;
    case 'trefresh': net.send({ t: 'tour.list' }); break;
    case 'quick':
      net.startLocal('eightball', 'solo', 2, 1);
      break;
    case 'offline':
      net.startLocal(cfg.mode, cfg.teamMode, cfg.maxPlayers, cfg.bestOf);
      break;
    case 'docreate':
      net.send({ t: 'room.create', mode: cfg.mode, teamMode: cfg.teamMode, maxPlayers: cfg.maxPlayers, bestOf: cfg.bestOf });
      break;
    case 'dojoin': {
      const code = (el<HTMLInputElement>('#code')?.value ?? '').trim();
      if (code.length < 3) return toast('Hãy nhập mã phòng', 'bad');
      net.send({ t: 'room.join', code });
      break;
    }
    case 'leave':
      net.send({ t: 'room.leave' });
      net.stopLocal();
      room = null; shotPending = false; placing = false; afterPlay = [];
      scene.stopCelebration();
      go(tour && screen === 'result' && false ? 'tbracket' : 'main');
      break;
    case 'backtour': {
      const code = room?.config.tournament?.code;
      net.send({ t: 'room.leave' });
      net.stopLocal();
      room = null;
      if (code) { net.send({ t: 'tour.watch', code }); } else go('main');
      break;
    }
    case 'copycode': copy(room?.code ?? ''); toast('Đã sao chép mã phòng', 'good', 1200); break;
    case 'invite': shareInvite(); break;
    case 'addbot': net.send({ t: 'room.addBot' }); break;
    case 'start': net.send({ t: 'room.start' }); break;
    case 'rematch': net.send({ t: 'room.start' }); break;
    case 'shoot': shoot(); break;
    case 'pause': pauseMenu(); break;
    case 'camtoggle': { const cl = el('#camlist'); if (cl) cl.hidden = !cl.hidden; break; }
    case 'mute': { const off = audio.sfxVol > 0 || audio.musicVol > 0; audio.setSfx(off ? 0 : 0.8); audio.setMusic(off ? 0 : 0.5); const b = el('#mutebtn'); if (b) b.innerHTML = off ? ic('mute') : ic('vol'); break; }
    case 'placebtn': placing = !placing; updateControls(); break;
    case 'resume': ui.querySelector('.pausebox')?.remove(); break;
    case 'savesettings': {
      net.setName(el<HTMLInputElement>('#sname')!.value || net.name);
      const srv = el<HTMLInputElement>('#sserver')!.value;
      if (normalizeServer(srv) !== net.server || net.status !== 'online') net.setServer(srv);
      toast('Đã lưu cài đặt', 'good', 1200);
      go('main');
      break;
    }
    case 'dotcreate': {
      tcfg.name = el<HTMLInputElement>('#tname')?.value ?? '';
      net.send({ t: 'tour.create', name: tcfg.name, size: tcfg.size, format: tcfg.format, gameMode: tcfg.gameMode, teamMode: tcfg.teamMode, bestOf: tcfg.bestOf, isPublic: tcfg.isPublic });
      break;
    }
    case 'topen': {
      const code = (el<HTMLInputElement>('#tcode')?.value ?? '').trim();
      if (code.length < 3) return toast('Hãy nhập mã giải', 'bad');
      net.send({ t: 'tour.watch', code });
      break;
    }
    case 'tjoin': net.send({ t: 'tour.join', code: tour!.code, teamName: el<HTMLInputElement>('#teamname')?.value }); break;
    case 'tleave': net.send({ t: 'tour.leave', code: tour!.code }); break;
    case 'tlock': net.send({ t: 'tour.lock', code: tour!.code, adminToken: adminTokens[tour!.code] }); break;
    case 'tstart': net.send({ t: 'tour.start', code: tour!.code, adminToken: adminTokens[tour!.code] }); break;
    case 'copytour': copy(tour?.code ?? ''); toast('Đã sao chép mã giải', 'good', 1200); break;
  }
  void node;
}
let quickBot: 0 | 1 | 2 = 0;

function copy(text: string): void {
  try { void navigator.clipboard?.writeText(text); } catch { /* bỏ qua */ }
}

function shareInvite(): void {
  if (!room) return;
  const data = { title: 'VIGO BILLIARDS PARTY', text: `Vào phòng bida của mình! Mã phòng: ${room.code}`, url: room.inviteUrl };
  if (navigator.share) void navigator.share(data).catch(() => undefined);
  else { copy(`${data.text}\n${data.url}`); toast('Đã sao chép lời mời', 'good', 1400); }
}

function pauseMenu(): void {
  const d = document.createElement('div');
  d.className = 'screen glass pausebox';
  d.innerHTML = `<div class="panel col" style="align-items:stretch"><h2>Tạm dừng</h2>
    <div class="sub">Ván đấu trực tuyến vẫn tiếp tục khi bạn mở menu.</div>
    <div><label class="lbl">Chất lượng đồ họa</label><div class="chips">${(['auto', 'low', 'medium', 'high'] as Quality[]).map((q) => `<button class="chip ${quality === q ? 'on' : ''}" data-q="${q}">${{ auto: 'Tự động', low: 'Thấp', medium: 'Trung bình', high: 'Cao' }[q]}</button>`).join('')}</div></div>
    ${themePicker()}
    <button class="btn gold block" data-act="resume">${ic('play', 18)} TIẾP TỤC</button>
    <button class="btn ghost block" data-act="leave">${ic('exit', 18)} RỜI TRẬN</button></div>`;
  ui.appendChild(d);
}

ui.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const n = t.closest('[data-act]') as HTMLElement | null;
  const cam = t.closest('[data-cam]') as HTMLElement | null;
  const mode = t.closest('[data-mode]') as HTMLElement | null;
  const pl = t.closest('[data-players]') as HTMLElement | null;
  const tm = t.closest('[data-team]') as HTMLElement | null;
  const bo = t.closest('[data-bo]') as HTMLElement | null;
  const q = t.closest('[data-q]') as HTMLElement | null;
  const tbl = t.closest('[data-tbl]') as HTMLElement | null;
  const env = t.closest('[data-env]') as HTMLElement | null;
  const op = t.closest('[data-open]') as HTMLElement | null;
  const jm = t.closest('[data-joinmatch]') as HTMLElement | null;
  const ff = t.closest('[data-forfeit]') as HTMLElement | null;
  const tdat = t.closest('[class*="chip"][data-t-size],[data-t-format],[data-t-mode],[data-t-team],[data-t-bo],[data-t-pub]') as HTMLElement | null;
  if (cam) { audio.unlock(); audio.click(); return setCam(cam.dataset.cam as CamMode); }
  if (mode) { audio.click(); cfg.mode = mode.dataset.mode as GameMode; fixCfg(); return create(); }
  if (pl) { audio.click(); cfg.maxPlayers = Number(pl.dataset.players) as 2 | 3 | 4; return create(); }
  if (tm) { audio.click(); cfg.teamMode = tm.dataset.team as TeamMode; fixCfg(); return create(); }
  if (bo) { audio.click(); cfg.bestOf = Number(bo.dataset.bo) as 1 | 3 | 5; return create(); }
  if (tbl) {
    audio.click();
    scene.setTable(tbl.dataset.tbl!);
    LS.set('vigo.table', scene.tableId);
    tbl.parentElement?.querySelectorAll('.sw').forEach((c) => c.classList.toggle('on', c === tbl));
    return;
  }
  if (env) {
    audio.click();
    scene.setEnv(env.dataset.env!);
    LS.set('vigo.env', scene.envId);
    env.parentElement?.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === env));
    return;
  }
  if (q) {
    audio.click();
    quality = q.dataset.q as Quality;
    LS.set('vigo.quality', quality);
    scene.setQuality(quality);
    q.parentElement?.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === q));
    return;
  }
  if (op) { audio.click(); net.send({ t: 'tour.watch', code: op.dataset.open! }); return; }
  if (jm) { audio.click(); net.send({ t: 'tour.joinMatch', code: tour!.code, matchId: jm.dataset.joinmatch! }); return; }
  if (ff) { const [matchId, entryId] = ff.dataset.forfeit!.split('|'); net.send({ t: 'tour.forfeit', code: tour!.code, adminToken: adminTokens[tour!.code], matchId, entryId }); return; }
  if (tdat) {
    audio.click();
    const d = tdat.dataset;
    tcfg.name = el<HTMLInputElement>('#tname')?.value ?? tcfg.name;
    if (d.tSize) tcfg.size = Number(d.tSize) as 4 | 8 | 16 | 32;
    if (d.tFormat) tcfg.format = d.tFormat as TournamentSnapshot['format'];
    if (d.tMode) tcfg.gameMode = d.tMode as GameMode;
    if (d.tTeam) tcfg.teamMode = d.tTeam as TeamMode;
    if (d.tBo) tcfg.bestOf = Number(d.tBo) as 1 | 3 | 5;
    if (d.tPub) tcfg.isPublic = d.tPub === 'true';
    return tcreate();
  }
  if (n) act(n.dataset.act!, n);
});

// ============ thông điệp từ máy chủ ============
function onShotResult(m: ShotResultMsg): void {
  if (!room) return;
  shotPending = false;
  placing = false;
  if (screen !== 'game') { screen = 'game'; game(); }
  const heading = room.players.find((p) => p.seat === m.seat)?.name ?? '';
  scene.setCamMode(scene.camMode);
  scene.breakShot = !!room.game?.breakShot;
  scene.playShot(m, () => {
    if (!room) return;
    room.game = { ...m.snapshot, phase: 'playing' };
    scene.setBalls(room.game.balls);
    if (m.foul) { audio.foul(); toast(`⚠️ ${m.foulReason ?? 'Phạm lỗi'}`, 'bad', 2600); vibrate(120); }
    else {
      const pocketed = m.events.filter((e) => e.k === 'pocket' && e.ball !== 0).length;
      if (pocketed) toast(`🎱 ${esc(heading)} ghi ${pocketed} bi!`, 'good', 1400);
    }
    const q = afterPlay; afterPlay = [];
    q.forEach((f) => f());
    refreshTurn();
  });
  // cập nhật thanh thông báo ngay
  const mb = el('#msgbar');
  if (mb) mb.hidden = true;
  updateControls();
}

function whenIdle(fn: () => void): void {
  if (scene.playing) afterPlay.push(fn); else fn();
}

net.onMessage((m) => {
  if ('room' in m && m.room) for (const p of m.room.players) seatNames[p.seat] = p.name;
  switch (m.t) {
    case 'auth.ok': {
      if (m.room) {
        room = m.room;
        if (room.status === 'playing' && room.game) {
          if (screen !== 'game') { go('game'); }
          scene.setBalls(room.game.balls);
          refreshTurn();
        } else if (room.status === 'lobby' || room.status === 'finished') go('lobby');
        toast('Đã kết nối lại — khôi phục bàn chơi', 'good', 1800);
      } else {
        if (room && screen === 'game') { room = null; go('main'); }
        if (pendingJoin) { net.send({ t: 'room.join', code: pendingJoin }); pendingJoin = null; }
      }
      updateBanner();
      break;
    }
    case 'error':
      if (m.code === 'bad_shot' || m.code === 'bad_place') {
        shotPending = false;
        if (room?.game) scene.setBalls(room.game.balls);
        refreshTurn();
      }
      if (m.code === 'room_not_found' && screen === 'join') { /* giữ nguyên màn hình */ }
      if (m.code !== 'rate_limited') toast(m.message, 'bad', 2600);
      break;
    case 'room.state': {
      room = m.room;
      if (quickBot === 1 && room.players.length === 1 && isHost()) {
        quickBot = 2;
        net.send({ t: 'room.addBot' });
        break;
      }
      if (quickBot === 2 && room.players.length === 2) { quickBot = 0; net.send({ t: 'room.start' }); break; }
      if (screen === 'lobby') lobby();
      else if (screen === 'game') { if (!scene.playing && room.game) { room.game = { ...room.game }; } updateHud(); }
      else if (['main', 'create', 'join', 'splash'].includes(screen) && room.status === 'lobby') go('lobby');
      else if (screen === 'tbracket' && room.status === 'lobby') go('lobby');
      break;
    }
    case 'room.closed':
      toast(m.reason, 'bad', 2600);
      room = null; shotPending = false; placing = false; afterPlay = [];
      if (screen === 'game' || screen === 'lobby' || screen === 'result') go(tour ? 'tbracket' : 'main');
      break;
    case 'game.start':
      room = m.room;
      lastTurnSeat = -1;
      shotPending = false;
      placing = false;
      scene.setViewSide(mySeat());
      scene.stopCelebration();
      go('game');
      if (room.game) scene.setBalls(room.game.balls);
      scene.setCamMode((LS.get('vigo.cam') as CamMode) || 'persp');
      document.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === scene.camMode));
      scene.playIntro();
      audio.startGame();
      refreshTurn();
      break;
    case 'game.shotResult':
      onShotResult(m);
      break;
    case 'game.state':
      whenIdle(() => {
        room = m.room;
        if (screen === 'game' && room.game && !scene.playing) { scene.setBalls(room.game.balls); }
        refreshTurn();
      });
      break;
    case 'game.aim':
      if (screen === 'game' && !scene.playing) scene.otherAim = { angle: m.angle, power: m.power, seat: m.seat };
      break;
    case 'game.over':
      whenIdle(() => {
        room = m.room;
        scene.otherAim = null;
        scene.aim.visible = false;
        if (m.matchOver) showResult(m);
        else {
          toast(`🏁 ${teamLabel(m.frameWinnerTeam).split(' (')[0]} thắng ván ${m.room.frameNo}!`, 'good', 3000);
          audio.win();
        }
      });
      break;
    case 'player.status':
      if (room) {
        const p = room.players.find((x) => x.id === m.playerId);
        if (p) {
          p.connected = m.connected;
          if (p.id !== net.playerId) toast(m.connected ? `${p.name} đã kết nối lại` : m.graceMs > 0 ? `⚠️ ${p.name} mất kết nối — chờ ${Math.round(m.graceMs / 1000)}s` : `🚪 ${p.name} đã rời trận`, m.connected ? 'good' : 'bad', 2400);
          if (screen === 'game') updateHud(); else if (screen === 'lobby') lobby();
        }
      }
      break;
    case 'tour.created':
      adminTokens[m.tournament.code] = m.adminToken;
      LS.set('vigo.admin', JSON.stringify(adminTokens));
      tour = m.tournament;
      toast('Đã tạo giải! Mã: ' + m.tournament.code, 'good', 3000);
      go('tbracket');
      break;
    case 'tour.state':
      tour = m.tournament;
      if (screen === 'tbracket') tbracket();
      else if (['tlist', 'main'].includes(screen)) go('tbracket');
      else if (screen === 'result' && !room) go('tbracket');
      break;
    case 'tour.list':
      tourList = m.tournaments;
      if (screen === 'tlist') renderTlist();
      break;
    case 'tour.matchRoom':
      break;
    default:
      break;
  }
});

net.onStatus(() => {
  updateBanner();
  if (screen === 'main' || screen === 'create' || screen === 'join') {
    const pill = ui.querySelector('.pill');
    if (pill) pill.outerHTML = connPill();
  }
});

function updateBanner(): void {
  const st = net.status;
  let txt = '';
  let err = false;
  if (!navigator.onLine) { txt = '📴 Không có Internet'; err = true; }
  else if (screen === 'splash') txt = '';
  else if (st === 'reconnecting') txt = '🔄 Mất kết nối — đang thử lại…';
  else if (st === 'connecting') txt = '⏳ Đang kết nối máy chủ…';
  else if (st === 'offline') { txt = net.server ? '⚠️ Không kết nối được máy chủ' : '⚠️ Chưa cấu hình máy chủ — vào Cài đặt'; err = true; }
  banner.hidden = !txt;
  banner.textContent = txt;
  banner.classList.toggle('err', err);
}

window.addEventListener('online', () => { updateBanner(); net.nudge(); });
window.addEventListener('offline', updateBanner);
document.addEventListener('visibilitychange', () => { music.pauseAll(document.hidden); if (!document.hidden) net.nudge(); });
window.addEventListener('resize', () => scene.resize());
window.addEventListener('orientationchange', () => setTimeout(() => scene.resize(), 200));
window.addEventListener('pointerdown', () => { audio.unlock(); music.unlock(); }, { once: false, passive: true });

// ============ khởi động ============
if ((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) document.documentElement.classList.add('native');
scene.setQuality(quality);
scene.setTable(LS.get('vigo.table') || 'classic');
scene.setEnv(LS.get('vigo.env') || 'lounge');
scene.start();
scene.setCamMode('cinema');
scene.startCelebration();
showDemoRack();
if (!net.server) {
  // chưa biết máy chủ nào: mở cài đặt sau màn hình chào
  setTimeout(() => { if (screen === 'main') go('settings'); }, 2200);
} else net.connect();
go('splash');

// cho phép kiểm thử tự động điều khiển
(window as unknown as { __vigo: unknown }).__vigo = { net, scene, get room() { return room; }, get screen() { return screen; }, act, go };
