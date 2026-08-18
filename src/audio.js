// Procedural audio: all music and SFX are synthesized with WebAudio at
// runtime — no audio files, so the game stays a single self-contained page.
// The context unlocks on the first user gesture (iOS requirement); everything
// degrades silently if audio is unavailable.

const MUTE_KEY = 'silicon-shield-muted';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.music = null; this.sfxBus = null;
    this.themeTimer = null; this.themeNodes = [];
    this.lastPlayed = {};
    let muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* default on */ }
    this.muted = muted;
  }

  // Call from a user-gesture handler; safe to call repeatedly.
  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.8;
        this.sfxBus.connect(this.master);
        this.music = this.ctx.createGain();
        this.music.gain.value = 0.5;
        this.music.connect(this.master);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* stay silent */ }
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* no persistence */ }
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  get ready() { return this.ctx && this.ctx.state === 'running' && !this.muted; }

  // ------------------------------------------------------------ primitives
  _osc(type, freq, t0, dur, peak, bus, freqEnd = null) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }

  _noise(t0, dur, peak, bus, filterFreq = 1200, q = 0.7) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t0); src.stop(t0 + dur + 0.05);
    return src;
  }

  // ---------------------------------------------------------------- sfx
  sfx(name) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - (this.lastPlayed[name] || 0) < 90) return; // per-sound throttle
    this.lastPlayed[name] = now;
    const t = this.ctx.currentTime + 0.01;
    const B = this.sfxBus;
    switch (name) {
      case 'tick':
        this._osc('square', 1100, t, 0.04, 0.06, B);
        break;
      case 'launch':
        this._osc('sawtooth', 180, t, 0.45, 0.09, B, 950);
        this._noise(t, 0.4, 0.05, B, 3200);
        break;
      case 'boom':
        this._noise(t, 0.5, 0.22, B, 420);
        this._osc('sine', 70, t, 0.5, 0.25, B, 38);
        break;
      case 'bigboom':
        this._noise(t, 0.9, 0.3, B, 300);
        this._osc('sine', 60, t, 0.85, 0.32, B, 30);
        this._noise(t + 0.12, 0.5, 0.12, B, 900);
        break;
      case 'gun':
        this._noise(t, 0.12, 0.16, B, 1500, 2);
        this._osc('sine', 120, t, 0.14, 0.14, B, 70);
        break;
      case 'splash':
        this._noise(t, 0.35, 0.1, B, 800);
        break;
      case 'drum':
        this._osc('sine', 110, t, 0.18, 0.22, B, 60);
        this._osc('sine', 90, t + 0.22, 0.24, 0.2, B, 50);
        break;
      case 'chime':
        this._osc('sine', 660, t, 0.25, 0.08, B);
        this._osc('sine', 880, t + 0.16, 0.4, 0.07, B);
        break;
      case 'klaxon':
        this._osc('square', 440, t, 0.16, 0.06, B);
        this._osc('square', 330, t + 0.18, 0.16, 0.06, B);
        this._osc('square', 440, t + 0.36, 0.16, 0.06, B);
        break;
    }
  }

  // --------------------------------------------------------------- themes
  stopTheme() {
    if (this.themeTimer) { clearTimeout(this.themeTimer); this.themeTimer = null; }
    for (const n of this.themeNodes) { try { n.stop(); } catch { /* already done */ } }
    this.themeNodes = [];
  }

  // note helper for themes: n semitones above A2 (110 Hz)
  _f(n) { return 110 * Math.pow(2, n / 12); }

  _melody(notes, t0, beat, type, peak, octave = 0) {
    for (const [step, n, len] of notes) {
      if (n === null) continue;
      const o = this._osc(type, this._f(n + octave * 12), t0 + step * beat, len * beat * 0.92, peak, this.music);
      this.themeNodes.push(o);
    }
  }

  _snare(steps, t0, beat) {
    for (const s of steps) this.themeNodes.push(this._noise(t0 + s * beat, 0.09, 0.07, this.music, 2600, 1.2));
  }

  theme(kind) {
    if (!this.ready) return;
    this.stopTheme();
    const t0 = this.ctx.currentTime + 0.05;
    if (kind === 'main') {
      // tense minor march in E (E=7 above A2)
      const beat = 0.30;
      const bass = [[0, -5, 1], [2, -5, 1], [4, -5, 1], [6, -5, 1], [8, -10, 1], [10, -10, 1], [12, -5, 1], [14, -2, 1],
        [16, -5, 1], [18, -5, 1], [20, -5, 1], [22, -5, 1], [24, -10, 1], [26, -3, 1], [28, -5, 2]];
      const lead = [[0, 7, 1.5], [2, 10, 1], [4, 12, 1.5], [6, 10, 1], [8, 7, 2], [12, 5, 1], [14, 3, 1],
        [16, 7, 1.5], [18, 10, 1], [20, 14, 1.5], [22, 12, 1], [24, 10, 2], [26, 12, 1], [28, 7, 3]];
      this._melody(bass, t0, beat, 'triangle', 0.12);
      this._melody(lead, t0, beat, 'sawtooth', 0.045, 1);
      this._snare([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29], t0, beat);
    } else if (kind === 'victory') {
      // bright fanfare in C (C=3): C-E-G-C arpeggio, timpani under
      const beat = 0.26;
      const fanfare = [[0, 3, 1], [1, 7, 1], [2, 10, 1], [3, 15, 2.5], [6, 10, 0.8], [7, 15, 3.5],
        [11, 12, 1], [12, 15, 1], [13, 19, 4]];
      this._melody(fanfare, t0, beat, 'sawtooth', 0.06, 1);
      this._melody(fanfare, t0 + 0.012, beat, 'square', 0.03, 2);
      const timp = [[0, -9, 1], [3, -9, 1], [7, -2, 1], [11, -9, 1], [13, 3, 4]];
      this._melody(timp, t0, beat, 'sine', 0.2, 0);
      this._snare([0, 3, 6, 7, 11, 13], t0, beat);
    } else if (kind === 'defeat') {
      // slow dirge in A minor: low drone, descending line
      const beat = 0.55;
      const drone = [[0, -12, 8], [0, -5, 8]];
      const line = [[0, 12, 2], [2, 10, 2], [4, 8, 2], [6, 7, 3.5], [10, 3, 4]];
      this._melody(drone, t0, beat, 'triangle', 0.09);
      this._melody(line, t0, beat, 'sine', 0.09, 1);
      this._melody(line, t0 + 0.015, beat, 'sawtooth', 0.02, 0);
    }
  }
}
