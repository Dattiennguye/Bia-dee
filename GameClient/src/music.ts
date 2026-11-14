/**
 * Nhạc nền theo ngữ cảnh (file do người dùng cung cấp, public/music):
 *  - menu   : màn hình chính, phòng chờ, giải đấu, cài đặt (nhẹ nhàng/vui)
 *  - game   : lúc đánh bi (êm, ít gây xao nhãng, âm lượng thấp hơn)
 *  - result : màn hình kết quả (sôi động)
 * Chuyển ngữ cảnh = mờ dần bài cũ, vào dần bài mới. Hết bài tự chuyển bài kế (xáo trộn).
 */
export type MusicCtx = 'menu' | 'game' | 'result' | 'off';

const LISTS: Record<Exclude<MusicCtx, 'off'>, { files: string[]; gain: number }> = {
  menu: { files: ['menu-garden', 'menu-playtime'], gain: 1 },
  game: { files: ['game-lofi', 'game-atlas', 'game-clair'], gain: 0.55 },
  result: { files: ['result-rock'], gain: 0.9 },
};

class MusicPlayer {
  private vol = Number((() => { try { return localStorage.getItem('vigo.music'); } catch { return null; } })() ?? '0.5');
  private ctx: MusicCtx = 'off';
  private cur: HTMLAudioElement | null = null;
  private curGain = 1;
  private idx: Record<string, number> = {};
  private unlocked = false;
  private fadeTimer = 0;
  private wanted: MusicCtx = 'off';

  setVolume(v: number): void {
    this.vol = v;
    if (this.cur) this.cur.volume = Math.min(1, v * this.curGain);
    if (v <= 0) this.cur?.pause();
    else if (this.cur && this.cur.paused && this.unlocked) void this.cur.play().catch(() => undefined);
    else if (!this.cur && this.wanted !== 'off') this.set(this.wanted);
  }

  /** Gọi ở cử chỉ đầu tiên của người dùng (trình duyệt/WebView chặn tự phát) */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.wanted !== 'off') this.set(this.wanted);
  }

  set(ctx: MusicCtx): void {
    this.wanted = ctx;
    if (!this.unlocked || this.vol <= 0) { if (ctx === 'off') this.fadeOut(); return; }
    if (ctx === this.ctx && this.cur && !this.cur.paused) return;
    this.ctx = ctx;
    this.fadeOut();
    if (ctx === 'off') return;
    this.playNext(ctx);
  }

  pauseAll(p: boolean): void {
    if (!this.cur) return;
    if (p) this.cur.pause();
    else if (this.vol > 0 && this.unlocked) void this.cur.play().catch(() => undefined);
  }

  private playNext(ctx: Exclude<MusicCtx, 'off'>): void {
    const l = LISTS[ctx];
    // xáo trộn: bắt đầu từ bài ngẫu nhiên lần đầu, sau đó lần lượt
    const i = this.idx[ctx] === undefined ? Math.floor(Math.random() * l.files.length) : (this.idx[ctx] + 1) % l.files.length;
    this.idx[ctx] = i;
    const a = new Audio(`./music/${l.files[i]}.mp3`);
    a.preload = 'auto';
    a.volume = 0;
    this.curGain = l.gain;
    this.cur = a;
    a.addEventListener('ended', () => { if (this.cur === a && this.ctx === ctx) this.playNext(ctx); });
    a.addEventListener('error', () => { /* bỏ qua bài lỗi */ });
    void a.play().then(() => this.fade(a, Math.min(1, this.vol * l.gain), 1200)).catch(() => undefined);
  }

  private fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    const from = a.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step); else done?.();
    };
    step();
  }

  private fadeOut(): void {
    const old = this.cur;
    if (!old) return;
    this.cur = null;
    window.clearTimeout(this.fadeTimer);
    this.fade(old, 0, 700, () => { old.pause(); old.src = ''; });
  }
}

export const music = new MusicPlayer();
