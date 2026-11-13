import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FRAME_HZ, POCKETS, TABLE, type BallState, type ShotResultMsg, type TableEvent } from '@shared/protocol';
import { audio } from './audio';

const { L, W, R } = TABLE;

export type CamMode = 'top' | 'persp' | 'shoot' | 'free' | 'cinema';
export type Quality = 'low' | 'medium' | 'high';

export const BALL_COLORS: Record<number, string> = {
  0: '#f6f3ea', 1: '#f5c518', 2: '#1e56d6', 3: '#e0312b', 4: '#7a3cc4', 5: '#f08a1c', 6: '#13995a', 7: '#8c2a2a', 8: '#16161a',
};
export const ballColor = (id: number) => BALL_COLORS[id <= 8 ? id : id - 8];

const toW = (x: number, y: number, h: number = R) => new THREE.Vector3(x - L / 2, h, y - W / 2);

function ballTexture(id: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const col = ballColor(id);
  const stripe = id >= 9;
  g.fillStyle = id === 0 ? '#f6f3ea' : stripe ? '#f6f3ea' : col;
  g.fillRect(0, 0, 512, 256);
  if (stripe) {
    g.fillStyle = col;
    g.fillRect(0, 56, 512, 144);
  }
  if (id > 0) {
    for (const cx of [128, 384]) {
      g.fillStyle = '#fbfaf5';
      g.beginPath();
      g.arc(cx, 128, 38, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.font = 'bold 46px Arial, sans-serif';
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
  t.anisotropy = 4;
  return t;
}

function feltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#17894f';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface BallView {
  id: number;
  mesh: THREE.Mesh;
  shadowBlob?: THREE.Mesh;
  x: number;
  y: number;
  pocketed: boolean;
  sink: { t0: number; from: THREE.Vector3; to: THREE.Vector3 } | null;
}

export interface AimState {
  angle: number;
  power: number;
  visible: boolean;
  /** tâm bi cái trên bàn */
  guide: boolean;
}

export class BilliardScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private balls: BallView[] = [];
  private cueGroup = new THREE.Group();
  private cueStick!: THREE.Mesh;
  private aimLine: THREE.Line;
  private ghostBall: THREE.Mesh;
  private objLine: THREE.Line;
  private placeRing: THREE.Mesh;
  private ghostAim: THREE.Group;
  private key: THREE.DirectionalLight;
  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;

  quality: Quality = 'medium';
  camMode: CamMode = 'persp';
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
  private viewSeatSide = 1; // +1: nhìn từ cạnh dưới (z+), -1: cạnh trên

  /** Trạng thái ngắm của chính mình và của người khác */
  aim: AimState = { angle: 0, power: 0.5, visible: false, guide: true };
  otherAim: { angle: number; power: number; seat: number } | null = null;
  private strokeT = 0;
  private strokePower = 0;
  private strokeActive = false;

  // phát lại cú đánh
  private play: null | { msg: ShotResultMsg; t0: number; evIdx: number; done: () => void; sunk: Set<number> } = null;
  onEventSound = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);

    this.scene.background = new THREE.Color(0x120c22);
    this.scene.fog = new THREE.Fog(0x120c22, 9, 22);

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;

    this.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a1a3a, 0.4));
    this.key = new THREE.DirectionalLight(0xfff1dc, 1.7);
    this.key.position.set(0.6, 4, 0.9);
    this.key.target.position.set(0, 0, 0);
    this.key.castShadow = true;
    this.key.shadow.camera.left = -2;
    this.key.shadow.camera.right = 2;
    this.key.shadow.camera.top = 1.4;
    this.key.shadow.camera.bottom = -1.4;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 8;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.01;
    this.scene.add(this.key, this.key.target);
    const rim = new THREE.PointLight(0x9a7bff, 6, 12, 2);
    rim.position.set(-3, 2.5, -2.5);
    this.scene.add(rim);
    const rim2 = new THREE.PointLight(0xff7ab8, 5, 12, 2);
    rim2.position.set(3, 2, 2.5);
    this.scene.add(rim2);

    this.buildRoom();
    this.buildTable();
    this.buildBalls();
    this.buildCue();

    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), lineMat);
    this.objLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9 }));
    this.ghostBall = new THREE.Mesh(
      new THREE.SphereGeometry(R, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.placeRing = new THREE.Mesh(new THREE.RingGeometry(R * 1.2, R * 1.6, 40), new THREE.MeshBasicMaterial({ color: 0x57ffb0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.placeRing.rotation.x = -Math.PI / 2;
    this.placeRing.visible = false;
    this.ghostAim = new THREE.Group();
    this.ghostAim.visible = false;
    this.scene.add(this.aimLine, this.objLine, this.ghostBall, this.placeRing, this.ghostAim);
    this.setQuality(this.quality);
  }

  // ---------- dựng cảnh ----------
  private buildRoom(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({ color: 0x2b1b47, roughness: 0.9, metalness: 0.0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.78;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // vòng sáng neon dưới sàn
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.24, 96), new THREE.MeshBasicMaterial({ color: 0xff5fa8, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.77;
    this.scene.add(ring);
    // đèn treo
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.34), new THREE.MeshBasicMaterial({ color: 0xfff6dd }));
    lamp.position.set(0, 2.6, 0);
    const lampCase = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.44), new THREE.MeshStandardMaterial({ color: 0x15101f, roughness: 0.5 }));
    lampCase.position.set(0, 2.68, 0);
    this.scene.add(lamp, lampCase);
    // các quả cầu trang trí nhỏ vui nhộn lơ lửng
    const colors = [0xff5fa8, 0x57d6ff, 0xffd34d, 0x8f6bff];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 + Math.random() * 0.12, 1), new THREE.MeshStandardMaterial({ color: colors[i % 4], roughness: 0.4, emissive: colors[i % 4], emissiveIntensity: 0.25 }));
      const a = (i / 10) * Math.PI * 2;
      m.position.set(Math.cos(a) * 5.5, -0.3 + Math.random() * 2.5, Math.sin(a) * 5.5);
      m.userData.float = Math.random() * 6;
      this.scene.add(m);
      this.floaters.push(m);
    }
  }
  private floaters: THREE.Mesh[] = [];

  private buildTable(): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a2f1b, roughness: 0.45, metalness: 0.05 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x3b1d10, roughness: 0.55 });
    const felt = new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95, metalness: 0 });
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0x1c9a5e, roughness: 0.85 });
    const t = new THREE.Group();

    // Mặt nỉ
    const top = new THREE.Mesh(new THREE.PlaneGeometry(L, W), felt);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    t.add(top);
    const slate = new THREE.Mesh(new THREE.BoxGeometry(L + 0.3, 0.1, W + 0.3), woodDark);
    slate.position.y = -0.06;
    slate.receiveShadow = true;
    t.add(slate);

    // Khung gỗ: 4 thanh bao quanh
    const M = 0.17; // bề rộng khung
    const H = 0.07;
    const railY = H / 2 - 0.003;
    const rails: Array<[number, number, number, number]> = [
      [0, -(W / 2 + M / 2), L + 2 * M, M],
      [0, W / 2 + M / 2, L + 2 * M, M],
      [-(L / 2 + M / 2), 0, M, W],
      [L / 2 + M / 2, 0, M, W],
    ];
    for (const [x, z, w, d] of rails) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wood);
      m.position.set(x, railY, z);
      m.castShadow = m.receiveShadow = true;
      t.add(m);
    }

    // Đệm băng (hình thang) - mỗi cạnh bị ngắt bởi lỗ
    const cushion = (x0: number, x1: number, side: 'top' | 'bottom' | 'left' | 'right') => {
      const d = 0.055;
      const s = 0.04;
      const shape = new THREE.Shape();
      // trong hệ (u,v): u dọc theo băng, v hướng ra ngoài bàn từ mặt băng
      shape.moveTo(x0, 0);
      shape.lineTo(x1, 0);
      shape.lineTo(x1 + s, d);
      shape.lineTo(x0 - s, d);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false });
      const m = new THREE.Mesh(geo, cushionMat);
      m.castShadow = true;
      // geo nằm trong mặt phẳng XY (u,v) và đùn theo +Z => xoay sao cho v -> hướng ra ngoài, extrude -> lên (y)
      m.rotation.x = -Math.PI / 2; // (u,v,e) -> (u, e, -v)  : v hướng về -z, e hướng +y
      if (side === 'top') { m.position.set(-L / 2, 0, -W / 2); }
      if (side === 'bottom') { m.rotation.z = Math.PI; m.position.set(L / 2, 0, W / 2); }
      if (side === 'left') { m.rotation.z = Math.PI / 2; m.position.set(-L / 2, 0, W / 2); }
      if (side === 'right') { m.rotation.z = -Math.PI / 2; m.position.set(L / 2, 0, -W / 2); }
      return m;
    };
    const gapC = 0.1;
    const gapS = 0.085;
    t.add(cushion(gapC, L / 2 - gapS, 'top'), cushion(L / 2 + gapS, L - gapC, 'top'));
    t.add(cushion(gapC, L / 2 - gapS, 'bottom'), cushion(L / 2 + gapS, L - gapC, 'bottom'));
    t.add(cushion(gapC, W - gapC, 'left'), cushion(gapC, W - gapC, 'right'));

    // Lỗ bida
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8a84a, metalness: 0.9, roughness: 0.25 });
    POCKETS.forEach((p) => {
      const c = toW(p.x, p.y, 0.002);
      const r = p.r * 0.95;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 32), holeMat);
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(c.x, 0.0085, c.z);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r, 32), holeMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(c.x, H + 0.001, c.z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 32), brass);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(c.x, H + 0.003, c.z);
      t.add(hole, cap, ring);
    });

    // Điểm ngắm (diamonds) trên khung
    const dia = new THREE.MeshStandardMaterial({ color: 0xf6e7b4, roughness: 0.3, metalness: 0.4 });
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      const x = -L / 2 + (L / 8) * i;
      for (const z of [-(W / 2 + M / 2), W / 2 + M / 2]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.004, 6), dia);
        m.position.set(x, H + 0.001, z);
        t.add(m);
      }
    }
    for (let i = 1; i < 4; i++) {
      const z = -W / 2 + (W / 4) * i;
      if (i === 2) continue;
      for (const x of [-(L / 2 + M / 2), L / 2 + M / 2]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.004, 6), dia);
        m.position.set(x, H + 0.001, z);
        t.add(m);
      }
    }
    // Chấm đầu bàn / cuối bàn
    for (const px of [L * 0.25, L * 0.75]) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(px - L / 2, 0.001, 0);
      t.add(m);
    }
    // Chân bàn
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.72, 16), woodDark);
        leg.position.set(sx * (L / 2 - 0.05), -0.42, sz * (W / 2 - 0.0));
        leg.castShadow = true;
        t.add(leg);
      }
    }
    const apron = new THREE.Mesh(new THREE.BoxGeometry(L + 0.34, 0.14, W + 0.34), wood);
    apron.position.y = -0.14;
    apron.castShadow = true;
    t.add(apron);
    this.scene.add(t);
  }

  private buildBalls(): void {
    const geo = new THREE.SphereGeometry(R, 40, 28);
    for (let id = 0; id < 16; id++) {
      const mat = new THREE.MeshPhysicalMaterial({ map: ballTexture(id), roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.balls.push({ id, mesh, x: 0, y: 0, pocketed: true, sink: null });
    }
  }

  private buildCue(): void {
    const len = 1.45;
    const geo = new THREE.CylinderGeometry(0.0065, 0.0155, len, 16);
    geo.rotateZ(-Math.PI / 2); // đầu nhỏ (radiusTop) hướng về +x (đầu cơ), đầu to ở phía sau (-x)
    geo.translate(-len / 2, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe9c98a, roughness: 0.4 });
    this.cueStick = new THREE.Mesh(geo, mat);
    this.cueStick.castShadow = true;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0068, 0.0068, 0.012, 12).rotateZ(Math.PI / 2).translate(0.003, 0, 0), new THREE.MeshStandardMaterial({ color: 0x3aa0ff, roughness: 0.8 }));
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0158, 0.0158, 0.5, 16).rotateZ(Math.PI / 2).translate(-len + 0.25, 0, 0), new THREE.MeshStandardMaterial({ color: 0x2a1722, roughness: 0.5 }));
    this.cueGroup.add(this.cueStick, tip, butt);
    this.cueGroup.visible = false;
    this.scene.add(this.cueGroup);
  }

  // ---------- điều khiển ----------
  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? 1 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const size = q === 'high' ? 2048 : 1024;
    this.key.castShadow = q !== 'low';
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); (this.key.shadow as { map: unknown }).map = null; }
    this.key.shadow.mapSize.set(size, size);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
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
    this.camMode = m;
    this.celebrate = false;
  }

  setViewSide(seat: number): void {
    this.viewSeatSide = seat % 2 === 0 ? 1 : -1;
  }

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

  startCelebration(): void {
    this.celebrate = true;
  }

  stopCelebration(): void {
    this.celebrate = false;
  }

  /** Giao điểm tia từ camera qua điểm màn hình (ndc) với mặt phẳng bi: trả về toạ độ bàn */
  pickTable(ndcX: number, ndcY: number): { x: number; y: number } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, p)) return null;
    return { x: p.x + L / 2, y: p.z + W / 2 };
  }

  project(x: number, y: number): { x: number; y: number } {
    const v = toW(x, y).project(this.camera);
    return { x: v.x, y: v.y };
  }

  // ---------- bi ----------
  setBalls(states: BallState[]): void {
    for (const s of states) {
      const b = this.balls[s.id];
      if (!b) continue;
      b.x = s.x;
      b.y = s.y;
      b.pocketed = s.pocketed;
      b.sink = null;
      b.mesh.visible = !s.pocketed;
      b.mesh.position.copy(toW(s.x, s.y));
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
    b.x = x;
    b.y = y;
    b.pocketed = false;
    b.mesh.visible = true;
    b.mesh.position.copy(toW(x, y));
  }

  setPlaceRing(visible: boolean, x?: number, y?: number, ok = true): void {
    this.placeRing.visible = visible;
    if (visible && x !== undefined && y !== undefined) {
      const p = toW(x, y, 0.012);
      this.placeRing.position.copy(p);
      (this.placeRing.material as THREE.MeshBasicMaterial).color.set(ok ? 0x57ffb0 : 0xff5a5a);
    }
  }

  get playing(): boolean {
    return this.play !== null;
  }

  /** Bắt đầu phát lại cú đánh nhận từ máy chủ. `done` gọi khi mọi bi dừng. */
  playShot(msg: ShotResultMsg, done: () => void): void {
    if (this.play) this.finishPlay();
    this.play = { msg, t0: performance.now(), evIdx: 0, done, sunk: new Set() };
    this.strokeActive = false;
    this.shotCamUntil = performance.now() + (msg.frameCount / FRAME_HZ) * 1000 + 500;
    this.aim.visible = false;
    this.otherAim = null;
    // đặt bi cái đúng chỗ xuất phát
    this.moveCueBall(msg.cueStart.x, msg.cueStart.y);
    // bắt đầu cú gậy: hoạt ảnh nhanh kéo-đẩy
    this.startStroke(msg.shot.power, msg.shot.angle);
  }

  private strokeAngle = 0;
  private startStroke(power: number, angle: number): void {
    this.strokeT = 0;
    this.strokePower = power;
    this.strokeAngle = angle;
    this.strokeActive = true;
  }

  /** Hoạt ảnh cú đánh cục bộ của chính mình (trước khi nhận kết quả) */
  localStroke(power: number, angle: number): void {
    this.startStroke(power, angle);
  }

  private finishPlay(): void {
    if (!this.play) return;
    const { msg, done } = this.play;
    this.play = null;
    this.setBalls(msg.snapshot.balls);
    this.cinemaFocus = null;
    done();
  }

  private sample(track: number[], k: number): [number, number] {
    const n = track.length / 2;
    const i = Math.min(k, n - 1);
    return [track[2 * i], track[2 * i + 1]];
  }

  // ---------- vòng lặp ----------
  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(this.clock.getDelta());
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Ở menu: hạn chế ~20 FPS để tiết kiệm pin; tạm dừng khi ẩn ứng dụng */
  menuMode = false;
  private lastRender = 0;

  private frame(dt: number): void {
    if (document.hidden) return;
    if (this.menuMode && performance.now() - this.lastRender < 48) return;
    this.lastRender = performance.now();
    dt = Math.min(dt, 0.25);
    const now = performance.now();
    this.updatePlayback(now, dt);
    this.updateStroke(dt);
    this.updateGuides();
    this.updateCamera(dt, now);
    for (const f of this.floaters) {
      f.userData.float += dt;
      f.position.y += Math.sin(f.userData.float) * 0.002;
      f.rotation.y += dt * 0.3;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayback(now: number, dt: number): void {
    // bi đang chìm
    for (const b of this.balls) {
      if (b.sink) {
        const k = Math.min(1, (now - b.sink.t0) / 260);
        b.mesh.position.lerpVectors(b.sink.from, b.sink.to, k);
        if (k >= 1) { b.mesh.visible = false; b.sink = null; }
      }
    }
    const p = this.play;
    if (!p) return;
    const t = (now - p.t0) / 1000;
    const f = t * FRAME_HZ;
    const k0 = Math.floor(f);
    const a = f - k0;
    const { msg } = p;
    // sự kiện
    while (p.evIdx < msg.events.length && msg.events[p.evIdx].t <= t) {
      this.onEvent(msg.events[p.evIdx], now);
      p.evIdx++;
    }
    for (let i = 0; i < 16; i++) {
      const b = this.balls[i];
      if (b.pocketed || b.sink) continue;
      const tr = msg.tracks[i];
      const [x0, y0] = this.sample(tr, k0);
      const [x1, y1] = this.sample(tr, k0 + 1);
      if (x0 < 0) { // đã vào lỗ
        if (!p.sunk.has(i)) { p.sunk.add(i); this.sinkBall(b, now); }
        continue;
      }
      let x = x0 / 1000;
      let y = y0 / 1000;
      if (x1 >= 0) {
        x = (x0 + (x1 - x0) * a) / 1000;
        y = (y0 + (y1 - y0) * a) / 1000;
      }
      const dx = x - b.x;
      const dy = y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6 && dist < 0.5) {
        const axis = new THREE.Vector3(dy, 0, -dx).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(axis, dist / R);
        b.mesh.quaternion.premultiply(q);
      }
      b.x = x;
      b.y = y;
      b.mesh.position.copy(toW(x, y));
    }
    if (k0 >= msg.frameCount - 1 && p.evIdx >= msg.events.length) {
      // Bi đã vào lỗ ở khung cuối nhưng sự kiện chưa kịp phát: xử lý nốt
      this.finishPlay();
      void dt;
    }
  }

  private sinkBall(b: BallView, now: number): void {
    // tìm lỗ gần nhất với vị trí cuối
    let best = POCKETS[0];
    let bd = Infinity;
    for (const pk of POCKETS) {
      const d = Math.hypot(pk.x - b.x, pk.y - b.y);
      if (d < bd) { bd = d; best = pk; }
    }
    b.sink = { t0: now, from: b.mesh.position.clone(), to: toW(best.x, best.y, -0.12) };
    b.pocketed = true;
  }

  private onEvent(e: TableEvent, now: number): void {
    if (!this.onEventSound) return;
    if (e.k === 'cue') audio.cue(Math.min(1, e.speed / 8.5));
    else if (e.k === 'ball') audio.ballHit(e.speed);
    else if (e.k === 'cushion') { if (e.speed > 0.05) audio.cushion(e.speed); }
    else if (e.k === 'pocket') {
      audio.pocket();
      const pk = POCKETS[e.pocket];
      this.cinemaFocus = toW(pk.x, pk.y, 0.05);
      this.cinemaFocusUntil = now + 1100;
      const b = this.balls[e.ball];
      if (!b.sink && !b.pocketed) { this.sinkBall(b, now); }
    }
  }

  private updateStroke(dt: number): void {
    const c = this.balls[0];
    const show = (this.aim.visible || this.strokeActive || this.otherAim !== null) && !c.pocketed && c.mesh.visible;
    this.cueGroup.visible = show;
    if (!show) return;
    let angle = this.aim.angle;
    let pull = this.aim.power;
    if (this.strokeActive) {
      this.strokeT += dt;
      angle = this.strokeAngle;
      const T1 = 0.28; // kéo về
      const T2 = 0.1; // đẩy tới
      if (this.strokeT < T1) pull = this.strokePower * (this.strokeT / T1);
      else if (this.strokeT < T1 + T2) pull = this.strokePower * (1 - (this.strokeT - T1) / T2) - 0.05;
      else { this.strokeActive = false; this.cueGroup.visible = this.aim.visible; return; }
    } else if (!this.aim.visible && this.otherAim) {
      angle = this.otherAim.angle;
      pull = this.otherAim.power;
    }
    const gap = R + 0.012 + Math.max(-0.05, pull) * 0.22;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const base = toW(c.x, c.y);
    this.cueGroup.position.copy(base).addScaledVector(dir, -gap);
    this.cueGroup.position.y = R + 0.02;
    // cây cơ nằm hơi nghiêng lên phía sau
    this.cueGroup.rotation.set(0, -angle, 0);
    this.cueGroup.rotateZ(-0.06);
  }

  private updateGuides(): void {
    const show = this.aim.visible && this.aim.guide && !this.play && !this.strokeActive;
    this.aimLine.visible = show;
    this.objLine.visible = show;
    this.ghostBall.visible = show;
    if (!show) return;
    const c = this.balls[0];
    const dx = Math.cos(this.aim.angle);
    const dy = Math.sin(this.aim.angle);
    // giao với bi
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
    // giao với băng
    let tw = Infinity;
    if (dx > 1e-6) tw = Math.min(tw, (L - R - c.x) / dx);
    if (dx < -1e-6) tw = Math.min(tw, (R - c.x) / dx);
    if (dy > 1e-6) tw = Math.min(tw, (W - R - c.y) / dy);
    if (dy < -1e-6) tw = Math.min(tw, (R - c.y) / dy);
    const tEnd = Math.min(bestT, tw);
    const gx = c.x + dx * tEnd;
    const gy = c.y + dy * tEnd;
    const p0 = toW(c.x, c.y, 0.004);
    const p1 = toW(gx, gy, 0.004);
    this.aimLine.geometry.setFromPoints([p0, p1]);
    this.ghostBall.position.copy(toW(gx, gy));
    if (hit && bestT <= tw) {
      const nx = hit.x - gx;
      const ny = hit.y - gy;
      const nl = Math.hypot(nx, ny) || 1;
      const len = 0.35;
      this.objLine.geometry.setFromPoints([toW(hit.x, hit.y, 0.004), toW(hit.x + (nx / nl) * len, hit.y + (ny / nl) * len, 0.004)]);
      this.objLine.visible = true;
    } else {
      this.objLine.visible = false;
    }
  }

  private updateCamera(dt: number, now: number): void {
    const goalPos = new THREE.Vector3();
    const goalLook = new THREE.Vector3();
    const aspect = this.camera.aspect;
    let mode = this.camMode;
    const c = this.balls[0];
    const inIntro = now < this.introUntil;
    const shooting = this.play !== null || now < this.shotCamUntil;

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
          // theo dõi hành động: tâm các bi đang chuyển động (ưu tiên bi cái), góc thấp
          const focus = this.cinemaFocus && now < this.cinemaFocusUntil ? this.cinemaFocus : toW(c.x, c.y);
          const back = this.cinemaFocus && now < this.cinemaFocusUntil ? 0.7 : 0.9;
          goalLook.copy(focus);
          const dirToCenter = new THREE.Vector3(-focus.x, 0, -focus.z).normalize();
          if (!isFinite(dirToCenter.x)) dirToCenter.set(0, 0, 1);
          goalPos.copy(focus).addScaledVector(dirToCenter, -back * 0).add(new THREE.Vector3(dirToCenter.z * 0.2, 0, -dirToCenter.x * 0.2));
          goalPos.copy(focus).addScaledVector(dirToCenter, -back);
          goalPos.y = 0.55;
        } else mode = 'persp';
      }
      if (mode === 'top') {
        const vFov = (this.camera.fov * Math.PI) / 180;
        const needH = (W + 0.95) / 2 / Math.tan(vFov / 2);
        const needW = (L + 0.85) / 2 / (Math.tan(vFov / 2) * aspect);
        const h = Math.max(needH, needW);
        goalPos.set(0, h, 0.001);
        goalLook.set(0, 0, 0);
      } else if (mode === 'persp') {
        const vFov = (this.camera.fov * Math.PI) / 180;
        const need = Math.max((W + 1.0) / 2 / Math.tan(vFov / 2), (L + 0.5) / 2 / (Math.tan(vFov / 2) * aspect));
        const d = Math.max(2.2, need * 1.02);
        goalPos.set(0, d * 0.72, d * 0.62 * this.viewSeatSide);
        goalLook.set(0, -0.05, 0.05 * this.viewSeatSide * -1);
      } else if (mode === 'shoot') {
        const ang = this.aim.angle;
        const base = toW(c.x, c.y);
        goalPos.set(base.x - Math.cos(ang) * 0.85, 0.42, base.z - Math.sin(ang) * 0.85);
        goalLook.set(base.x + Math.cos(ang) * 0.6, 0.02, base.z + Math.sin(ang) * 0.6);
      } else if (mode === 'free') {
        const sp = Math.sin(this.freePol);
        goalPos.set(Math.cos(this.freeAz) * this.freeDist * sp, Math.cos(this.freePol) * this.freeDist, Math.sin(this.freeAz) * this.freeDist * sp);
        goalLook.set(0, 0, 0);
      }
    }
    const k = 1 - Math.exp(-dt * (mode === 'free' && !inIntro ? 14 : 4.5));
    this.camPos.lerp(goalPos, k);
    this.camLook.lerp(goalLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  /** Dùng khi kiểm thử/ảnh chụp: đặt ngay camera không cần làm mượt */
  snapCamera(): void {
    this.introUntil = 0;
    for (let i = 0; i < 80; i++) this.updateCamera(0.1, performance.now());
  }
}
