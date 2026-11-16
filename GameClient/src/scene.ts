import { CUES, FXS, cueTexture, hex as hexStr, type Fx } from './cosmetics';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FRAME_HZ, POCKETS, TABLE, type BallState, type ShotResultMsg, type TableEvent } from '@shared/protocol';
import { audio } from './audio';

const { L, W, R } = TABLE;

export type CamMode = 'top' | 'persp' | 'shoot' | 'free' | 'cinema';
/** auto: tự chỉnh độ phân giải để giữ 60–120 FPS */
export type Quality = 'auto' | 'low' | 'medium' | 'high';

export const BALL_COLORS: Record<number, string> = {
  0: '#f6f3ea', 1: '#f5c518', 2: '#1e56d6', 3: '#e0312b', 4: '#7a3cc4', 5: '#f08a1c', 6: '#13995a', 7: '#8c2a2a', 8: '#16161a',
};
export const ballColor = (id: number) => BALL_COLORS[id <= 8 ? id : id - 8];

const toW = (x: number, y: number, h: number = R) => new THREE.Vector3(x - L / 2, h, y - W / 2);

// ---------- kích thước bàn (m) ----------
const CUSHION_D = 0.055; // chiều sâu đệm băng
const RAIL_W = 0.14; // bề rộng khung gỗ
const RAIL_H = 0.06; // độ cao mặt khung so với mặt nỉ
const CUSHION_H = 0.04;
const BODY_BOTTOM = -0.3;

/** Tâm và bán kính "miệng lỗ" nhìn thấy (hệ toạ độ thế giới x,z) */
export const HOLES = POCKETS.map((p, i) => {
  const sx = p.x === 0 ? -1 : 1;
  const sz = p.y === 0 ? -1 : 1;
  return i < 4 ? { x: sx * (L / 2 + 0.012), z: sz * (W / 2 + 0.012), r: 0.068 } : { x: 0, z: sz * (W / 2 + 0.03), r: 0.06 };
});

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[];
type Multi = Poly[];

const circle = (cx: number, cz: number, r: number, n = 48): Ring => {
  const a: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    a.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]);
  }
  return a;
};

const rrect = (hx: number, hz: number, rad: number, seg = 8): Ring => {
  const a: Ring = [];
  const corners: Array<[number, number, number]> = [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]];
  for (const [sx, sz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = ((a0 + (i / seg) * 90) * Math.PI) / 180;
      a.push([sx * (hx - rad) + Math.cos(t) * rad, sz * (hz - rad) + Math.sin(t) * rad]);
    }
  }
  return a;
};

function toShapes(m: Multi): THREE.Shape[] {
  const out: THREE.Shape[] = [];
  for (const poly of m) {
    const conv = (r: Ring) => r.map((p) => new THREE.Vector2(p[0], -p[1]));
    const sh = new THREE.Shape(conv(poly[0]));
    for (let i = 1; i < poly.length; i++) sh.holes.push(new THREE.Path(conv(poly[i])));
    out.push(sh);
  }
  return out;
}

