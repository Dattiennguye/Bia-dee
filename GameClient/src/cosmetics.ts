/** Gậy, avatar, hiệu ứng đánh, biểu cảm — dữ liệu dùng chung cho cửa hàng, cảnh 3D và HUD. */
import { LS } from './net';
import type { Profile } from '@shared/protocol';

// ---------- GẬY ----------
export type CuePattern = 'plain' | 'rings' | 'stripes' | 'checker' | 'flame' | 'galaxy' | 'carbon' | 'neon' | 'gradient';
export interface CueSkin {
  id: string;
  name: string;
  desc: string;
  shaft: number;
  butt: number;
  accent: number;
  ring: number;
  tip: number;
  pattern: CuePattern;
  glow?: number;
}
export const CUES: CueSkin[] = [
  { id: 'maple', name: 'Phong cổ điển', desc: 'Gỗ phong, ngọn vàng', shaft: 0xf0d9a6, butt: 0x3a2418, accent: 0x7a1f1f, ring: 0xe0b050, tip: 0x3aa0ff, pattern: 'rings' },
  { id: 'ebony', name: 'Mun đen', desc: 'Thân mun, vòng bạc', shaft: 0xd8c9a0, butt: 0x15151a, accent: 0xc8c8d4, ring: 0xc8c8d4, tip: 0x333344, pattern: 'rings' },
  { id: 'sakura', name: 'Anh đào', desc: 'Sọc hồng dịu', shaft: 0xf6e3d0, butt: 0xff9ec4, accent: 0xffffff, ring: 0xffd0e4, tip: 0xff8ab8, pattern: 'stripes' },
  { id: 'ocean', name: 'Đại dương', desc: 'Sọc xanh sóng nước', shaft: 0xe8f4ff, butt: 0x1b6fd0, accent: 0x57d6ff, ring: 0xffffff, tip: 0x2a6be0, pattern: 'stripes' },
  { id: 'flame', name: 'Lửa rồng', desc: 'Ngọn lửa bùng cháy', shaft: 0xffe0b0, butt: 0xc81e1e, accent: 0xffb02e, ring: 0xffd34d, tip: 0xff6a2a, pattern: 'flame', glow: 0xff5a1a },
  { id: 'galaxy', name: 'Ngân hà', desc: 'Tím sao lấp lánh', shaft: 0xe6dcff, butt: 0x2a1466, accent: 0x8f6bff, ring: 0xb6a0ff, tip: 0x8f6bff, pattern: 'galaxy', glow: 0x7a4cff },
  { id: 'carbon', name: 'Carbon', desc: 'Sợi carbon thể thao', shaft: 0xcfd2d8, butt: 0x1c1d22, accent: 0xff3a3a, ring: 0xff3a3a, tip: 0x222222, pattern: 'carbon' },
  { id: 'neon', name: 'Neon Cyber', desc: 'Vòng neon phát sáng', shaft: 0xdfffff, butt: 0x0a0c14, accent: 0x57ffe0, ring: 0x57ffe0, tip: 0x57ffe0, pattern: 'neon', glow: 0x57ffe0 },
  { id: 'gold', name: 'Hoàng kim', desc: 'Mạ vàng sang trọng', shaft: 0xffeeb0, butt: 0xd9a441, accent: 0xfff2c0, ring: 0xffffff, tip: 0xfff2c0, pattern: 'checker' },
  { id: 'candy', name: 'Kẹo mút', desc: 'Sọc đỏ trắng vui nhộn', shaft: 0xffffff, butt: 0xf03a5a, accent: 0xffffff, ring: 0xffd0e0, tip: 0xff5fa8, pattern: 'stripes' },
  { id: 'jade', name: 'Ngọc bích', desc: 'Xanh ngọc, vòng vàng', shaft: 0xeaf7d8, butt: 0x1f8f68, accent: 0x7fe0b0, ring: 0xe0b050, tip: 0x1f8f68, pattern: 'gradient' },
  { id: 'ice', name: 'Băng giá', desc: 'Trong suốt lạnh', shaft: 0xf2fbff, butt: 0xa8e6ff, accent: 0xffffff, ring: 0xffffff, tip: 0x9fe6ff, pattern: 'rings', glow: 0x9fe6ff },
  { id: 'sunset', name: 'Hoàng hôn', desc: 'Chuyển sắc hồng cam', shaft: 0xfff0d8, butt: 0xff5f8a, accent: 0xffb060, ring: 0xffd34d, tip: 0xff8a3a, pattern: 'gradient' },
];

