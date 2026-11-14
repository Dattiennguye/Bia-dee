/**
 * Âm thanh: tiếng đánh/phá bi/rơi lỗ dùng mẫu thật (public/sfx, cắt từ file "pool_break" của người dùng),
 * phần còn lại tạo bằng WebAudio.
 */
import { LS } from './net';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  musicVol = Number(LS.get('vigo.music') ?? '0.5');
  sfxVol = Number(LS.get('vigo.sfx') ?? '0.8');
  private musicOn = false;
  private musicTimer: number | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private step = 0;
  private samples: Record<string, AudioBuffer> = {};

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const n of ['break', 'hit', 'drop']) {
      try {
        const r = await fetch(`./sfx/${n}.mp3`);
        this.samples[n] = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch { /* dùng âm tổng hợp */ }
    }
  }

  private playSample(name: string, vol: number, rate = 1): boolean {
    const b = this.samples[name];
    if (!this.ctx || !b) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.sfxGain!);
    src.start();
    return true;
  }

  breakShot(): void {
    if (!this.playSample('break', 1)) this.cue(1);
  }

  /** Phải gọi sau thao tác của người dùng (trình duyệt yêu cầu) */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVol;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol * 0.35;
    this.musicGain.connect(this.master);
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    void this.loadSamples();
    if (this.musicVol > 0) this.startMusic();
  }

  setMusic(v: number): void {
    this.musicVol = v;
    LS.set('vigo.music', String(v));
    if (this.musicGain) this.musicGain.gain.value = v * 0.35;
    if (v > 0) this.startMusic(); else this.stopMusic();
  }

  setSfx(v: number): void {
    this.sfxVol = v;
    LS.set('vigo.sfx', String(v));
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, when = 0, slideTo?: number): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q: number, when = 0, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf!;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfxGain!);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  ballHit(speed: number): void {
    if (!this.ctx) return;
    const v = Math.min(1, 0.15 + speed / 4);
    const f = 2600 + Math.random() * 500;
    this.tone(f, 0.09, 'triangle', 0.5 * v, this.sfxGain!, 0, f * 0.6);
    this.tone(f * 1.5, 0.05, 'sine', 0.25 * v, this.sfxGain!);
    this.noise(0.03, 0.4 * v, 4000, 1);
  }

  cushion(speed: number): void {
    if (!this.ctx) return;
    const v = Math.min(1, 0.15 + speed / 3);
    this.tone(150, 0.14, 'sine', 0.7 * v, this.sfxGain!, 0, 70);
    this.noise(0.06, 0.25 * v, 600, 0.8);
  }

  pocket(): void {
    if (!this.ctx) return;
    if (this.playSample('drop', 0.9, 0.95 + Math.random() * 0.1)) return;
    this.tone(110, 0.25, 'sine', 0.7, this.sfxGain!, 0, 50);
    this.noise(0.25, 0.3, 900, 2, 0.03);
    this.tone(1800, 0.05, 'triangle', 0.2, this.sfxGain!, 0.1);
    this.tone(1400, 0.05, 'triangle', 0.15, this.sfxGain!, 0.18);
  }

  cue(power: number): void {
    if (!this.ctx) return;
    const v = 0.3 + power * 0.7;
    if (this.playSample('hit', 0.35 + 0.65 * power, 0.92 + Math.random() * 0.16)) return;
    this.tone(900, 0.06, 'square', 0.25 * v, this.sfxGain!, 0, 300);
    this.noise(0.05, 0.5 * v, 1800, 1.5);
    this.tone(200, 0.1, 'sine', 0.5 * v, this.sfxGain!);
  }

  click(): void {
    if (!this.ctx) return;
    this.tone(660, 0.05, 'triangle', 0.25, this.sfxGain!, 0, 880);
  }

  back(): void {
    if (!this.ctx) return;
    this.tone(520, 0.06, 'triangle', 0.22, this.sfxGain!, 0, 360);
  }

  turn(): void {
    if (!this.ctx) return;
    this.tone(880, 0.1, 'sine', 0.3, this.sfxGain!);
    this.tone(1320, 0.14, 'sine', 0.25, this.sfxGain!, 0.09);
  }

  foul(): void {
    if (!this.ctx) return;
    this.tone(220, 0.25, 'sawtooth', 0.25, this.sfxGain!, 0, 120);
    this.tone(180, 0.3, 'sawtooth', 0.2, this.sfxGain!, 0.18, 90);
  }

  win(): void {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((n, i) => {
      this.tone(n, 0.3, 'triangle', 0.4, this.sfxGain!, i * 0.13);
      this.tone(n / 2, 0.3, 'sine', 0.25, this.sfxGain!, i * 0.13);
    });
  }

  lose(): void {
    if (!this.ctx) return;
    [392, 349, 311, 262].forEach((n, i) => this.tone(n, 0.35, 'sine', 0.35, this.sfxGain!, i * 0.2, n * 0.97));
  }

  startGame(): void {
    if (!this.ctx) return;
    [392, 523, 659].forEach((n, i) => this.tone(n, 0.25, 'triangle', 0.35, this.sfxGain!, i * 0.1));
  }

  // ---- nhạc nền tự sinh: giai điệu vui nhộn đơn giản ----
  private startMusic(): void {
    if (this.musicOn || !this.ctx) return;
    this.musicOn = true;
    const chords = [
      [261.6, 329.6, 392.0],
      [220.0, 261.6, 329.6],
      [174.6, 220.0, 261.6],
      [196.0, 246.9, 392.0],
    ];
    const melody = [0, 2, 1, 2, 0, 1, 2, 1, 2, 1, 0, 1, 2, 0, 1, 2];
    const tick = () => {
      if (!this.musicOn || !this.ctx) return;
      const bar = Math.floor(this.step / 8) % chords.length;
      const ch = chords[bar];
      const i = this.step % 8;
      const dest = this.musicGain!;
      if (i === 0) {
        this.tone(ch[0] / 2, 0.9, 'sine', 0.5, dest);
      }
      if (i % 2 === 0) {
        const n = ch[melody[this.step % melody.length]] * 2;
        this.tone(n, 0.22, 'triangle', 0.22, dest);
      }
      if (i === 4) this.tone(ch[0] / 2, 0.5, 'sine', 0.35, dest);
      if (i % 4 === 2) this.noise(0.04, 0.0, 8000, 1, 0, 'highpass');
      this.step++;
    };
    this.musicTimer = window.setInterval(tick, 260);
  }

  private stopMusic(): void {
    this.musicOn = false;
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const audio = new AudioEngine();