/** Đùn đa giác 2D (x,z) thành khối nằm giữa y0 và y0+depth */
function extrude(m: Multi, y0: number, depth: number, bevel = 0): THREE.BufferGeometry {
  const opts: THREE.ExtrudeGeometryOptions = bevel > 0
    ? { depth: depth - bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 8 }
    : { depth, bevelEnabled: false, curveSegments: 8 };
  const g = new THREE.ExtrudeGeometry(toShapes(m), opts);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function flat(m: Multi, y: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(toShapes(m), 8);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// ---------- texture ----------
function ballTexture(id: number, aniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  const col = ballColor(id);
  const stripe = id >= 9;
  g.fillStyle = id === 0 || stripe ? '#f7f4ec' : col;
  g.fillRect(0, 0, 512, 256);
  if (stripe) {
    g.fillStyle = col;
    g.fillRect(0, 56, 512, 144);
  }
  if (id > 0) {
    for (const cx of [128, 384]) {
      g.fillStyle = '#fbfaf5';
      g.beginPath();
      g.arc(cx, 128, 40, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.font = 'bold 48px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(id), cx, 131);
    }
  } else {
    g.fillStyle = '#d33';
    for (const cx of [128, 384]) {
      g.beginPath();
      g.arc(cx, 128, 9, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function feltTexture(aniso: number): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b0b0b0';
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    img.data[i] += n * 0.7;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.7;
  }
  g.putImageData(img, 0, 0);
  // sợi nỉ mảnh
  g.globalAlpha = 0.06;
  for (let i = 0; i < 1600; i++) {
    g.strokeStyle = Math.random() < 0.5 ? '#ffffff' : '#000000';
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 6.28;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(7, 7); // uv tính bằng mét -> mỗi ô ~0.2m
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function woodTexture(aniso: number): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, '#6e3a1f');
  grd.addColorStop(0.5, '#5a2c16');
  grd.addColorStop(1, '#6a3720');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * S;
    const a = 0.05 + Math.random() * 0.14;
    g.strokeStyle = Math.random() < 0.55 ? `rgba(30,12,4,${a})` : `rgba(210,140,80,${a * 0.7})`;
    g.lineWidth = 0.6 + Math.random() * 1.8;
    g.beginPath();
    const amp = 1 + Math.random() * 3;
    const ph = Math.random() * 6;
    for (let x = 0; x <= S; x += 24) {
      const yy = y + Math.sin(x / 70 + ph) * amp;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  // xước, va đập và vân sần do dùng lâu năm
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(235,205,165,${0.08 + Math.random() * 0.22})`;
    g.lineWidth = 0.5 + Math.random() * 1.1;
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 6.28, l = 8 + Math.random() * 70;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 5;
    g.fillStyle = 'rgba(20,8,2,0.35)'; g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
    g.fillStyle = 'rgba(255,225,190,0.25)'; g.beginPath(); g.arc(x - 0.8, y - 0.8, r * 0.6, 0, 6.28); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.3, 1.3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}


/** Hoạ tiết cắt cỏ sọc (sân golf/sân bóng/vườn) */
function mowTexture(c1: string, c2: string, rep: number, aniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = c1; g.fillRect(0, 0, 256, 256);
  g.fillStyle = c2; g.fillRect(0, 0, 128, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 26; img.data[i] += n * 0.6; img.data[i + 1] += n; img.data[i + 2] += n * 0.5; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

/** Sân bóng: cỏ sọc + vạch kẻ trắng (1 px ≈ 6,5 cm) */
function pitchTexture(aniso: number): THREE.CanvasTexture {
  const W2 = 1024, H2 = 640;
  const c = document.createElement('canvas');
  c.width = W2; c.height = H2;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#2f7d3a' : '#37893f'; g.fillRect((i * W2) / 16, 0, W2 / 16, H2); }
  const img = g.getImageData(0, 0, W2, H2);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 18; img.data[i] += n * 0.5; img.data[i + 1] += n; img.data[i + 2] += n * 0.5; }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 5;
  g.strokeRect(24, 24, W2 - 48, H2 - 48);
  g.beginPath(); g.moveTo(W2 / 2, 24); g.lineTo(W2 / 2, H2 - 24); g.stroke();
  g.beginPath(); g.arc(W2 / 2, H2 / 2, 78, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(W2 / 2, H2 / 2, 6, 0, Math.PI * 2); g.fill();
  for (const sgn of [0, 1]) {
    const x0 = sgn ? W2 - 24 : 24, dir = sgn ? -1 : 1;
    g.strokeRect(sgn ? x0 - 150 : x0, H2 / 2 - 190, 150, 380);
    g.strokeRect(sgn ? x0 - 60 : x0, H2 / 2 - 90, 60, 180);
    g.beginPath(); g.arc(x0 + dir * 100, H2 / 2, 70, sgn ? Math.PI * 0.62 : -Math.PI * 0.38, sgn ? Math.PI * 1.38 : Math.PI * 0.38); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

/** Cửa sổ toà nhà phát sáng (nền thành phố) */
function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0d1c'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) for (let x = 4; x < 60; x += 8) {
    const r = Math.random();
    g.fillStyle = r < 0.45 ? '#ffd98a' : r < 0.6 ? '#9ad0ff' : '#141a30';
    g.fillRect(x, y, 5, 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Lớp "dấu vết sử dụng" trên mặt nỉ: phấn, vệt mòn, xước, lông nỉ — vẽ một lần cho cả mặt bàn */
function feltWearTexture(aniso: number, lv = 1): THREE.CanvasTexture {
  const W2 = 2048, H2 = 1024;
  const c = document.createElement('canvas');
  c.width = W2; c.height = H2;
  const g = c.getContext('2d')!;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  // vệt mòn bóng loáng dọc đường bi hay chạy
  g.lineCap = 'round';
  for (let i = 0; i < Math.round(70 * lv); i++) {
    g.strokeStyle = `rgba(210,235,255,${rnd(0.015, 0.045)})`;
    g.lineWidth = rnd(10, 26);
    const x = rnd(200, W2 - 200), y = rnd(150, H2 - 150), a = rnd(-0.35, 0.35) + (Math.random() < 0.3 ? Math.PI / 2 : 0), l = rnd(120, 520);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // đám phấn xanh: nhiều quanh điểm đặt bi, đầu bàn và sát băng
  const chalk = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(150,200,235,${a})`); gr.addColorStop(1, 'rgba(150,200,235,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  for (let i = 0; i < Math.round(46 * lv); i++) chalk(rnd(60, W2 - 60), rnd(60, H2 - 60), rnd(18, 70), rnd(0.03, 0.09));
  for (let i = 0; i < Math.round(30 * lv); i++) chalk(rnd(60, W2 - 60), Math.random() < 0.5 ? rnd(20, 90) : rnd(H2 - 90, H2 - 20), rnd(14, 50), rnd(0.05, 0.1));
  if (Math.random() < lv) chalk(rnd(W2 * 0.15, W2 * 0.4), rnd(H2 * 0.3, H2 * 0.7), 110, 0.12 * lv); if (Math.random() < lv) chalk(rnd(W2 * 0.6, W2 * 0.85), rnd(H2 * 0.3, H2 * 0.7), 130, 0.14 * lv);
  // điểm đặt bi (đầu/giữa/cuối)
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (const [fx, fy] of [[0.25, 0.5], [0.5, 0.5], [0.75, 0.5]]) { g.beginPath(); g.arc(W2 * fx, H2 * fy, 5, 0, Math.PI * 2); g.fill(); }
  // đường đầu bàn (mờ)
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 3; g.beginPath(); g.moveTo(W2 * 0.25, 40); g.lineTo(W2 * 0.25, H2 - 40); g.stroke();
  // vết xước & vết cắt nhỏ
  for (let i = 0; i < Math.round(34 * lv * Math.random() * 1.6); i++) {
    const x = rnd(80, W2 - 80), y = rnd(80, H2 - 80), a = rnd(0, Math.PI * 2), l = rnd(14, 90);
    g.strokeStyle = `rgba(230,245,255,${rnd(0.1, 0.32)})`; g.lineWidth = rnd(0.8, 1.8);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd(-6, 6), y + Math.sin(a) * l * 0.5 + rnd(-6, 6), x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < Math.round(9 * lv * Math.random() * 1.4); i++) { // vết rách nhỏ có viền tối
    const x = rnd(120, W2 - 120), y = rnd(120, H2 - 120), a = rnd(0, 6.28), l = rnd(10, 26);
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    g.strokeStyle = 'rgba(235,245,255,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // bụi phấn li ti + xơ vải
  for (let i = 0; i < Math.round(2600 * lv); i++) { g.fillStyle = `rgba(220,240,255,${rnd(0.05, 0.22)})`; g.fillRect(rnd(0, W2), rnd(0, H2), rnd(1, 2.6), rnd(1, 2.6)); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}

/** Bản đồ độ nhám bi: bóng nhưng có xước li ti, vết trầy và dấu phấn */
function ballRoughTexture(id: number, lv = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, 512, 256);
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  for (let i = 0; i < Math.round(160 * lv * (0.3 + Math.random())); i++) {
    g.strokeStyle = `rgba(255,255,255,${rnd(0.1, 0.5)})`; g.lineWidth = rnd(0.4, 1.2);
    const x = rnd(0, 512), y = rnd(0, 256), a = rnd(0, 6.28), l = rnd(4, 26);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < Math.round(6 * lv * Math.random() * 2); i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.08, 0.2)})`; g.beginPath(); g.ellipse(rnd(0, 512), rnd(30, 226), rnd(6, 22), rnd(4, 14), rnd(0, 3), 0, Math.PI * 2); g.fill(); }
  if (id === 0) for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(rnd(40, 470), rnd(60, 200), rnd(5, 12), 0, 6.28); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function radialTexture(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 36, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dải phẳng nằm trên mặt bàn (đường ngắm) — thay cho Line để dày, nét và không cấp phát */
class Strip {
  readonly mesh: THREE.Mesh;
  private tex: THREE.CanvasTexture | null = null;
  constructor(scene: THREE.Scene, color: number, opacity: number, private width: number, dashed: boolean) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    if (dashed) {
      this.tex = dashTexture();
      mat.map = this.tex;
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }
  set(x0: number, z0: number, x1: number, z1: number, y: number, scroll = 0): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.mesh.rotation.y = -Math.atan2(dz, dx);
    this.mesh.scale.set(len, 1, this.width);
    if (this.tex) {
      this.tex.repeat.x = len / 0.05;
      this.tex.offset.x = -scroll;
    }
  }
  hide(): void { this.mesh.visible = false; }
}

export interface TableTheme { id: string; name: string; felt: number; cushion: number; wood: number; brass: number; neon: number; dia: number }
export const TABLE_THEMES: TableTheme[] = [
  { id: 'classic', name: 'Cổ điển', felt: 0x13744a, cushion: 0x1b9a5c, wood: 0xffffff, brass: 0xe0b050, neon: 0xff5fa8, dia: 0xf7eac0 },
  { id: 'royal', name: 'Hoàng gia', felt: 0x1b55b8, cushion: 0x1d58b0, wood: 0x5a5f70, brass: 0xc8d0e0, neon: 0x57d6ff, dia: 0xe8f0ff },
  { id: 'crimson', name: 'Nhung đỏ', felt: 0xa51c30, cushion: 0x96182a, wood: 0xd9a46c, brass: 0xe0b050, neon: 0xffd34d, dia: 0xfff0c8 },
  { id: 'luxury', name: 'Ngọc lục bảo', felt: 0x0b6a48, cushion: 0x0e7a52, wood: 0x2b2b30, brass: 0xffd45a, neon: 0xffd34d, dia: 0xffe9a0 },
  { id: 'cyber', name: 'Cyber', felt: 0x2a2060, cushion: 0x3a2f80, wood: 0x2a2a3a, brass: 0x57ffe0, neon: 0x8f6bff, dia: 0x9ffff0 },
  { id: 'candy', name: 'Kẹo ngọt', felt: 0xd24a92, cushion: 0xbd3b82, wood: 0xffc0d4, brass: 0xfff2a8, neon: 0x57d6ff, dia: 0xffffff },
];

export interface EnvTheme { id: string; name: string; sky: Array<[number, string]>; fog: [number, number, number]; floor: number; rim: [number, number]; hemi: [number, number] }
export const ENVS: EnvTheme[] = [
  { id: 'lounge', name: 'Lounge neon', sky: [[0, '#2a1650'], [1, '#0a0614']], fog: [0x120c22, 9, 20], floor: 0x2b1b47, rim: [0x9a7bff, 0xff7ab8], hemi: [0xcfd8ff, 0x2a1a3a] },
  { id: 'club', name: 'Câu lạc bộ', sky: [[0, '#3a2414'], [1, '#0c0705']], fog: [0x120a06, 8, 18], floor: 0x3a2414, rim: [0xffc98a, 0xff9a5a], hemi: [0xffe6c0, 0x2a1a10] },
  { id: 'space', name: 'Vũ trụ', sky: [[0, '#05030f'], [0.6, '#0b1038'], [1, '#2a1260']], fog: [0x05030f, 20, 70], floor: 0x0b0d26, rim: [0x57d6ff, 0xb06bff], hemi: [0xb0c0ff, 0x10102a] },
  { id: 'sunset', name: 'Hoàng hôn biển', sky: [[0, '#1b2a66'], [0.5, '#b4507a'], [0.78, '#ff8a5c'], [1, '#ffd08a']], fog: [0xc06070, 14, 40], floor: 0x6a4a30, rim: [0xffa070, 0x7aa8ff], hemi: [0xffd7b0, 0x3a2a4a] },
  { id: 'golf', name: 'Nhà kính · sân golf', sky: [[0, '#5aa6e8'], [0.55, '#a9d6f5'], [1, '#e6f4ff']], fog: [0xcfe6f2, 22, 85], floor: 0xb9a58a, rim: [0xfff2d0, 0xbfe0ff], hemi: [0xe4f2ff, 0x4a6a3a] },
  { id: 'stadium', name: 'Sân vận động', sky: [[0, '#03060f'], [0.6, '#0a1430'], [1, '#16264a']], fog: [0x0a1226, 28, 88], floor: 0x1a2230, rim: [0xdfe9ff, 0xffe9b0], hemi: [0xbfd0ff, 0x142010] },
  { id: 'garden', name: 'Sân vườn', sky: [[0, '#6fb2ea'], [0.6, '#bfe0f0'], [1, '#ffe2b0']], fog: [0xe8e2c8, 20, 80], floor: 0xcfc2a8, rim: [0xffe0a8, 0xcfe8ff], hemi: [0xeaf4ff, 0x4a6030] },
  { id: 'rooftop', name: 'Sân thượng phố đêm', sky: [[0, '#0d0a2a'], [0.55, '#3a2060'], [0.85, '#c8507a'], [1, '#ff9a6a']], fog: [0x2a2048, 30, 100], floor: 0x5a4636, rim: [0xff8ac0, 0x7ab0ff], hemi: [0xd8c8ff, 0x2a1a30] },
  { id: 'arena', name: 'Đấu trường', sky: [[0, '#02040c'], [1, '#07102a']], fog: [0x03050f, 10, 26], floor: 0x07080f, rim: [0x57d6ff, 0xff5fa8], hemi: [0xa0b8ff, 0x050816] },
];

interface BallView {
  id: number;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  matStd: THREE.MeshStandardMaterial;
  matPhys: THREE.MeshPhysicalMaterial;
  x: number;
  y: number;
  pocketed: boolean;
  sink: { last: number; hole: number; x: number; z: number; y: number; vx: number; vz: number; vy: number; falling: boolean } | null;
  lvx: number;
  lvz: number;
}

export interface AimState {
  angle: number;
  power: number;
  visible: boolean;
  /** hiện đường ngắm */
  guide: boolean;
}

export class BilliardScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private balls: BallView[] = [];
  private cueGroup = new THREE.Group();
  private ghostBall: THREE.Mesh;
  private sAim: Strip;
  private sObj: Strip;
  private sCue: Strip;
  private sRefl: Strip;
  private placeRing: THREE.Mesh;
  private key: THREE.SpotLight;
  private lamp = { level: 1, tone: 0 };
  private cueMats!: { shaft: THREE.MeshStandardMaterial; butt: THREE.MeshStandardMaterial; wrap: THREE.MeshStandardMaterial; ring: THREE.MeshStandardMaterial; tip: THREE.MeshStandardMaterial };
  private cueTex = new Map<number, THREE.CanvasTexture>();
  private cueShadow!: THREE.Mesh;
  private wearMat!: THREE.MeshStandardMaterial;
  private fx: Fx = FXS[0];
  fxOn = true;
  spin = { x: 0, y: 0 };
  private strokeSpin = { x: 0, y: 0 };
  private camAng = 0;
  private trail!: { pts: THREE.Points; pos: Float32Array; col: Float32Array; base: Float32Array; life: Float32Array; head: number; lx: number; ly: number; hue: number; mats: Record<string, THREE.Texture> };
  private raf = 0;
  private running = false;
  private aniso = 4;
  private floaters: THREE.Mesh[] = [];
  private envGroups: Record<string, THREE.Group> = {};
  private sky!: THREE.Mesh;
  private skyTex: Record<string, THREE.CanvasTexture> = {};
  private rimL!: THREE.DirectionalLight;
  private rimL2!: THREE.DirectionalLight;
  private hemiL!: THREE.HemisphereLight;
  private tm!: { felt: THREE.MeshStandardMaterial; wood: THREE.MeshStandardMaterial; cushion: THREE.MeshStandardMaterial; brass: THREE.MeshStandardMaterial; neon: THREE.MeshBasicMaterial; dia: THREE.MeshStandardMaterial; ring: THREE.MeshBasicMaterial };
  tableId = 'classic';
  envId = 'lounge';
  get tableTheme(): TableTheme { return TABLE_THEMES.find((t) => t.id === this.tableId) ?? TABLE_THEMES[0]; }

  quality: Quality = 'auto';
  camMode: CamMode = 'shoot';
  private frozen: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private freeAz = Math.PI / 2;
  private freePol = 0.9;
  private freeDist = 3.2;
  private camPos = new THREE.Vector3(0, 2, 2);
  private camLook = new THREE.Vector3();
  private shotCamUntil = 0;
  private cinemaFocus: THREE.Vector3 | null = null;
  private cinemaFocusUntil = 0;
  private introUntil = 0;
  private celebrate = false;
  private viewSeatSide = 1;
  /** dịch điểm nhìn theo trục màn hình (chừa chỗ cho HUD) — đơn vị: nửa chiều cao màn hình */
  private lookShift = 0;
  private focus = { x: 0, z: 0, yaw: 0, init: false };
  /** hệ số gần/xa của góc nhìn (0.75 gần · 1 vừa · 1.35 xa) */
  camDist = 1;
  private peek = false;
  private peekT = 0;
  setPeek(on: boolean): void { this.peek = on; }
  private overview = false;
  private blend = 0; // 0 = toàn cảnh, 1 = sau cơ
  private orbSlots = { follow: { az: 0, el: 0, z: 1 }, over: { az: 0, el: 0, z: 1 } };
  private readonly _gp2 = new THREE.Vector3();
  private readonly _gl2 = new THREE.Vector3();
  private viewAz = 0;
  private viewEl = 0;
  private viewZoom = 1;

  /** Trạng thái ngắm của chính mình và của người khác */
  aim: AimState = { angle: 0, power: 0.5, visible: false, guide: true };
  otherAim: { angle: number; power: number; seat: number } | null = null;
  private strokeT = 0;
  private strokePower = 0;
  private strokeActive = false;
  private strokeAngle = 0;

  // phát lại cú đánh
  private play: null | { msg: ShotResultMsg; t0: number; evIdx: number; done: () => void; sunk: Set<number>; clock: number; lastRt: number } = null;
  onEventSound = true;
  /** cú phá bi: phát mẫu âm thanh phá bi */
  breakShot = false;

  // thống kê hiệu năng
  fps = 0;
  dprNow = 1;
  private baseDpr = 1;
  private dprScale = 1;
  private lastTs = 0;
  private winN = 0;
  private winSum = 0;
  private winMin = 1e9;
  private goodWindows = 0;
  private cooldown = 0;
  private targetMs = 16.7;
  refreshHz = 60;
  menuMode = false;
  private lastRender = 0;

  // vật tạm (không cấp phát trong vòng lặp)
  private readonly _gp = new THREE.Vector3();
  private readonly _gl = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _ray = new THREE.Raycaster();
  private readonly _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
  private readonly _ndc = new THREE.Vector2();

  constructor(private canvas: HTMLCanvasElement) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 90);

    this.scene.background = new THREE.Color(0x120c22);
    this.scene.fog = new THREE.Fog(0x120c22, 9, 20);

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pm.dispose();

    this.hemiL = new THREE.HemisphereLight(0xcfd8ff, 0x2a1a3a, 0.55);
    this.scene.add(this.hemiL);
    this.key = new THREE.SpotLight(0xfff1dc, 2.6, 0, 0.62, 0.85, 0);
    this.key.position.set(0.5, 3.4, 0.7);
    this.key.target.position.set(0, 0, 0);
    this.key.shadow.camera.near = 1.5;
    this.key.shadow.camera.far = 7;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.01;
    this.key.shadow.radius = 3;
    this.scene.add(this.key, this.key.target);
    // đèn viền màu (thay cho PointLight để nhẹ hơn trên điện thoại)
    const rim = new THREE.DirectionalLight(0x9a7bff, 1.1);
    rim.position.set(-3, 2.5, -2.5);
    const rim2 = new THREE.DirectionalLight(0xff7ab8, 0.9);
    rim2.position.set(3, 2, 2.5);
    this.scene.add(rim, rim2);
    this.rimL = rim;
    this.rimL2 = rim2;

    this.buildSky();
    this.buildTable();
    this.buildBalls();
    this.buildCue();

    this.sAim = new Strip(this.scene, 0xffffff, 0.9, 0.0075, true);
    this.sObj = new Strip(this.scene, 0xffd34d, 0.95, 0.0075, false);
    this.sCue = new Strip(this.scene, 0xffffff, 0.7, 0.006, false);
    this.sRefl = new Strip(this.scene, 0xffffff, 0.35, 0.005, true);
    this.ghostBall = new THREE.Mesh(
      new THREE.SphereGeometry(R, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.ghostBall.visible = false;
    const ringGeo = new THREE.RingGeometry(R * 1.25, R * 1.6, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.placeRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x57ffb0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.placeRing.visible = false;
    this.scene.add(this.ghostBall, this.placeRing);
    this.setQuality(this.quality);
    this.setTable(this.tableId);
    this.setEnv(this.envId);
  }

  // ---------- dựng cảnh ----------
  // ---------- không gian xung quanh ----------
  private buildSky(): void {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  private skyTexture(e: EnvTheme): THREE.CanvasTexture {
    if (this.skyTex[e.id]) return this.skyTex[e.id];
    const c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    for (const [o, col] of e.sky) gr.addColorStop(o, col);
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.skyTex[e.id] = t;
    return t;
  }

  setEnv(id: string): void {
    const e = ENVS.find((x) => x.id === id) ?? ENVS[0];
    this.envId = e.id;
    for (const k in this.envGroups) this.envGroups[k].visible = false;
    if (!this.envGroups[e.id]) {
      this.envGroups[e.id] = this.buildEnv(e);
      this.scene.add(this.envGroups[e.id]);
    }
    const g = this.envGroups[e.id];
    g.visible = true;
    this.floaters = (g.userData.floaters as THREE.Mesh[]) ?? [];
    (this.sky.material as THREE.MeshBasicMaterial).map = this.skyTexture(e);
    (this.sky.material as THREE.MeshBasicMaterial).needsUpdate = true;
    this.scene.background = new THREE.Color(e.fog[0]);
    this.scene.fog = new THREE.Fog(e.fog[0], e.fog[1], e.fog[2]);
    this.rimL.color.set(e.rim[0]);
    this.rimL2.color.set(e.rim[1]);
    this.hemiL.color.set(e.hemi[0]);
    this.hemiL.groundColor.set(e.hemi[1]);
  }

  setTable(id: string): void {
    const t = TABLE_THEMES.find((x) => x.id === id) ?? TABLE_THEMES[0];
    this.tableId = t.id;
    this.tm.felt.color.set(t.felt).multiplyScalar(2.3);
    this.tm.cushion.color.set(t.cushion);
    this.tm.wood.color.set(t.wood);
    this.tm.brass.color.set(t.brass);
    this.tm.neon.color.set(t.neon);
    this.tm.dia.color.set(t.dia);
  }

  private buildEnv(e: EnvTheme): THREE.Group {
    const G = new THREE.Group();
    const floaters: THREE.Mesh[] = [];
    G.userData.floaters = floaters;
    const floorMat = new THREE.MeshStandardMaterial({ color: e.floor, roughness: e.id === 'arena' ? 0.2 : 0.85, metalness: e.id === 'arena' ? 0.6 : 0 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(e.id === 'sunset' ? 7 : 14, 48), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.78;
    G.add(floor);
    const ringAt = (r0: number, r1: number, color: number, op: number, y = -0.77) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: op }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      G.add(m);
    };
    const glow = (color: string, w: number, h: number, y = -0.76) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: radialTexture(color, color.replace(/[\d.]+\)$/, '0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      G.add(m);
    };
    const ceiling: THREE.Object3D[] = [];
    G.userData.ceiling = ceiling;
    const lampBar = () => {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.34), new THREE.MeshBasicMaterial({ color: 0xfff6dd }));
      lamp.position.set(0, 2.6, 0);
      const lampCase = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.44), new THREE.MeshStandardMaterial({ color: 0x15101f, roughness: 0.5 }));
      lampCase.position.set(0, 2.68, 0);
      G.add(lamp, lampCase);
      ceiling.push(lamp, lampCase);
    };
    const orb = (color: number, r: number, x: number, y: number, z: number, emi = 0.3) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: emi }));
      m.position.set(x, y, z);
      m.userData.float = Math.random() * 6;
      G.add(m);
      floaters.push(m);
      return m;
    };

    if (e.id === 'lounge') {
      ringAt(5.2, 5.24, 0xff5fa8, 0.45);
      glow('rgba(255,95,168,0.55)', 6.5, 4.2);
      lampBar();
      const colors = [0xff5fa8, 0x57d6ff, 0xffd34d, 0x8f6bff];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        orb(colors[i % 4], 0.1 + Math.random() * 0.12, Math.cos(a) * 5.5, -0.3 + Math.random() * 2.5, Math.sin(a) * 5.5, 0.25);
      }
    } else if (e.id === 'club') {
      glow('rgba(255,170,90,0.5)', 6.5, 4.2);
      ringAt(4.6, 4.66, 0xffc98a, 0.5);
      // đèn chùm thấp phía trên bàn
      for (const x of [-0.9, 0, 0.9]) {
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x0f5a3a, roughness: 0.5, side: THREE.DoubleSide }));
        shade.position.set(x, 2.3, 0);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff0c8 }));
        bulb.position.set(x, 2.2, 0);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.5, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
        cord.position.set(x, 3.1, 0);
        G.add(shade, bulb, cord);
        ceiling.push(shade, bulb, cord);
      }
      // tường gỗ + đèn tường + tranh
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a2a16, roughness: 0.7 });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.6, 0.15), wallMat);
        panel.position.set(Math.cos(a) * 8, 1.0, Math.sin(a) * 8);
        panel.lookAt(0, 1.0, 0);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.8, roughness: 0.3 }));
        frame.position.set(Math.cos(a) * 7.9, 1.3, Math.sin(a) * 7.9);
        frame.lookAt(0, 1.3, 0);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
        lamp.position.set(Math.cos(a) * 7.8, 2.2, Math.sin(a) * 7.8);
        G.add(panel, frame, lamp);
      }
    } else if (e.id === 'space') {
      floor.material = new THREE.MeshStandardMaterial({ color: 0x0b0d26, roughness: 0.3, metalness: 0.7, transparent: true, opacity: 0.85 });
      for (const r of [2.5, 3.5, 4.5, 5.5]) ringAt(r, r + 0.03, 0x57d6ff, 0.35);
      glow('rgba(87,214,255,0.45)', 7, 5);
      // sao
      const N = 900;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * 6.283, r = 40 + Math.random() * 20;
        const q = Math.sqrt(1 - u * u);
        pos[i * 3] = Math.cos(th) * q * r; pos[i * 3 + 1] = Math.abs(u) * r * 0.9 - 4; pos[i * 3 + 2] = Math.sin(th) * q * r;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      G.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, sizeAttenuation: true, fog: false })));
      // hành tinh
      const planet = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 20), new THREE.MeshStandardMaterial({ color: 0x7a4cff, roughness: 0.7, emissive: 0x2a1470, emissiveIntensity: 0.5 }));
      planet.position.set(-18, 9, -26);
      const pr = new THREE.Mesh(new THREE.RingGeometry(7, 10, 64), new THREE.MeshBasicMaterial({ color: 0xffb86b, side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false }));
      pr.position.copy(planet.position);
      pr.rotation.set(1.2, 0.3, 0);
      const moon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 14), new THREE.MeshStandardMaterial({ color: 0xcfd6ff, roughness: 0.9, emissive: 0x303860, emissiveIntensity: 0.4 }));
      moon.position.set(22, 7, -20);
      G.add(planet, pr, moon);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        orb([0x57d6ff, 0xb06bff, 0xffd34d][i % 3], 0.12 + Math.random() * 0.16, Math.cos(a) * 6, -0.2 + Math.random() * 3, Math.sin(a) * 6, 0.7);
      }
    } else if (e.id === 'sunset') {
      // sàn gỗ bến tàu + biển
      const sea = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x1b3f7a, roughness: 0.25, metalness: 0.5 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -1.0;
      G.add(sea);
      const sun = new THREE.Mesh(new THREE.CircleGeometry(5, 40), new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false }));
      sun.position.set(0, 3.2, -48);
      const sunGlow = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,170,90,0.8)', 'rgba(255,170,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      sunGlow.position.set(0, 3.2, -47);
      G.add(sun, sunGlow);
      // ván sàn
      const plank = new THREE.MeshStandardMaterial({ color: 0x8a5a38, roughness: 0.8 });
      for (let i = -6; i <= 6; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(14, 0.05, 0.42), plank);
        b.position.set(0, -0.78, i * 0.5);
        b.scale.x = Math.sqrt(Math.max(0.05, 1 - (i / 7) ** 2));
        G.add(b);
      }
      floor.visible = false;
      // cọc đèn dây
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.8 }));
        post.position.set(Math.cos(a) * 6.2, 0.5, Math.sin(a) * 6.2);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
        bulb.position.set(Math.cos(a) * 6.2, 1.85, Math.sin(a) * 6.2);
        G.add(post, bulb);
      }
      // cọ
      for (const [x, z, h] of [[-5.2, -3.5, 3.2], [5.6, -2.6, 2.8]] as Array<[number, number, number]>) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h, 8), new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 }));
        trunk.position.set(x, h / 2 - 0.8, z);
        trunk.rotation.z = x > 0 ? 0.12 : -0.12;
        G.add(trunk);
        for (let k = 0; k < 7; k++) {
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0x1f7a45, roughness: 0.8 }));
          const a = (k / 7) * Math.PI * 2;
          leaf.position.set(x + Math.cos(a) * 0.8 + (x > 0 ? 0.3 : -0.3), h - 0.7, z + Math.sin(a) * 0.8);
          leaf.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
          G.add(leaf);
        }
      }
      glow('rgba(255,160,100,0.35)', 6.5, 4.2, -0.74);
    } else if (e.id === 'golf' || e.id === 'garden') {
      const golf = e.id === 'golf';
      floor.material = new THREE.MeshStandardMaterial({ color: e.floor, roughness: golf ? 0.55 : 0.8, metalness: 0 });
      (floor.geometry as THREE.BufferGeometry).dispose();
      floor.geometry = new THREE.CircleGeometry(golf ? 4.9 : 4.2, 56);
      ringAt(golf ? 4.9 : 4.2, (golf ? 4.9 : 4.2) + 0.06, golf ? 0x8a7a62 : 0x8f8470, 0.9);
      const A2 = this.aniso;
      const lawn = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), new THREE.MeshStandardMaterial({ map: mowTexture(golf ? '#3d8c38' : '#4f9a3c', golf ? '#47a042' : '#5aa845', 44, A2), roughness: 1 }));
      lawn.rotation.x = -Math.PI / 2; lawn.position.y = -0.8; G.add(lawn);
      const mat = (c: number, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
      const tree = (x: number, z: number, h: number, leaf: number) => {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * h / 4, 0.2 * h / 4, h * 0.45, 7), mat(0x5a3b22));
        trunk.position.set(x, -0.8 + h * 0.22, z);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.36, 1), mat(leaf, 0.95));
        crown.position.set(x, -0.8 + h * 0.62, z); crown.scale.set(1, 1.15, 1);
        const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.26, 1), mat(leaf + 0x0a1a05, 0.95));
        c2.position.set(x + h * 0.14, -0.8 + h * 0.84, z - h * 0.05);
        G.add(trunk, crown, c2);
      };
      if (golf) {
        // đồi golf lượn sóng + fairway + green + bunker + hồ + cờ
        for (const [x, z, r, sy] of [[-30, -32, 16, 0.22], [18, -44, 20, 0.28], [38, -20, 13, 0.2], [-44, 4, 14, 0.24], [4, -60, 24, 0.3]] as Array<[number, number, number, number]>) {
          const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12), new THREE.MeshStandardMaterial({ map: mowTexture('#3a8736', '#449640', 20, A2), roughness: 1 }));
          hill.scale.y = sy; hill.position.set(x, -0.8, z); G.add(hill);
        }
        const fair = new THREE.Mesh(new THREE.PlaneGeometry(9, 70), new THREE.MeshStandardMaterial({ map: mowTexture('#58b048', '#63bd52', 16, A2), roughness: 1 }));
        fair.rotation.x = -Math.PI / 2; fair.position.set(0, -0.79, -38); G.add(fair);
        const green = new THREE.Mesh(new THREE.CircleGeometry(7, 40), new THREE.MeshStandardMaterial({ color: 0x6fd05a, roughness: 1 }));
        green.rotation.x = -Math.PI / 2; green.position.set(1, -0.785, -34); G.add(green);
        const bunker = (x: number, z: number, sx: number, sz: number) => { const b = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat(0xe8d9a8, 1)); b.rotation.x = -Math.PI / 2; b.scale.set(sx, sz, 1); b.position.set(x, -0.784, z); G.add(b); };
        bunker(-7, -30, 3.2, 2); bunker(8.5, -36, 2.6, 1.7); bunker(-9, -48, 4, 2.4);
        const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 36), new THREE.MeshStandardMaterial({ color: 0x3f86c8, roughness: 0.1, metalness: 0.5 }));
        pond.rotation.x = -Math.PI / 2; pond.scale.set(7, 4, 1); pond.position.set(-15, -0.78, -22); G.add(pond);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6), mat(0xffffff, 0.4)); pole.position.set(1, 0.9, -34);
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 3), new THREE.MeshBasicMaterial({ color: 0xe33a3a, side: THREE.DoubleSide })); flag.rotation.z = -Math.PI / 2; flag.position.set(1.5, 2.2, -34);
        G.add(pole, flag);
        for (let i = 0; i < 22; i++) { const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 28; tree(Math.cos(a) * r, -8 - Math.abs(Math.sin(a)) * r, 3 + Math.random() * 3.5, 0x2f7a33 + ((Math.random() * 3) | 0) * 0x050a02); }
        // nhà kính: khung thép trắng + kính
        const frame = mat(0xf0f2f4, 0.35);
        const glassMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
        const N = 14, Rg = 5.4;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3.6, 0.09), frame);
          post.position.set(Math.cos(a) * Rg, 1.0, Math.sin(a) * Rg); G.add(post);
          const a2 = ((i + 1) / N) * Math.PI * 2, am = (a + a2) / 2;
          const pane = new THREE.Mesh(new THREE.PlaneGeometry(2 * Rg * Math.sin(Math.PI / N), 3.4), glassMat);
          pane.position.set(Math.cos(am) * Rg * Math.cos(Math.PI / N), 1.0, Math.sin(am) * Rg * Math.cos(Math.PI / N)); pane.lookAt(0, 1.0, 0); G.add(pane);
          const rafter = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, Rg * 1.05), frame);
          rafter.position.set(Math.cos(a) * Rg * 0.5, 3.45, Math.sin(a) * Rg * 0.5); rafter.rotation.y = -a + Math.PI / 2; rafter.rotation.x = 0.0;
          rafter.lookAt(0, 4.4, 0); G.add(rafter); ceiling.push(rafter);
        }
        const ringB = new THREE.Mesh(new THREE.TorusGeometry(Rg, 0.05, 6, 56), frame); ringB.rotation.x = Math.PI / 2; ringB.position.y = 2.8; G.add(ringB);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Rg * 1.02, 1.6, N, 1, true), new THREE.MeshBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
        roof.position.y = 3.6; G.add(roof); ceiling.push(roof);
        lampBar();
        glow('rgba(255,244,214,0.3)', 7, 4.6, -0.76);
        const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 30), new THREE.MeshBasicMaterial({ color: 0xfff4c8, fog: false }));
        sun.position.set(26, 24, -58); sun.lookAt(0, 0, 0); G.add(sun);
      } else {
        // sân vườn: hàng rào cây, bồn hoa, giàn gỗ + đèn dây, cây lớn
        const hedgeM = new THREE.MeshStandardMaterial({ color: 0x2d6a2f, roughness: 1 });
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * Math.PI * 2;
          const hd = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.9), hedgeM);
          hd.position.set(Math.cos(a) * 9.5, -0.05, Math.sin(a) * 9.5); hd.lookAt(0, -0.05, 0); G.add(hd);
        }
        const fl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), 360);
        const m4 = new THREE.Matrix4(), cc = new THREE.Color(); const pal = [0xff5f8a, 0xffd34d, 0xff8a3a, 0xc07aff, 0xffffff, 0x57d6ff];
        for (let i = 0; i < 360; i++) { const a = Math.random() * Math.PI * 2, r = 7.2 + Math.random() * 1.4; m4.makeTranslation(Math.cos(a) * r, -0.7 + Math.random() * 0.12, Math.sin(a) * r); fl.setMatrixAt(i, m4); fl.setColorAt(i, cc.set(pal[(Math.random() * pal.length) | 0])); }
        G.add(fl);
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.2, r = 13 + Math.random() * 14; tree(Math.cos(a) * r, Math.sin(a) * r, 5 + Math.random() * 4, 0x2f7a33 + ((Math.random() * 3) | 0) * 0x040a02); }
        // giàn gỗ phía trên bàn
        const wd = mat(0x7a5232, 0.7);
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.4, 0.16), wd); post.position.set(sx * 3.4, 0.9, sz * 2.4); G.add(post);
        }
        for (let i = -3; i <= 3; i++) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 5.2), wd); beam.position.set(i * 1.0, 2.7, 0); G.add(beam); ceiling.push(beam);
        }
        for (const z of [-2.4, 2.4]) { const bb = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.16, 0.16), wd); bb.position.set(0, 2.62, z); G.add(bb); ceiling.push(bb); }
        for (let i = 0; i < 30; i++) { const v = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + Math.random() * 0.1, 0), mat(0x3b8f3a, 1)); v.position.set(-3.3 + Math.random() * 6.6, 2.55 - Math.random() * 0.15, -2.4 + Math.random() * 4.8); G.add(v); ceiling.push(v); }
        // đèn dây (catenary) quanh giàn
        const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff0b8 }), 90);
        let bi = 0;
        for (const z of [-2.4, 2.4]) for (let i = 0; i < 20 && bi < 90; i++) { const x = -3.4 + (i / 19) * 6.8; m4.makeTranslation(x, 2.55 - 0.18 * Math.sin((i / 19) * Math.PI), z); bulbs.setMatrixAt(bi++, m4); }
        for (const x of [-3.4, 3.4]) for (let i = 0; i < 12 && bi < 90; i++) { const z = -2.4 + (i / 11) * 4.8; m4.makeTranslation(x, 2.55 - 0.18 * Math.sin((i / 11) * Math.PI), z); bulbs.setMatrixAt(bi++, m4); }
        bulbs.count = bi; G.add(bulbs); ceiling.push(bulbs);
        glow('rgba(255,214,150,0.32)', 7, 4.6, -0.76);
        const sun = new THREE.Mesh(new THREE.CircleGeometry(3.4, 30), new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false }));
        sun.position.set(-30, 16, -50); sun.lookAt(0, 0, 0); G.add(sun);
        // bậc đá lối đi
        for (let i = 0; i < 8; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 12), mat(0xb7ad98, 0.9)); st.position.set(0.3 * Math.sin(i), -0.78, 4.8 + i * 0.85); G.add(st); }
      }
    } else if (e.id === 'stadium') {
      const A2 = this.aniso;
      floor.material = new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.6 });
      (floor.geometry as THREE.BufferGeometry).dispose();
      floor.geometry = new THREE.CircleGeometry(4.2, 56);
      floor.position.y = -0.77;
      ringAt(4.2, 4.28, 0xffffff, 0.9, -0.765);
      const pitch = new THREE.Mesh(new THREE.PlaneGeometry(64, 40), new THREE.MeshStandardMaterial({ map: pitchTexture(A2), roughness: 1 }));
      pitch.rotation.x = -Math.PI / 2; pitch.position.y = -0.8; G.add(pitch);
      const track = new THREE.Mesh(new THREE.RingGeometry(1, 1.0, 4), new THREE.MeshBasicMaterial());
      void track;
      const around = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), new THREE.MeshStandardMaterial({ color: 0x1b3a22, roughness: 1 }));
      around.rotation.x = -Math.PI / 2; around.position.y = -0.82; G.add(around);
      const gm = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
      for (const sx of [-1, 1]) {
        const g1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), gm), g2 = g1.clone(), bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 7.4), gm);
        g1.position.set(sx * 30.5, 0.4, -3.7); g2.position.set(sx * 30.5, 0.4, 3.7); bar.position.set(sx * 30.5, 1.6, 0); G.add(g1, g2, bar);
        const net = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 2.4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide }));
        net.rotation.y = Math.PI / 2; net.position.set(sx * 31.5, 0.4, 0); G.add(net);
      }
      // khán đài nhiều tầng: ghế + khán giả bằng instancing
      const rows = 9, perRow = 200;
      const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), rows * perRow);
      const m4 = new THREE.Matrix4(), cc = new THREE.Color(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
      const crowd = [0xe33a3a, 0x2a6be0, 0xf4f4f4, 0xffd34d, 0x2a2a30, 0x57d6ff, 0xff8a3a];
      let k = 0;
      for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i++) {
        const a = (i / perRow) * Math.PI * 2 + (r % 2) * 0.01;
        const ra = 36 + r * 1.3, rb = 25 + r * 1.3;
        const x = Math.cos(a) * ra, z = Math.sin(a) * rb;
        q.setFromAxisAngle(up, -a - Math.PI / 2);
        m4.compose(new THREE.Vector3(x, -0.4 + r * 0.85, z), q, sc);
        seats.setMatrixAt(k, m4); seats.setColorAt(k, cc.set(Math.random() < 0.82 ? crowd[(Math.random() * crowd.length) | 0] : 0x30343f)); k++;
      }
      G.add(seats);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 10, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x141a2a, roughness: 0.9, side: THREE.BackSide }));
      wall.scale.set(50, 1, 38); wall.position.y = 3.6; G.add(wall);
      // cột đèn pha
      for (const [x, z] of [[-34, -24], [34, -24], [-34, 24], [34, 24]]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 20, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6 }));
        pole.position.set(x, 9.2, z); G.add(pole);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
        panel.position.set(x, 19.8, z); panel.lookAt(0, 6, 0); G.add(panel);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,244,214,0.7)', 'rgba(255,244,214,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        gl.position.set(x, 19.8, z); gl.lookAt(0, 6, 0); G.add(gl);
      }
      glow('rgba(255,240,200,0.28)', 7, 4.6, -0.74);
      const N2 = 700, sp = new Float32Array(N2 * 3);
      for (let i = 0; i < N2; i++) { const th = Math.random() * 6.28, ph = 0.15 + Math.random() * 1.2, r = 60; sp[i * 3] = Math.cos(th) * Math.sin(ph) * r; sp[i * 3 + 1] = Math.cos(ph) * r * 0.8 + 6; sp[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r; }
      const sgm = new THREE.BufferGeometry(); sgm.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      G.add(new THREE.Points(sgm, new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, fog: false })));
    } else if (e.id === 'rooftop') {
      floor.visible = false;
      const deckC = document.createElement('canvas'); deckC.width = 256; deckC.height = 256;
      { const g = deckC.getContext('2d')!; for (let i = 0; i < 8; i++) { const v = 90 + Math.random() * 30; g.fillStyle = `rgb(${v + 30},${v},${v - 30})`; g.fillRect(0, i * 32, 256, 31); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, i * 32 + 31, 256, 1); for (let j = 0; j < 40; j++) { g.strokeStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); const y = i * 32 + Math.random() * 30; g.moveTo(0, y); g.lineTo(256, y + (Math.random() - 0.5) * 3); g.stroke(); } } }
      const deckT = new THREE.CanvasTexture(deckC); deckT.wrapS = deckT.wrapT = THREE.RepeatWrapping; deckT.repeat.set(5, 5); deckT.colorSpace = THREE.SRGBColorSpace; deckT.anisotropy = this.aniso;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 14), new THREE.MeshStandardMaterial({ map: deckT, roughness: 0.7 }));
      deck.position.y = -0.83; G.add(deck);
      const frame = new THREE.MeshStandardMaterial({ color: 0x1b1d26, roughness: 0.4, metalness: 0.6 });
      const glassM = new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false });
      for (let i = -3; i <= 3; i++) for (const sd of [0, 1, 2, 3]) {
        const px = sd < 2 ? i * 2 : (sd === 2 ? -6 : 6), pz = sd < 2 ? (sd === 0 ? -6 : 6) : i * 2;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.3, 0.07), frame); post.position.set(px, -0.15, pz); G.add(post);
      }
      for (const [x, z, w, r] of [[0, -6, 12, 0], [0, 6, 12, 0], [-6, 0, 12, Math.PI / 2], [6, 0, 12, Math.PI / 2]] as Array<[number, number, number, number]>) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), glassM); pane.position.set(x, -0.15, z); pane.rotation.y = r; G.add(pane);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(r ? 0.08 : w, 0.06, r ? w : 0.08), frame); rail.position.set(x, 0.5, z); G.add(rail);
      }
      // thành phố: toà nhà bằng instancing + cửa sổ phát sáng
      const wt = windowTexture();
      const bm = new THREE.MeshStandardMaterial({ color: 0x20243a, map: wt, emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: 0.9, roughness: 0.8 });
      const NB = 160;
      const bld = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bm, NB);
      const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();
      for (let i = 0; i < NB; i++) {
        const a = Math.random() * Math.PI * 2, r = 36 + Math.random() * 40;
        const w = 3 + Math.random() * 6, h = 8 + Math.random() * 46;
        m4.compose(new THREE.Vector3(Math.cos(a) * r, -0.8 - 8 + h / 2, Math.sin(a) * r), q0, new THREE.Vector3(w, h + 8, w));
        bld.setMatrixAt(i, m4);
      }
      G.add(bld);
      for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, r = 30 + Math.random() * 30; const bc = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a3a, fog: false })); bc.position.set(Math.cos(a) * r, 40 + Math.random() * 10, Math.sin(a) * r); G.add(bc); }
      const horizon = new THREE.Mesh(new THREE.PlaneGeometry(120, 30), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,140,110,0.5)', 'rgba(255,140,110,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      horizon.position.set(0, 4, -60); G.add(horizon);
      // đèn dây + chậu cây + sofa
      const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), 60);
      for (let i = 0; i < 60; i++) { const t = i / 59; m4.makeTranslation(-6 + t * 12, 2.4 - 0.35 * Math.sin(t * Math.PI), i % 2 ? -5.8 : 5.8); bulbs.setMatrixAt(i, m4); }
      G.add(bulbs); ceiling.push(bulbs);
      for (const [x, z] of [[-5.4, -5.4], [5.4, -5.4], [-5.4, 5.4], [5.4, 5.4]]) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.7 })); pot.position.set(x, -0.52, z);
        const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ color: 0x2f8a4a, roughness: 1 })); plant.position.set(x, 0.05, z);
        G.add(pot, plant);
      }
      glow('rgba(255,170,200,0.3)', 7, 4.6, -0.76);
    } else {
      // arena
      for (const r of [2.4, 3.6, 4.8, 6.0]) ringAt(r, r + 0.04, r > 5 ? 0xff5fa8 : 0x57d6ff, 0.6);
      glow('rgba(87,214,255,0.4)', 7, 5);
      lampBar();
      // chùm tia sáng
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.9, 9, 20, 1, true), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x57d6ff : 0xff5fa8, transparent: true, opacity: 0.10, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        beam.position.set(Math.cos(a) * 5, 3.5, Math.sin(a) * 5);
        beam.rotation.set(Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28);
        G.add(beam);
      }
      // khán đài: các chấm sáng nhiều màu
      const N = 420;
      const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      const cs = [0xff5fa8, 0x57d6ff, 0xffd34d, 0x8f6bff, 0xffffff];
      for (let i = 0; i < N; i++) {
        const tier = i % 5;
        const a = Math.random() * Math.PI * 2;
        const r = 9 + tier * 0.9;
        m4.makeTranslation(Math.cos(a) * r, -0.2 + tier * 0.7 + Math.random() * 0.2, Math.sin(a) * r);
        dots.setMatrixAt(i, m4);
        dots.setColorAt(i, col.set(cs[(Math.random() * cs.length) | 0]));
      }
      G.add(dots);
    }
    return G;
  }

  private buildTable(): void {
    const A = this.aniso;
    const woodTex = woodTexture(A);
    const wood = new THREE.MeshStandardMaterial({ map: woodTex, bumpMap: woodTex, bumpScale: 0.6, roughness: 0.42, metalness: 0.05, envMapIntensity: 0.9 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x2c140b, roughness: 0.6 });
    const feltTex = feltTexture(A);
    const feltMat = new THREE.MeshStandardMaterial({ map: feltTex, bumpMap: feltTex, bumpScale: 0.9, roughness: 0.96, metalness: 0, envMapIntensity: 0.25 });
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0x1b9a5c, roughness: 0.9, envMapIntensity: 0.2 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xe0b050, metalness: 1, roughness: 0.28 });
    const t = new THREE.Group();

    const holes: Multi = HOLES.map((h) => [circle(h.x, h.z, h.r, 40)]);
    const outerHX = L / 2 + CUSHION_D + RAIL_W;
    const outerHZ = W / 2 + CUSHION_D + RAIL_W;
    const innerHX = L / 2 + CUSHION_D;
    const innerHZ = W / 2 + CUSHION_D;
    const outer: Multi = [[rrect(outerHX, outerHZ, 0.07)]];
    const inner: Multi = [[[[-innerHX, -innerHZ], [innerHX, -innerHZ], [innerHX, innerHZ], [-innerHX, innerHZ]]]];

    // Mặt nỉ có lỗ thật
    const feltPoly = polygonClipping.difference(inner as never, ...(holes as never[])) as Multi;
    const felt = new THREE.Mesh(flat(feltPoly, 0), feltMat);
    felt.receiveShadow = true;
    t.add(felt);
    // quầng sáng đèn trên nỉ (cộng sáng) — dùng cùng hình học
    const pool = new THREE.Mesh(flat(feltPoly, 0.0008), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,244,214,0.16)', 'rgba(255,244,214,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    // uv của ShapeGeometry là toạ độ mét: chuẩn hoá về 0..1 theo kích thước nỉ
    {
      const uv = pool.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + innerHX) / (2 * innerHX), (uv.getY(i) + innerHZ) / (2 * innerHZ));
    }
    pool.renderOrder = 1;
    t.add(pool);
    // bóng đổ nhẹ dưới chân đệm băng (ambient occlusion giả) cho bàn có chiều sâu
    const aoC = document.createElement('canvas');
    aoC.width = 512; aoC.height = 256;
    {
      const g = aoC.getContext('2d')!;
      const e = 38;
      const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, 'rgba(0,0,0,0.55)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(rx, ry, rw, rh);
      };
      edge(0, 0, e, 0, 0, 0, e, 256); edge(512, 0, 512 - e, 0, 512 - e, 0, e, 256);
      edge(0, 0, 0, e * 0.8, 0, 0, 512, e * 0.8); edge(0, 256, 0, 256 - e * 0.8, 0, 256 - e * 0.8, 512, e * 0.8);
    }
    const aoTex = new THREE.CanvasTexture(aoC);
    const ao = new THREE.Mesh(flat(feltPoly, 0.0005), new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false }));
    {
      const uv = ao.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + innerHX) / (2 * innerHX), (uv.getY(i) + innerHZ) / (2 * innerHZ));
    }
    ao.renderOrder = 1;
    t.add(ao);
    // dấu vết sử dụng trên nỉ (phấn, xước, vệt mòn)
    const wearMat = new THREE.MeshStandardMaterial({ map: feltWearTexture(A, 0.9), transparent: true, depthWrite: false, roughness: 0.7, metalness: 0, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.wearMat = wearMat;
    const wear = new THREE.Mesh(flat(feltPoly, 0.0006), wearMat);
    {
      const uv = wear.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + innerHX) / (2 * innerHX), (uv.getY(i) + innerHZ) / (2 * innerHZ));
    }
    wear.renderOrder = 1;
    t.add(wear);

    // Thân bàn (đá) + khung gỗ có lỗ
    const slatePoly = polygonClipping.difference(inner as never, ...(holes as never[])) as Multi;
    t.add(new THREE.Mesh(extrude(slatePoly, BODY_BOTTOM, -BODY_BOTTOM - 0.004), woodDark));
    const railRegion = polygonClipping.difference(outer as never, inner as never) as Multi;
    const railPoly = polygonClipping.difference(outer as never, inner as never, ...(holes as never[])) as Multi;
    const railMesh = new THREE.Mesh(extrude(railPoly, BODY_BOTTOM, RAIL_H - BODY_BOTTOM, 0.006), wood);
    railMesh.castShadow = railMesh.receiveShadow = true;
    t.add(railMesh);

    // Đệm băng (trapezoid, cắt theo lỗ)
    const cush: Multi = [];
    const hx = L / 2;
    const hz = W / 2;
    const cN = 0.085, cB = 0.04, sN = 0.068, sB = 0.045;
    const trap = (a: Pt, b: Pt, c: Pt, d: Pt): Poly => [[a, b, c, d]];
    for (const sz of [-1, 1]) {
      const zn = sz * hz, zb = sz * (hz + CUSHION_D);
      for (const sx of [-1, 1]) {
        cush.push(trap([sx * (hx - cN), zn], [sx * sN, zn], [sx * sB, zb], [sx * (hx - cB), zb]));
      }
    }
    for (const sx of [-1, 1]) {
      const xn = sx * hx, xb = sx * (hx + CUSHION_D);
      cush.push(trap([xn, -(hz - cN)], [xn, hz - cN], [xb, hz - cB], [xb, -(hz - cB)]));
    }
    const cushPoly = polygonClipping.difference(cush as never, ...(holes as never[])) as Multi;
    const cushMesh = new THREE.Mesh(extrude(cushPoly, 0, CUSHION_H, 0.004), cushionMat);
    cushMesh.castShadow = cushMesh.receiveShadow = true;
    t.add(cushMesh);

    // Viền đồng quanh lỗ (chỉ phần nằm trên khung)
    const ringPoly = polygonClipping.intersection(
      polygonClipping.difference(
        (polygonClipping.union as (...a: unknown[]) => unknown)(...HOLES.map((h) => [circle(h.x, h.z, h.r + 0.011, 40)])) as never,
        ...(holes as never[]),
      ) as never,
      railRegion as never,
    ) as Multi;
    if (ringPoly.length) t.add(new THREE.Mesh(extrude(ringPoly, RAIL_H + 0.0005, 0.003), brass));

    // Giếng lỗ: ống đen chuyển dần xuống đáy
    for (const h of HOLES) {
      const geo = new THREE.CylinderGeometry(h.r - 0.002, h.r - 0.004, -BODY_BOTTOM, 28, 4, true);
      const pos = geo.getAttribute('position');
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const depth = 1 - (pos.getY(i) + 0.15) / 0.3; // 0 ở miệng, 1 ở đáy
        const v = 0.16 * (1 - depth) * (1 - depth);
        col[i * 3] = v; col[i * 3 + 1] = v * 0.95; col[i * 3 + 2] = v * 1.1;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
      m.position.set(h.x, BODY_BOTTOM / 2, h.z);
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(h.r, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      bottom.position.set(h.x, BODY_BOTTOM + 0.002, h.z);
      t.add(m, bottom);
    }

    // Điểm ngắm (diamond) bằng InstancedMesh
    const diaPos: Array<[number, number]> = [];
    const offZ = W / 2 + CUSHION_D + RAIL_W / 2;
    const offX = L / 2 + CUSHION_D + RAIL_W / 2;
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      const x = -L / 2 + (L / 8) * i;
      diaPos.push([x, -offZ], [x, offZ]);
    }
    for (let i = 1; i < 4; i++) {
      const z = -W / 2 + (W / 4) * i;
      diaPos.push([-offX, z], [offX, z]);
    }
    const diaGeo = new THREE.CylinderGeometry(0.0115, 0.0115, 0.003, 4);
    diaGeo.rotateY(Math.PI / 4);
    diaGeo.scale(0.8, 1, 1.25);
    const diaMat = new THREE.MeshStandardMaterial({ color: 0xf7eac0, roughness: 0.25, metalness: 0.5 });
    const dia = new THREE.InstancedMesh(diaGeo, diaMat, diaPos.length);
    const mtx = new THREE.Matrix4();
    diaPos.forEach(([x, z], i) => { mtx.makeTranslation(x, RAIL_H + 0.0016, z); dia.setMatrixAt(i, mtx); });
    t.add(dia);

    // Chấm đầu bàn / cuối bàn
    for (const px of [-L / 4, L / 4]) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
      m.position.set(px, 0.0012, 0);
      t.add(m);
    }

    // Dải neon dưới bàn
    const neon = polygonClipping.difference([[rrect(outerHX + 0.006, outerHZ + 0.006, 0.075)]] as never, [[rrect(outerHX - 0.012, outerHZ - 0.012, 0.06)]] as never) as Multi;
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xff5fa8 });
    t.add(new THREE.Mesh(extrude(neon, -0.27, 0.012), neonMat));
    this.tm = { felt: feltMat, wood, cushion: cushionMat, brass, neon: neonMat, dia: diaMat, ring: neonMat };

    // Chân bàn
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.48, 16), wood);
        leg.position.set(sx * (L / 2 + 0.07), -0.54, sz * (W / 2 + 0.07));
        t.add(leg);
      }
    }

    t.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    this.scene.add(t);
  }

  private buildBalls(): void {
    const geo = new THREE.SphereGeometry(R, 48, 32);
    const shadowGeo = new THREE.PlaneGeometry(R * 5.2, R * 5.2).rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.62)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false });
    for (let id = 0; id < 16; id++) {
      const map = ballTexture(id, this.aniso);
      const rmap = ballRoughTexture(id);
      const matStd = new THREE.MeshStandardMaterial({ map, roughnessMap: rmap, roughness: 0.55, metalness: 0, envMapIntensity: 1.1 });
      const matPhys = new THREE.MeshPhysicalMaterial({ map, roughnessMap: rmap, roughness: 0.45, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
      const mesh = new THREE.Mesh(geo, matStd);
      mesh.visible = false;
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.position.y = 0.0016;
      shadow.visible = false;
      shadow.renderOrder = 2;
      this.scene.add(mesh, shadow);
      this.balls.push({ id, mesh, shadow, matStd, matPhys, x: 0, y: 0, pocketed: true, sink: null, lvx: 0, lvz: 0 });
    }
  }

  private buildCue(): void {
    const seg = (r0: number, r1: number, len: number, x0: number, mat: THREE.Material): THREE.Mesh => {
      // r0 ở phía đầu cơ (+x), r1 ở phía sau
      const g = new THREE.CylinderGeometry(r0, r1, len, 18);
      g.rotateZ(-Math.PI / 2);
      g.translate(-(x0 + len / 2), 0, 0);
      return new THREE.Mesh(g, mat);
    };
    const mShaft = new THREE.MeshStandardMaterial({ color: 0xf0d9a6, roughness: 0.3, envMapIntensity: 1.2 });
    const mButt = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.1, envMapIntensity: 1.3 });
    const mWrap = new THREE.MeshStandardMaterial({ color: 0xff5fa8, roughness: 0.5 });
    const mGold = new THREE.MeshStandardMaterial({ color: 0xe0b050, metalness: 1, roughness: 0.25 });
    const mTip = new THREE.MeshStandardMaterial({ color: 0x3aa0ff, roughness: 0.9 });
    this.cueMats = { shaft: mShaft, butt: mButt, wrap: mWrap, ring: mGold, tip: mTip };
    const parts = [
      seg(0.0062, 0.0062, 0.006, 0, mTip),
      seg(0.0066, 0.0066, 0.022, 0.006, new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.4 })),
      seg(0.0066, 0.0102, 0.76, 0.028, mShaft),
      seg(0.0104, 0.0104, 0.012, 0.788, mGold),
      seg(0.0105, 0.0156, 0.46, 0.8, mButt),
      seg(0.0156, 0.0156, 0.12, 0.9, mWrap),
      seg(0.0158, 0.0158, 0.008, 1.26, mGold),
      seg(0.0156, 0.0156, 0.17, 1.268, mButt),
      seg(0.0158, 0.0158, 0.012, 1.438, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })),
    ];
    for (const p of parts) { p.castShadow = false; this.cueGroup.add(p); } // bóng cơ dùng tấm bóng mờ riêng (shadow map ở cấu hình cao bị lốm đốm)
    this.cueGroup.visible = false;
    this.scene.add(this.cueGroup);
    // bóng mờ của cơ trên mặt bàn
    const cg = document.createElement('canvas'); cg.width = 8; cg.height = 32;
    const cx = cg.getContext('2d')!; const gr = cx.createLinearGradient(0, 0, 0, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 8, 32);
    const sg = new THREE.PlaneGeometry(1.45, 0.05).rotateX(-Math.PI / 2);
    sg.translate(-0.725, 0, 0);
    const smat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cg), transparent: true, depthWrite: false, opacity: 0.8 });
    smat.map!.rotation = Math.PI / 2; smat.map!.center.set(0.5, 0.5);
    this.cueShadow = new THREE.Mesh(sg, smat);
    this.cueShadow.renderOrder = 2; this.cueShadow.visible = false;
    this.scene.add(this.cueShadow);
    this.setCueSkin(0);
    this.buildTrail();
  }

  // ---------- gậy / hiệu ứng / đèn ----------
  setCueSkin(i: number): void {
    const k = CUES[i] ?? CUES[0];
    const m = this.cueMats;
    let tex = this.cueTex.get(i);
    if (!tex) {
      tex = new THREE.CanvasTexture(cueTexture(k));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.aniso;
      this.cueTex.set(i, tex);
    }
    m.butt.map = tex;
    m.butt.bumpMap = tex;
    m.butt.bumpScale = 0.5;
    m.butt.color.set(0xffffff);
    m.butt.emissive.set(k.glow ?? 0x000000);
    m.butt.emissiveMap = k.glow ? tex : null;
    m.butt.emissiveIntensity = k.glow ? 0.55 : 0;
    m.butt.needsUpdate = true;
    m.shaft.color.set(k.shaft);
    m.wrap.color.set(k.accent);
    m.ring.color.set(k.ring);
    m.tip.color.set(k.tip);
  }

  setFxEnabled(on: boolean): void { this.fxOn = on; this.applyAimColor(0); }

  setFx(i: number): void {
    this.fx = FXS[i] ?? FXS[0];
    this.applyAimColor(0);
  }

  private applyAimColor(now: number): void {
    const a = this.fxOn ? this.fx.aim : 0xffffff;
    const col = (this.sAim.mesh.material as THREE.MeshBasicMaterial).color;
    if (a === 'rainbow') col.setHSL((now / 2500) % 1, 0.9, 0.62); else col.set(a);
  }

  /** level 0.3..1.8 (độ sáng), tone -1 (lạnh)..1 (ấm) */
  setLamp(level: number, tone: number): void {
    this.lamp = { level, tone };
    const l = Math.max(0.3, Math.min(1.8, level));
    this.key.intensity = 2.6 * l;
    this.hemiL.intensity = 0.55 * (0.55 + 0.45 * l);
    this.renderer.toneMappingExposure = 0.92 * (0.8 + 0.2 * l);
    this.scene.environmentIntensity = 0.5 * (0.6 + 0.4 * l);
    const neutral = new THREE.Color(0xfff4e6);
    this.key.color.copy(neutral).lerp(new THREE.Color(tone >= 0 ? 0xffa95a : 0xaecaff), Math.abs(tone) * 0.8);
  }
  getLamp(): { level: number; tone: number } { return { ...this.lamp }; }

  private buildTrail(): void {
    const N = 360;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    pos.fill(-99);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mk = (draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      draw(c.getContext('2d')!); return new THREE.CanvasTexture(c);
    };
    const glow = mk((g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'); r.addColorStop(0.35, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
    const heart = mk((g) => { g.fillStyle = '#fff'; g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('\u2665', 32, 36); });
    const star = mk((g) => { g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 28, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.fill(); });
    const mat = new THREE.PointsMaterial({ size: 0.05, map: glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 4;
    this.scene.add(pts);
    this.trail = { pts, pos, col, base: new Float32Array(N * 3), life: new Float32Array(N), head: 0, lx: 0, ly: 0, hue: 0, mats: { glow, heart, star } };
  }

  private updateTrail(dt: number): void {
    const T = this.trail, n = T.life.length;
    const kind = this.fxOn ? this.fx.trail : 'none';
    const mat = T.pts.material as THREE.PointsMaterial;
    const want = kind === 'hearts' ? T.mats.heart : kind === 'stars' ? T.mats.star : T.mats.glow;
    if (mat.map !== want) { mat.map = want; mat.needsUpdate = true; }
    mat.size = kind === 'hearts' || kind === 'stars' ? 0.045 : 0.034;
    const c = this.balls[0];
    if (kind !== 'none' && this.play && !c.pocketed && c.mesh.visible && Math.hypot(c.x - T.lx, c.y - T.ly) > 0.014) {
      T.lx = c.x; T.ly = c.y;
      const cols = this.fx.colors;
      const color = new THREE.Color(kind === 'rainbow' ? new THREE.Color().setHSL((T.hue += 0.035) % 1, 0.95, 0.6) : cols[Math.floor(Math.random() * cols.length)]);
      const k = T.head; T.head = (k + 1) % n;
      const jit = kind === 'fire' || kind === 'stars' ? 0.012 : 0.004;
      T.pos[3 * k] = c.x - L / 2 + (Math.random() - 0.5) * jit;
      T.pos[3 * k + 1] = R * 0.9 + Math.random() * 0.01;
      T.pos[3 * k + 2] = c.y - W / 2 + (Math.random() - 0.5) * jit;
      T.base[3 * k] = color.r; T.base[3 * k + 1] = color.g; T.base[3 * k + 2] = color.b;
      T.life[k] = 1;
    }
    const rise = kind === 'fire' ? 0.16 : kind === 'hearts' || kind === 'stars' ? 0.08 : 0.01;
    for (let i = 0; i < n; i++) {
      if (T.life[i] <= 0) continue;
      T.life[i] -= dt / (kind === 'glow' || kind === 'rainbow' ? 0.9 : 0.7);
      const l = Math.max(0, T.life[i]);
      T.pos[3 * i + 1] += rise * dt;
      T.col[3 * i] = T.base[3 * i] * l; T.col[3 * i + 1] = T.base[3 * i + 1] * l; T.col[3 * i + 2] = T.base[3 * i + 2] * l;
      if (l <= 0) T.pos[3 * i + 1] = -99;
    }
    (T.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (T.pts.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  // ---------- điều khiển ----------
  setQuality(q: Quality): void {
    this.quality = q;
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : q === 'high' ? 2.5 : 2;
    this.baseDpr = Math.min(window.devicePixelRatio || 1, cap);
    this.dprScale = 1;
    this.goodWindows = 0;
    const high = q === 'high';
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.key.castShadow = high;
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); (this.key.shadow as { map: unknown }).map = null; }
    this.key.shadow.mapSize.set(2048, 2048);
    for (const b of this.balls) {
      b.mesh.material = high ? b.matPhys : b.matStd;
      b.mesh.castShadow = high;
      b.shadow.visible = !high && b.mesh.visible;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.applyDpr();
  }

  private applyDpr(): void {
    this.dprNow = this.baseDpr * this.dprScale;
    this.renderer.setPixelRatio(this.dprNow);
    this.resize();
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? document.body;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setCamMode(m: CamMode): void {
    if (m !== this.camMode) this.resetView();
    this.camMode = m;
    this.celebrate = false;
  }

  setViewSide(seat: number): void {
    this.viewSeatSide = seat % 2 === 0 ? 1 : -1;
  }

  /** Chừa chỗ cho thanh HUD: 0 = giữa màn hình, >0 = bàn dịch xuống một chút */
  setLookShift(v: number): void { this.lookShift = v; }

  /** Vuốt (2 ngón / chuột phải) để xoay & nghiêng góc nhìn; từ góc 'trên xuống' tự chuyển sang 3D */
  orbitView(dx: number, dy: number): void {
    if (this.camMode === 'top') this.camMode = 'persp';
    if (this.camMode === 'free') { this.rotateFree(dx, dy); return; }
    // sau cơ: camera luôn thẳng hướng ngắm (chỉ nghiêng lên/xuống), chỉ toàn cảnh mới xoay ngang
    if (this.camMode !== 'shoot' || this.overview) this.viewAz = Math.max(-1.3, Math.min(1.3, this.viewAz - dx * 0.006));
    this.viewEl = Math.max(-0.75, Math.min(0.55, this.viewEl + dy * 0.005));
  }

  zoomView(f: number): void {
    if (this.camMode === 'free') { this.zoomFree(f); return; }
    this.viewZoom = Math.min(1.5, Math.max(0.5, this.viewZoom * f));
  }

  /** Không phải lượt mình: nhìn toàn cảnh bàn (vẫn xoay được); đến lượt: chuyển mượt về sau cơ */
  setOverview(on: boolean): void {
    if (on === this.overview) return;
    const from = this.overview ? this.orbSlots.over : this.orbSlots.follow;
    from.az = this.viewAz; from.el = this.viewEl; from.z = this.viewZoom;
    const to = on ? this.orbSlots.over : this.orbSlots.follow;
    this.viewAz = on ? to.az : 0; this.viewEl = to.el; this.viewZoom = on ? to.z : 1;
    this.overview = on;
  }
  get isOverview(): boolean { return this.overview; }
  resetView(): void { this.viewAz = 0; this.viewEl = 0; this.viewZoom = 1; }

  rotateFree(dx: number, dy: number): void {
    this.freeAz -= dx * 0.006;
    this.freePol = Math.min(1.45, Math.max(0.12, this.freePol - dy * 0.006));
  }

  zoomFree(f: number): void {
    this.freeDist = Math.min(6, Math.max(1.2, this.freeDist * f));
  }

  playIntro(): void {
    this.introUntil = performance.now() + 3200;
    this.celebrate = false;
  }

  startCelebration(): void { this.celebrate = true; }
  stopCelebration(): void { this.celebrate = false; }

  /** Giao điểm tia từ camera qua điểm màn hình (ndc) với mặt phẳng bi: trả về toạ độ bàn */
  pickTable(ndcX: number, ndcY: number): { x: number; y: number } | null {
    this._ndc.set(ndcX, ndcY);
    this._ray.setFromCamera(this._ndc, this.camera);
    if (!this._ray.ray.intersectPlane(this._plane, this._v)) return null;
    return { x: this._v.x + L / 2, y: this._v.z + W / 2 };
  }

  project(x: number, y: number): { x: number; y: number } {
    this._v.set(x - L / 2, R, y - W / 2).project(this.camera);
    return { x: this._v.x, y: this._v.y };
  }

  // ---------- bi ----------
  private placeBall(b: BallView, x: number, y: number): void {
    b.x = x;
    b.y = y;
    b.mesh.position.set(x - L / 2, R, y - W / 2);
    b.shadow.position.x = x - L / 2;
    b.shadow.position.z = y - W / 2;
  }

  setBalls(states: BallState[]): void {
    for (const s of states) {
      const b = this.balls[s.id];
      if (!b) continue;
      b.pocketed = s.pocketed;
      b.sink = null;
      b.matStd.color.setScalar(1); b.matPhys.color.setScalar(1);
      b.mesh.visible = !s.pocketed;
      b.shadow.visible = !s.pocketed && this.quality !== 'high';
      b.matStd.color.setScalar(1);
      b.matPhys.color.setScalar(1);
      b.mesh.scale.setScalar(1);
      this.placeBall(b, s.x, s.y);
    }
  }

  ballPos(id: number): { x: number; y: number; pocketed: boolean } {
    const b = this.balls[id];
    return { x: b.x, y: b.y, pocketed: b.pocketed };
  }

  currentBalls(): BallState[] {
    return this.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed }));
  }

  moveCueBall(x: number, y: number): void {
    const b = this.balls[0];
    b.pocketed = false;
    b.sink = null;
    b.mesh.visible = true;
    b.shadow.visible = this.quality !== 'high';
    b.mesh.scale.setScalar(1);
    b.matStd.color.setScalar(1);
    b.matPhys.color.setScalar(1);
    this.placeBall(b, x, y);
  }

  setPlaceRing(visible: boolean, x?: number, y?: number, ok = true): void {
    this.placeRing.visible = visible;
    if (visible && x !== undefined && y !== undefined) {
      this.placeRing.position.set(x - L / 2, 0.012, y - W / 2);
      (this.placeRing.material as THREE.MeshBasicMaterial).color.set(ok ? 0x57ffb0 : 0xff5a5a);
    }
  }

  get playing(): boolean { return this.play !== null; }

  /** Bắt đầu phát lại cú đánh nhận từ máy chủ. `done` gọi khi mọi bi dừng. */
  playShot(msg: ShotResultMsg, done: () => void): void {
    if (this.play) this.finishPlay();
    // đồng bộ: bi chỉ lăn khi đầu cơ chạm bi (cú đánh của mình đã chạy hoạt ảnh sẵn)
    const T_HIT = 0.38;
    let delay = T_HIT * 1000;
    if (this.strokeActive && this.strokeLocal) delay = Math.max(0, T_HIT - this.strokeT) * 1000;
    this.play = { msg, t0: performance.now() + delay, evIdx: 0, done, sunk: new Set(), clock: 0, lastRt: -1 };
    this.shotCamUntil = performance.now() + delay + (msg.frameCount / FRAME_HZ) * 1000 + 500;
    this.aim.visible = false;
    this.otherAim = null;
    this.moveCueBall(msg.cueStart.x, msg.cueStart.y);
    this.freezeCamera = true;
    if (!(this.strokeActive && this.strokeLocal)) { this.startStroke(msg.shot.power, msg.shot.angle, { x: msg.shot.spinX ?? 0, y: msg.shot.spinY ?? 0 }); this.strokeLocal = false; }
  }
  private strokeLocal = false;
  private freezeCamera = false;

  private startStroke(power: number, angle: number, spin?: { x: number; y: number }): void {
    this.strokeT = 0;
    this.camAng = angle;
    this.strokeSpin = spin ? { ...spin } : { ...this.spin };
    this.strokePower = power;
    this.strokeAngle = angle;
    this.strokeActive = true;
  }

  /** Hoạt ảnh cú đánh cục bộ của chính mình (trước khi nhận kết quả) */
  localStroke(power: number, angle: number): void {
    this.startStroke(power, angle);
    this.freezeCamera = true;
    this.strokeT = 0.28; // cần đã được kéo sẵn: chỉ còn pha đẩy tới
    this.strokeLocal = true;
  }

  /** Mỗi ván một "độ mòn" khác nhau: nỉ sạch hoặc đầy phấn/xước, vị trí vết ngẫu nhiên; bi mới hoặc trầy */
  rerollWear(): void {
    const r = Math.random();
    const lv = r < 0.22 ? 0.12 + Math.random() * 0.15 : r < 0.6 ? 0.4 + Math.random() * 0.35 : 0.8 + Math.random() * 0.6;
    const old = this.wearMat.map;
    this.wearMat.map = feltWearTexture(this.aniso, lv);
    this.wearMat.needsUpdate = true;
    old?.dispose();
    for (const b of this.balls) {
      const t = ballRoughTexture(b.id, lv);
      b.matStd.roughnessMap?.dispose();
      b.matStd.roughnessMap = t; b.matPhys.roughnessMap = t;
      b.matStd.needsUpdate = true; b.matPhys.needsUpdate = true;
    }
  }

  /** hệ số tua nhanh hoạt ảnh bi (1 = bình thường) */
  playSpeed = 1;

  /** Bỏ qua hoạt ảnh: nhảy thẳng tới trạng thái cuối của cú đánh */
  skipPlay(): void {
    this.strokeActive = false;
    if (this.play) this.finishPlay();
  }

  private finishPlay(): void {
    if (!this.play) return;
    const { msg, done } = this.play;
    this.play = null;
    this.setBalls(msg.snapshot.balls);
    this.cinemaFocus = null;
    done();
  }

  // ---------- vòng lặp ----------
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    const loop = (ts: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(ts);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(ts: number): void {
    if (document.hidden) { this.lastTs = 0; return; }
    if (this.menuMode && ts - this.lastRender < 30) return;
    this.lastRender = ts;
    const ms = this.lastTs ? ts - this.lastTs : 16.7;
    this.lastTs = ts;
    const dt = Math.min(ms / 1000, 0.1);
    this.measure(ms);
    const now = performance.now();
    this.updatePlayback(now);
    this.updateStroke(dt);
    this.updateGuides(now);
    this.updateTrail(dt);
    this.updateCamera(dt, now);
    for (const f of this.floaters) {
      f.userData.float += dt;
      f.position.y += Math.sin(f.userData.float) * 0.002;
      f.rotation.y += dt * 0.3;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Đo FPS, đoán tần số quét và tự chỉnh độ phân giải (chế độ 'auto') */
  private measure(ms: number): void {
    if (ms > 250) return; // vừa quay lại từ nền
    this.fps = this.fps * 0.9 + (1000 / Math.max(ms, 1)) * 0.1;
    this.winN++;
    this.winSum += ms;
    if (ms < this.winMin) this.winMin = ms;
    if (this.winN < 90) return;
    const avg = this.winSum / this.winN;
    const hz = this.winMin <= 9.6 ? 120 : this.winMin <= 13.2 ? 90 : 60;
    this.refreshHz = hz;
    this.targetMs = 1000 / hz;
    const menu = this.menuMode;
    this.winN = 0; this.winSum = 0; this.winMin = 1e9;
    if (this.quality !== 'auto' || menu) return;
    if (this.cooldown > 0) { this.cooldown--; return; }
    if (avg > this.targetMs * 1.3 && this.dprScale > 0.55) {
      this.dprScale = Math.max(0.55, +(this.dprScale - 0.12).toFixed(2));
      this.goodWindows = 0;
      this.cooldown = 2;
      this.applyDpr();
    } else if (avg < this.targetMs * 1.12 && this.dprScale < 1) {
      if (++this.goodWindows >= 8) {
        this.dprScale = Math.min(1, +(this.dprScale + 0.08).toFixed(2));
        this.goodWindows = 0;
        this.cooldown = 4;
        this.applyDpr();
      }
    } else if (avg >= this.targetMs * 1.12) this.goodWindows = 0;
  }

  private updatePlayback(now: number): void {
    for (const b of this.balls) {
      if (b.sink) this.updateSink(b, now);
    }
    const dtp = Math.max(0.004, Math.min(0.1, (now - this.prevPlayNow) / 1000));
    this.prevPlayNow = now;
    const p = this.play;
    if (!p) return;
    const rt = (now - p.t0) / 1000;
    if (rt < 0) return;
    // đồng hồ hoạt ảnh ảo: hỗ trợ tua nhanh (playSpeed)
    p.clock += (p.lastRt < 0 ? 0 : rt - p.lastRt) * this.playSpeed;
    p.lastRt = rt;
    const t = p.clock;
    const f = t * FRAME_HZ;
    const k0 = Math.floor(f);
    const a = f - k0;
    const { msg } = p;
    while (p.evIdx < msg.events.length && msg.events[p.evIdx].t <= t) {
      this.onEvent(msg.events[p.evIdx], now);
      p.evIdx++;
    }
    for (let i = 0; i < 16; i++) {
      const b = this.balls[i];
      if (b.pocketed || b.sink) continue;
      const tr = msg.tracks[i];
      const n = tr.length / 2;
      const i0 = Math.min(k0, n - 1);
      const i1 = Math.min(k0 + 1, n - 1);
      const x0 = tr[2 * i0], y0 = tr[2 * i0 + 1], x1 = tr[2 * i1], y1 = tr[2 * i1 + 1];
      if (x0 < 0) {
        if (!p.sunk.has(i)) { p.sunk.add(i); this.sinkBall(b, now); }
        continue;
      }
      let x = x0 / 1000;
      let y = y0 / 1000;
      if (x1 >= 0) {
        // nội suy Hermite bậc 3 (quỹ đạo cong mượt như bi thật); tại điểm gãy (va chạm/băng) dùng đoạn thẳng để không bị vọt
        const im = Math.max(0, i0 - 1), ip = Math.min(n - 1, i1 + 1);
        const xm = tr[2 * im], ym = tr[2 * im + 1], xp = tr[2 * ip], yp = tr[2 * ip + 1];
        const sx = x1 - x0, sy = y1 - y0;
        const kink = (ux: number, uy: number, vx: number, vy: number): boolean => {
          const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
          if (lu < 1 && lv < 1) return false;
          if (lu < 1e-6 || lv < 1e-6) return true;
          const c = (ux * vx + uy * vy) / (lu * lv);
          const r = lu > lv ? lu / lv : lv / lu;
          return c < 0.93 || r > 1.6;
        };
        const k0b = xm < 0 || kink(x0 - xm, y0 - ym, sx, sy);
        const k1b = xp < 0 || kink(sx, sy, xp - x1, yp - y1);
        const m0x = k0b ? sx : (x1 - xm) / 2, m0y = k0b ? sy : (y1 - ym) / 2;
        const m1x = k1b ? sx : (xp - x0) / 2, m1y = k1b ? sy : (yp - y0) / 2;
        const a2 = a * a, a3 = a2 * a;
        const h00 = 2 * a3 - 3 * a2 + 1, h10 = a3 - 2 * a2 + a, h01 = -2 * a3 + 3 * a2, h11 = a3 - a2;
        x = (h00 * x0 + h10 * m0x + h01 * x1 + h11 * m1x) / 1000;
        y = (h00 * y0 + h10 * m0y + h01 * y1 + h11 * m1y) / 1000;
      }
      const dx = x - b.x;
      const dy = y - b.y;
      b.lvx = dx / dtp; b.lvz = dy / dtp;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6 && dist < 0.5) {
        this._v.set(dy, 0, -dx).normalize();
        this._q.setFromAxisAngle(this._v, dist / R);
        b.mesh.quaternion.premultiply(this._q);
      }
      this.placeBall(b, x, y);
    }
    if (k0 >= msg.frameCount - 1 && p.evIdx >= msg.events.length) this.finishPlay();
  }

  private prevPlayNow = 0;

  /** Bi lọt lỗ: lăn nốt vào miệng lỗ rồi RƠI TỰ DO trong giếng (trọng lực), không xuyên qua nỉ/băng */
  private sinkBall(b: BallView, now: number, pocket?: number): void {
    let best = pocket ?? 0;
    if (pocket === undefined) {
      let bd = Infinity;
      for (let i = 0; i < POCKETS.length; i++) {
        const d = Math.hypot(POCKETS[i].x - b.x, POCKETS[i].y - b.y);
        if (d < bd) { bd = d; best = i; }
      }
    }
    const sp = Math.hypot(b.lvx, b.lvz);
    const cap = sp > 3 ? 3 / sp : 1;
    b.sink = { last: now, hole: best, x: b.mesh.position.x, z: b.mesh.position.z, y: b.mesh.position.y, vx: b.lvx * cap, vz: b.lvz * cap, vy: 0, falling: false };
    b.pocketed = true;
  }

  private updateSink(b: BallView, now: number): void {
    const S = b.sink!;
    const dt = Math.min(0.04, Math.max(0.001, (now - S.last) / 1000));
    S.last = now;
    const h = HOLES[S.hole];
    const allowed = Math.max(0.02, h.r - R - 0.002); // bi nằm trọn trong miệng lỗ
    const ox = S.x, oz = S.z;
    let dx = S.x - h.x, dz = S.z - h.z;
    let d = Math.hypot(dx, dz);
    if (!S.falling) {
      // còn trên mép: lăn thẳng vào miệng lỗ (giữ độ cao bi) rồi mới rơi
      const step = Math.max(1.2, Math.hypot(S.vx, S.vz)) * dt;
      const nd = Math.max(allowed, d - step);
      const k = d > 1e-6 ? nd / d : 0;
      S.x = h.x + dx * k; S.z = h.z + dz * k;
      if (nd <= allowed + 1e-5) {
        S.falling = true;
        // vận tốc ngang còn lại hướng vào trong giếng, giảm do va thành lỗ
        S.vx *= 0.5; S.vz *= 0.5;
      }
    } else {
      S.vy -= 9.81 * dt;
      S.y += S.vy * dt;
      S.x += S.vx * dt; S.z += S.vz * dt;
      const damp = Math.max(0, 1 - 2.5 * dt);
      S.vx *= damp; S.vz *= damp;
      dx = S.x - h.x; dz = S.z - h.z; d = Math.hypot(dx, dz);
      if (d > allowed) {
        const nx = dx / d, nz = dz / d;
        S.x = h.x + nx * allowed; S.z = h.z + nz * allowed;
        const vn = S.vx * nx + S.vz * nz;
        if (vn > 0) { S.vx -= 1.4 * vn * nx; S.vz -= 1.4 * vn * nz; }
      }
    }
    b.mesh.position.set(S.x, S.y, S.z);
    const mv = Math.hypot(S.x - ox, S.z - oz);
    if (mv > 1e-6) {
      this._v.set(S.z - oz, 0, -(S.x - ox)).normalize();
      this._q.setFromAxisAngle(this._v, mv / R);
      b.mesh.quaternion.premultiply(this._q);
    }
    b.shadow.visible = S.falling ? false : b.shadow.visible;
    const depth = Math.max(0, R - S.y);
    const dark = Math.max(0.05, 1 - depth / 0.14);
    b.matStd.color.setScalar(dark);
    b.matPhys.color.setScalar(dark);
    if (S.y < -0.15) {
      b.mesh.visible = false; b.sink = null; b.shadow.visible = false;
      b.matStd.color.setScalar(1); b.matPhys.color.setScalar(1);
    }
  }

  private onEvent(e: TableEvent, now: number): void {
    if (e.k === 'pocket') {
      const pk = HOLES[e.pocket];
      this.cinemaFocus = new THREE.Vector3(pk.x, 0.05, pk.z);
      this.cinemaFocusUntil = now + 1100;
      const b = this.balls[e.ball];
      if (!b.sink && !b.pocketed) this.sinkBall(b, now, e.pocket);
    }
    if (!this.onEventSound) return;
    if (e.k === 'cue') { if (this.breakShot) audio.breakShot(); else audio.cue(Math.min(1, e.speed / 8.5)); }
    else if (e.k === 'ball') audio.ballHit(e.speed);
    else if (e.k === 'cushion') { if (e.speed > 0.05) audio.cushion(e.speed); }
    else if (e.k === 'pocket') audio.pocket();
  }

  private updateStroke(dt: number): void {
    const c = this.balls[0];
    const show = (this.aim.visible || this.strokeActive || this.otherAim !== null) && !c.pocketed && c.mesh.visible;
    this.cueGroup.visible = show;
    this.cueShadow.visible = show;
    if (!show) return;
    let angle = this.aim.angle;
    let pull = this.aim.power;
    if (this.strokeActive) {
      this.strokeT += dt;
      angle = this.strokeAngle;
      const T1 = 0.28;
      const T2 = 0.1;
      if (this.strokeT < T1) pull = this.strokePower * (this.strokeT / T1);
      else if (this.strokeT < T1 + T2) pull = this.strokePower * (1 - (this.strokeT - T1) / T2) - 0.05;
      else { this.strokeActive = false; this.cueGroup.visible = this.aim.visible; return; }
    } else if (!this.aim.visible && this.otherAim) {
      angle = this.otherAim.angle;
      pull = this.otherAim.power;
    }
    // đầu cơ trỏ đúng điểm chạm đã chọn trên bi cái (lệch trái/phải, trên/dưới)
    const sp = this.strokeActive ? this.strokeSpin : this.aim.visible ? this.spin : { x: 0, y: 0 };
    const dl = sp.x * 0.6 * R;
    const dh = sp.y * 0.6 * R;
    const depth = Math.sqrt(Math.max(1e-6, R * R - dl * dl - dh * dh));
    const gap = depth + 0.006 + Math.max(-0.05, pull) * 0.24;
    const cx = c.x - L / 2;
    const cz = c.y - W / 2;
    this.cueGroup.position.set(cx - Math.cos(angle) * gap - Math.sin(angle) * dl, R + dh + 0.002, cz - Math.sin(angle) * gap + Math.cos(angle) * dl);
    this.cueGroup.rotation.set(0, -angle, 0);
    this.cueGroup.rotateZ(-0.03);
    this.cueShadow.position.set(this.cueGroup.position.x + 0.03, 0.0022, this.cueGroup.position.z + 0.035);
    this.cueShadow.rotation.set(0, -angle, 0);
  }

  private updateGuides(now: number): void {
    const show = this.aim.visible && this.aim.guide && !this.play && !this.strokeActive;
    if (!show) {
      this.sAim.hide(); this.sObj.hide(); this.sCue.hide(); this.sRefl.hide();
      this.ghostBall.visible = false;
      return;
    }
    const c = this.balls[0];
    const dx = Math.cos(this.aim.angle);
    const dy = Math.sin(this.aim.angle);
    let bestT = Infinity;
    let hit: BallView | null = null;
    for (const b of this.balls) {
      if (b.id === 0 || b.pocketed || !b.mesh.visible) continue;
      const fx = b.x - c.x;
      const fy = b.y - c.y;
      const proj = fx * dx + fy * dy;
      if (proj <= 0) continue;
      const perp2 = fx * fx + fy * fy - proj * proj;
      const r2 = 4 * R * R;
      if (perp2 >= r2) continue;
      const t = proj - Math.sqrt(r2 - perp2);
      if (t < bestT) { bestT = t; hit = b; }
    }
    let tw = Infinity;
    let wallX = false;
    if (dx > 1e-6) { const t = (L - R - c.x) / dx; if (t < tw) { tw = t; wallX = true; } }
    if (dx < -1e-6) { const t = (R - c.x) / dx; if (t < tw) { tw = t; wallX = true; } }
    if (dy > 1e-6) { const t = (W - R - c.y) / dy; if (t < tw) { tw = t; wallX = false; } }
    if (dy < -1e-6) { const t = (R - c.y) / dy; if (t < tw) { tw = t; wallX = false; } }
    const tEnd = Math.min(bestT, tw);
    const gx = c.x + dx * tEnd;
    const gy = c.y + dy * tEnd;
    const ox = -L / 2;
    const oz = -W / 2;
    const scroll = (now / 1000) * 0.9;
    if (this.fxOn && this.fx.aim === 'rainbow') this.applyAimColor(now);
    this.sAim.set(c.x + ox, c.y + oz, gx + ox, gy + oz, 0.004, scroll);
    this.ghostBall.visible = true;
    this.ghostBall.position.set(gx + ox, R, gy + oz);
    if (hit && bestT <= tw) {
      const nx = hit.x - gx;
      const ny = hit.y - gy;
      const nl = Math.hypot(nx, ny) || 1;
      const ux = nx / nl, uy = ny / nl;
      this.sObj.set(hit.x + ox, hit.y + oz, hit.x + ux * 0.4 + ox, hit.y + uy * 0.4 + oz, 0.0045);
      // hướng bi cái sau va chạm (thành phần tiếp tuyến)
      const dot = dx * ux + dy * uy;
      const tx = dx - dot * ux, ty = dy - dot * uy;
      const tl = Math.hypot(tx, ty);
      if (tl > 0.08) this.sCue.set(gx + ox, gy + oz, gx + (tx / tl) * 0.2 * tl + ox, gy + (ty / tl) * 0.2 * tl + oz, 0.0045);
      else this.sCue.hide();
      this.sRefl.hide();
    } else {
      this.sObj.hide();
      this.sCue.hide();
      const rx = wallX ? -dx : dx;
      const ry = wallX ? dy : -dy;
      this.sRefl.set(gx + ox, gy + oz, gx + rx * 0.45 + ox, gy + ry * 0.45 + oz, 0.0042, scroll);
    }
  }

  private setOrbitGoal(pos: THREE.Vector3, look: THREE.Vector3, th: number, aspect: number, az = this.viewAz, ev = this.viewEl, zm = this.viewZoom): void {
    const need = Math.max((W + 1.0) / 2 / th, (L + 0.5) / 2 / (th * aspect));
    const d = Math.max(1.9, need * 0.9 * zm) * 0.95;
    const el = Math.min(1.5, Math.max(0.2, 0.86 + ev));
    const side = this.viewSeatSide;
    look.set(0, -0.05, -0.05 * side);
    pos.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, side * Math.cos(az) * Math.cos(el) * d);
  }

  private updateCamera(dt: number, now: number): void {
    const goalPos = this._gp;
    const goalLook = this._gl;
    const aspect = this.camera.aspect;
    let mode = this.camMode;
    const c = this.balls[0];
    const inIntro = now < this.introUntil;
    const shooting = this.play !== null || now < this.shotCamUntil || this.strokeActive;
    const cx = c.x - L / 2;
    const cz = c.y - W / 2;

    if (this.celebrate) {
      const a = now / 4000;
      goalPos.set(Math.cos(a) * 2.6, 1.5, Math.sin(a) * 2.6);
      goalLook.set(0, 0, 0);
    } else if (inIntro) {
      const k = 1 - (this.introUntil - now) / 3200;
      const a = Math.PI * 0.5 + (1 - k) * 2.2;
      const d = 4.6 - k * 1.3;
      goalPos.set(Math.cos(a) * d, 2.3 - k * 0.5, Math.sin(a) * d);
      goalLook.set(0, 0, 0);
    } else {
      if (mode === 'cinema') {
        if (shooting) {
          const useF = this.cinemaFocus && now < this.cinemaFocusUntil;
          const fx = useF ? this.cinemaFocus!.x : cx;
          const fz = useF ? this.cinemaFocus!.z : cz;
          const back = useF ? 0.7 : 0.9;
          goalLook.set(fx, useF ? 0.05 : R, fz);
          const len = Math.hypot(fx, fz) || 1;
          const ux = len < 1e-6 ? 0 : -fx / len;
          const uz = len < 1e-6 ? 1 : -fz / len;
          goalPos.set(fx - ux * back, 0.55, fz - uz * back);
        } else mode = 'persp';
      }
      const vFov = (this.camera.fov * Math.PI) / 180;
      const th = Math.tan(vFov / 2);
      if (mode === 'top') {
        const needH = (W + 0.6) / 2 / th;
        const needW = (L + 0.55) / 2 / (th * aspect);
        goalPos.set(0, Math.max(needH, needW) * this.viewZoom, 0.001);
        goalLook.set(0, 0, 0);
      } else if (mode === 'persp') {
        this.setOrbitGoal(goalPos, goalLook, th, aspect);
      } else if (mode === 'shoot') {
        this.freezeCamera = false;
        // 1) tư thế toàn cảnh
        { const o = this.overview ? { az: this.viewAz, el: this.viewEl, z: this.viewZoom } : this.orbSlots.over; this.setOrbitGoal(this._gp2, this._gl2, th, aspect, o.az, o.el, o.z * Math.sqrt(this.camDist)); }
        // 2) tư thế sau cơ
        const ang = this.aim.visible ? this.aim.angle : this.otherAim ? this.otherAim.angle : this.strokeActive ? this.strokeAngle : this.camAng;
        this.camAng = ang;
        // tiêu điểm = bi cái (mượt khi bi lăn), hướng = hướng ngắm (bám sát để bi luôn ở giữa màn hình)
        const F = this.focus;
        if (!F.init) { F.x = cx; F.z = cz; F.yaw = ang; F.init = true; }
        const fk = 1 - Math.exp(-dt * (shooting ? 5 : 22));
        F.x += (cx - F.x) * fk; F.z += (cz - F.z) * fk;
        let dy = ang - F.yaw;
        while (dy > Math.PI) dy -= 2 * Math.PI;
        while (dy < -Math.PI) dy += 2 * Math.PI;
        F.yaw += dy * (1 - Math.exp(-dt * 24));
        const yaw = F.yaw + (this.overview ? 0 : this.viewAz);
        const e = Math.min(1.35, Math.max(0.06, 0.2 + (this.overview ? 0 : this.viewEl)));
        const dist = 0.8 * this.camDist * (this.overview ? 1 : this.viewZoom);
        goalPos.set(F.x - Math.cos(yaw) * Math.cos(e) * dist, R + Math.sin(e) * dist + 0.02, F.z - Math.sin(yaw) * Math.cos(e) * dist);
        const f = this.overview ? 1 : Math.max(0, Math.cos(this.viewAz));
        goalLook.set(F.x + Math.cos(F.yaw) * 0.9 * f, 0.0, F.z + Math.sin(F.yaw) * 0.9 * f);
        // 3) pha trộn mượt (smootherstep, ~1,4 giây)
        const target = this.overview ? 0 : 1;
        const step = dt / 1.4;
        this.blend += Math.max(-step, Math.min(step, target - this.blend));
        const t = this.blend;
        const sm = t * t * t * (t * (t * 6 - 15) + 10);
        goalPos.lerpVectors(this._gp2, goalPos, sm);
        goalLook.lerpVectors(this._gl2, goalLook, sm);
      } else if (mode === 'free') {
        const sp = Math.sin(this.freePol);
        goalPos.set(Math.cos(this.freeAz) * this.freeDist * sp, Math.cos(this.freePol) * this.freeDist, Math.sin(this.freeAz) * this.freeDist * sp);
        goalLook.set(0, 0, 0);
      }
    }
    // giữ minimap: nhìn từ trên xuống toàn bàn để quan sát chiến thuật, thả tay thì về góc cũ
    this.peekT += Math.max(-dt / 0.45, Math.min(dt / 0.45, (this.peek ? 1 : 0) - this.peekT));
    if (this.peekT > 0.001 && !this.celebrate && !inIntro && mode !== 'top') {
      const vf = (this.camera.fov * Math.PI) / 180;
      const th2 = Math.tan(vf / 2);
      const h = Math.max((W + 0.6) / 2 / th2, (L + 0.55) / 2 / (th2 * aspect));
      const t = this.peekT;
      const sm = t * t * t * (t * (t * 6 - 15) + 10);
      this._gp2.set(0, h, 0.001);
      this._gl2.set(0, 0, 0);
      goalPos.lerp(this._gp2, sm);
      goalLook.lerp(this._gl2, sm);
    }
    const k = 1 - Math.exp(-dt * (mode === 'free' && !inIntro ? 14 : mode === 'shoot' && !inIntro ? (this.blend > 0.999 ? 60 : 9) : 4.5));
    this.camPos.lerp(goalPos, k);
    this.camLook.lerp(goalLook, k);
    {
      const cl = this.envGroups[this.envId]?.userData.ceiling as THREE.Object3D[] | undefined;
      if (cl) { const vis = this.camPos.y < 1.9; for (const o of cl) o.visible = vis; }
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (this.lookShift !== 0 && (this.camMode === 'top' || this.camMode === 'persp')) {
      // dịch ảnh bằng view offset: nhẹ, không đổi hướng nhìn
      const h = this.renderer.domElement.clientHeight || 1;
      const w = this.renderer.domElement.clientWidth || 1;
      this.camera.setViewOffset(w, h, 0, -this.lookShift * h * 0.5, w, h);
    } else if (this.camera.view?.enabled) this.camera.clearViewOffset();
  }

  /** Dùng khi kiểm thử/ảnh chụp: đặt ngay camera không cần làm mượt */
  snapCamera(): void {
    this.introUntil = 0;
    for (let i = 0; i < 80; i++) this.updateCamera(0.1, performance.now());
  }

  /** Số liệu cho trình kiểm thử */
  stats(): { calls: number; triangles: number; dpr: number; fps: number; hz: number } {
    const i = this.renderer.info.render;
    return { calls: i.calls, triangles: i.triangles, dpr: this.dprNow, fps: Math.round(this.fps), hz: this.refreshHz };
  }
}