export const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');

/** Vẽ hoạ tiết thân gậy: canvas 64 (vòng) x 512 (chiều dài) */
export function cueTexture(s: CueSkin): HTMLCanvasElement {
  const W = 64, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const butt = hex(s.butt), acc = hex(s.accent);
  g.fillStyle = butt; g.fillRect(0, 0, W, H);
  switch (s.pattern) {
    case 'rings': for (let y = 30; y < H; y += 64) { g.fillStyle = acc; g.fillRect(0, y, W, 5); g.fillRect(0, y + 9, W, 2); } break;
    case 'stripes': for (let x = 0; x < W; x += 16) { g.fillStyle = acc; g.fillRect(x, 0, 8, H); } break;
    case 'checker': for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) { if (((x + y) / 16) % 2 === 0) { g.fillStyle = acc; g.globalAlpha = 0.55; g.fillRect(x, y, 16, 16); g.globalAlpha = 1; } } break;
    case 'flame': {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, hex(s.butt)); gr.addColorStop(1, acc);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = hex(s.ring); g.globalAlpha = 0.8;
      for (let i = 0; i < 12; i++) { const y = H - i * 44; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 16) { g.lineTo(x + 8, y - 30 - (i % 3) * 8); g.lineTo(x + 16, y); } g.fill(); }
      g.globalAlpha = 1; break;
    }
    case 'galaxy': {
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1a0f55'); gr.addColorStop(0.5, '#5a2fb0'); gr.addColorStop(1, '#14307a');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`; const r = Math.random() * 1.6; g.beginPath(); g.arc(Math.random() * W, Math.random() * H, r, 0, 6.3); g.fill(); }
      break;
    }
    case 'carbon': {
      g.fillStyle = '#0e0f12'; g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? '#2a2c33' : '#16171b'; g.fillRect(x, y, 8, 8); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x, y, 8, 2); }
      g.fillStyle = acc; g.fillRect(0, 60, W, 6); g.fillRect(0, H - 80, W, 6);
      break;
    }
    case 'neon': for (let y = 24; y < H; y += 56) { g.fillStyle = acc; g.fillRect(0, y, W, 6); } break;
    case 'gradient': { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, acc); gr.addColorStop(1, butt); g.fillStyle = gr; g.fillRect(0, 0, W, H); break; }
    default: break;
  }
  return c;
}

/** Xem trước gậy bằng CSS (nằm ngang) */
export function cuePreviewCss(s: CueSkin): string {
  const b = hex(s.butt), a = hex(s.accent), sh = hex(s.shaft), t = hex(s.tip), r = hex(s.ring);
  let pat = `background:${b}`;
  if (s.pattern === 'stripes') pat = `background:repeating-linear-gradient(0deg,${b} 0 4px,${a} 4px 8px)`;
  else if (s.pattern === 'rings' || s.pattern === 'neon') pat = `background:linear-gradient(90deg,transparent 0 18%,${a} 18% 21%,transparent 21% 40%,${a} 40% 43%,transparent 43% 62%,${a} 62% 65%,transparent 65%),${b}`;
  else if (s.pattern === 'checker') pat = `background:repeating-conic-gradient(${b} 0 25%,${a} 0 50%) 0 0/8px 8px`;
  else if (s.pattern === 'flame') pat = `background:linear-gradient(90deg,${a},${b})`;
  else if (s.pattern === 'galaxy') pat = `background:radial-gradient(circle at 20% 30%,#fff 0 1px,transparent 2px) 0 0/14px 14px,linear-gradient(90deg,#1a0f55,#5a2fb0,#14307a)`;
  else if (s.pattern === 'carbon') pat = `background:repeating-conic-gradient(#16171b 0 25%,#2a2c33 0 50%) 0 0/6px 6px`;
  else if (s.pattern === 'gradient') pat = `background:linear-gradient(90deg,${a},${b})`;
  const glow = s.glow ? `filter:drop-shadow(0 0 6px ${hex(s.glow)});` : '';
  return `<div class="cuepv" style="${glow}"><i class="ct" style="background:${t}"></i><i class="cs" style="background:${sh}"></i><i class="cr" style="background:${r}"></i><i class="cb" style="${pat}"></i><i class="cr" style="background:${r}"></i><i class="ce"></i></div>`;
}

// ---------- AVATAR ----------
export interface Avatar { id: string; name: string; bg: [string, string]; svg: string }
export const AVATARS: Avatar[] = [
  { id: 'cat', name: 'Mèo', bg: ['#ff9ec4', '#ff5fa8'], svg: '<path d="M5 9 4 3.5 9 6.5h6L20 3.5 19 9c1 1.3 1.5 2.8 1.5 4.3 0 4-3.8 6.7-8.5 6.7S3.5 17.3 3.5 13.3C3.5 11.8 4 10.3 5 9Z" fill="#fff"/><circle cx="9" cy="13" r="1.3" fill="#2a1a3a"/><circle cx="15" cy="13" r="1.3" fill="#2a1a3a"/><path d="M11 15.5h2l-1 1.1z" fill="#ff5fa8"/>' },
  { id: 'dog', name: 'Chó', bg: ['#ffd34d', '#ff9a3a'], svg: '<path d="M7 5C4 5 3 9 3.5 13c.2 1.5 1.2 2 2 1.2V8c0-1.5.8-2.5 1.5-3ZM17 5c3 0 4 4 3.5 8-.2 1.5-1.2 2-2 1.2V8c0-1.500-.8-2.5-1.5-3Z" fill="#8a4a1f"/><ellipse cx="12" cy="13" rx="6" ry="6.5" fill="#fff"/><circle cx="9.5" cy="12" r="1.2" fill="#2a1a3a"/><circle cx="14.5" cy="12" r="1.2" fill="#2a1a3a"/><ellipse cx="12" cy="15" rx="1.6" ry="1.1" fill="#2a1a3a"/>' },
  { id: 'fox', name: 'Cáo', bg: ['#ff8a3a', '#e0431f'], svg: '<path d="M3 4l6 3.5h6L21 4l-1 9c0 4-3.6 7-8 7s-8-3-8-7Z" fill="#ff7a2a"/><path d="M12 20c-3 0-5-2-6-4.5 2.5 1 4 .5 6-2 2 2.5 3.5 3 6 2-1 2.5-3 4.5-6 4.5Z" fill="#fff"/><circle cx="9" cy="12" r="1.1" fill="#2a1a3a"/><circle cx="15" cy="12" r="1.1" fill="#2a1a3a"/><circle cx="12" cy="16.2" r="1" fill="#2a1a3a"/>' },
  { id: 'panda', name: 'Gấu trúc', bg: ['#8fe3b0', '#2aa96b'], svg: '<circle cx="6" cy="6" r="2.6" fill="#222"/><circle cx="18" cy="6" r="2.6" fill="#222"/><circle cx="12" cy="13" r="8" fill="#fff"/><ellipse cx="8.8" cy="12" rx="2" ry="2.6" fill="#222" transform="rotate(20 8.8 12)"/><ellipse cx="15.2" cy="12" rx="2" ry="2.6" fill="#222" transform="rotate(-20 15.2 12)"/><circle cx="8.8" cy="12" r=".8" fill="#fff"/><circle cx="15.2" cy="12" r=".8" fill="#fff"/><ellipse cx="12" cy="15.5" rx="1.3" ry=".9" fill="#222"/>' },
  { id: 'robot', name: 'Robot', bg: ['#57d6ff', '#2a6be0'], svg: '<rect x="4" y="7" width="16" height="12" rx="3.5" fill="#e8f0ff"/><rect x="11" y="3.5" width="2" height="3.5" fill="#e8f0ff"/><circle cx="12" cy="3.2" r="1.4" fill="#ff5fa8"/><circle cx="9" cy="12.5" r="2" fill="#2a6be0"/><circle cx="15" cy="12.5" r="2" fill="#2a6be0"/><rect x="8.5" y="16" width="7" height="1.4" rx=".7" fill="#2a6be0"/>' },
  { id: 'alien', name: 'Người ngoài hành tinh', bg: ['#b6ff7a', '#2fa84f'], svg: '<path d="M12 3c5 0 8 4 8 8.500 0 5-3.500 9.500-8 9.500s-8-4.500-8-9.500C4 7 7 3 12 3Z" fill="#7be07b"/><ellipse cx="8.5" cy="11.5" rx="2.4" ry="3.2" fill="#14301a" transform="rotate(25 8.5 11.5)"/><ellipse cx="15.5" cy="11.5" rx="2.4" ry="3.2" fill="#14301a" transform="rotate(-25 15.5 11.5)"/><path d="M10 17.500q2 1 4 0" stroke="#14301a" stroke-width="1" fill="none"/>' },
  { id: 'ghost', name: 'Ma', bg: ['#c9b6ff', '#7a4cff'], svg: '<path d="M5 20V11a7 7 0 0 1 14 0v9l-2.3-2-2.3 2-2.4-2-2.4 2-2.3-2Z" fill="#fff"/><circle cx="9.5" cy="11" r="1.5" fill="#2a1a3a"/><circle cx="14.5" cy="11" r="1.5" fill="#2a1a3a"/><ellipse cx="12" cy="15" rx="1.3" ry="1.7" fill="#2a1a3a"/>' },
  { id: 'rabbit', name: 'Thỏ', bg: ['#ffd0e4', '#ff8ab8'], svg: '<ellipse cx="8.500" cy="6" rx="2.200" ry="5" fill="#fff"/><ellipse cx="15.500" cy="6" rx="2.200" ry="5" fill="#fff"/><ellipse cx="8.500" cy="6.500" rx="1" ry="3.400" fill="#ff9ec4"/><ellipse cx="15.500" cy="6.500" rx="1" ry="3.400" fill="#ff9ec4"/><circle cx="12" cy="15" r="6.500" fill="#fff"/><circle cx="9.700" cy="14.300" r="1" fill="#2a1a3a"/><circle cx="14.300" cy="14.300" r="1" fill="#2a1a3a"/><path d="M11 16.800h2l-1 1z" fill="#ff5fa8"/>' },
  { id: 'owl', name: 'Cú mèo', bg: ['#ffb86b', '#c0662a'], svg: '<path d="M4 5l4 2.500h8L20 5v10c0 3.500-3.500 6-8 6s-8-2.500-8-6Z" fill="#8a5a38"/><circle cx="9" cy="11" r="3.200" fill="#fff"/><circle cx="15" cy="11" r="3.200" fill="#fff"/><circle cx="9" cy="11" r="1.400" fill="#2a1a3a"/><circle cx="15" cy="11" r="1.400" fill="#2a1a3a"/><path d="M12 13l-1.300 2.200h2.600Z" fill="#ffd34d"/>' },
  { id: 'crown', name: 'Vương miện', bg: ['#ffe08a', '#e0a020'], svg: '<path d="M3.500 18.500V8l4.500 4.500L12 5l4 7.500L20.500 8v10.500Z" fill="#fff6c8"/><rect x="3.500" y="18.500" width="17" height="2.200" rx="1" fill="#fff"/><circle cx="12" cy="13.500" r="1.500" fill="#ff5fa8"/><circle cx="7.500" cy="14.500" r="1" fill="#57d6ff"/><circle cx="16.500" cy="14.500" r="1" fill="#57d6ff"/>' },
  { id: 'flame', name: 'Lửa', bg: ['#ff8a5c', '#d0202f'], svg: '<path d="M12 2.500c1 3.500 5.500 5.500 5.500 11 0 4-2.700 7-5.500 7s-5.500-3-5.500-7c0-2 .8-3.300 2-4.500.2 1.500 1 2.200 1.800 2.500C10 9 11 6 12 2.500Z" fill="#fff3b0"/><path d="M12 11c.7 2 2.500 2.700 2.500 5 0 1.600-1.100 2.800-2.500 2.800s-2.500-1.200-2.500-2.800c0-2 1.700-3 2.500-5Z" fill="#ff7a2a"/>' },
  { id: 'eight', name: 'Bi số 8', bg: ['#444a66', '#14172a'], svg: '<circle cx="12" cy="12" r="8.600" fill="#111"/><circle cx="12" cy="12" r="3.600" fill="#fff"/><circle cx="12" cy="10.600" r="1.100" fill="#111"/><circle cx="12" cy="13.300" r="1.400" fill="#111"/><ellipse cx="8.500" cy="7.500" rx="2" ry="1.200" fill="#fff" opacity=".4" transform="rotate(-35 8.500 7.500)"/>' },
];

export function avatarHtml(i: number, size = 36): string {
  const a = AVATARS[i] ?? AVATARS[0];
  return `<span class="avt" style="width:${size}px;height:${size}px;background:linear-gradient(145deg,${a.bg[0]},${a.bg[1]})"><svg viewBox="0 0 24 24" width="${size * 0.8}" height="${size * 0.8}">${a.svg}</svg></span>`;
}

// ---------- HIỆU ỨNG ĐÁNH ----------
export type TrailKind = 'none' | 'glow' | 'fire' | 'rainbow' | 'hearts' | 'stars';
export interface Fx { id: string; name: string; desc: string; aim: number | 'rainbow'; colors: number[]; trail: TrailKind }
export const FXS: Fx[] = [
  { id: 'classic', name: 'Cổ điển', desc: 'Đường ngắm trắng, không vệt', aim: 0xffffff, colors: [0xffffff, 0xfff0c0], trail: 'none' },
  { id: 'cyan', name: 'Vệt xanh lam', desc: 'Bi cái để lại vệt sáng xanh', aim: 0x57d6ff, colors: [0x57d6ff, 0xb6f0ff], trail: 'glow' },
  { id: 'fire', name: 'Lửa cháy', desc: 'Vệt lửa cam đỏ', aim: 0xff8a3a, colors: [0xff5a1a, 0xffb02e, 0xffe080], trail: 'fire' },
  { id: 'rainbow', name: 'Cầu vồng', desc: 'Đường ngắm & vệt đổi màu', aim: 'rainbow', colors: [0xff5fa8, 0xffd34d, 0x57ffb0, 0x57d6ff, 0x8f6bff], trail: 'rainbow' },
  { id: 'pink', name: 'Hồng trái tim', desc: 'Tim nhỏ bay theo bi', aim: 0xff5fa8, colors: [0xff5fa8, 0xffb0d0], trail: 'hearts' },
  { id: 'gold', name: 'Sao vàng', desc: 'Tia sao lấp lánh', aim: 0xffd34d, colors: [0xffd34d, 0xfff2a8], trail: 'stars' },
  { id: 'violet', name: 'Tím huyền ảo', desc: 'Vệt tím mơ màng', aim: 0xa88bff, colors: [0x8f6bff, 0xd0b8ff], trail: 'glow' },
  { id: 'toxic', name: 'Xanh độc', desc: 'Vệt xanh lá phát sáng', aim: 0x57ff9a, colors: [0x57ff9a, 0xc0ffd8], trail: 'glow' },
  { id: 'ice', name: 'Băng giá', desc: 'Tinh thể băng lấp lánh', aim: 0xa8e6ff, colors: [0xa8e6ff, 0xffffff], trail: 'stars' },
];

// ---------- BIỂU CẢM ----------
export const EMOTES = ['👍', '😂', '😮', '😎', '🔥', '👏', '😭', '😡', '🤝', '🎱'];

// ---------- HỒ SƠ ----------
export function loadProfile(): Profile {
  const n = (k: string, max: number) => { const v = Number(LS.get(k)); return Number.isInteger(v) && v >= 0 && v < max ? v : 0; };
  return { a: n('vigo.p.a', AVATARS.length), c: n('vigo.p.c', CUES.length), f: n('vigo.p.f', FXS.length) };
}
export function saveProfile(p: Profile): void {
  LS.set('vigo.p.a', String(p.a)); LS.set('vigo.p.c', String(p.c)); LS.set('vigo.p.f', String(p.f));
}
