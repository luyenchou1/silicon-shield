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
    this.musicOn = true; // finer control than the master mute, set from Settings
    this.sfxOn = true;
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

  _noise(t0, dur, peak, bus, filterFreq = 1200, q = 0.7, filterType = 'lowpass') {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = filterFreq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t0); src.stop(t0 + dur + 0.05);
    return src;
  }

  // ---------------------------------------------------------------- sfx
  sfx(name) {
    if (!this.ready || !this.sfxOn) return;
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

  _kick(steps, t0, beat) {
    for (const s of steps) this.themeNodes.push(this._osc('sine', 130, t0 + s * beat, 0.16, 0.2, this.music, 42));
  }

  _hat(steps, t0, beat) {
    for (const s of steps) this.themeNodes.push(this._noise(t0 + s * beat, 0.04, 0.022, this.music, 6500, 1, 'highpass'));
  }

  // sustained detuned-saw chord pad — the harmonic bed under the melody
  _pad(chord, t0, dur, peak = 0.016) {
    for (const n of chord) {
      this.themeNodes.push(this._osc('sawtooth', this._f(n), t0, dur, peak, this.music));
      this.themeNodes.push(this._osc('sawtooth', this._f(n) * 1.004, t0, dur, peak, this.music));
    }
  }

  // Themes are multi-track sections (bass + pad + lead + arp + drum kit),
  // scheduled section-by-section so the main theme loops with variation.
  theme(kind) {
    if (!this.ready || !this.musicOn) return;
    this.stopTheme();
    this._themeKind = kind;
    this._pass = 0;
    this._scheduleSection(this.ctx.currentTime + 0.05);
  }

  _scheduleSection(t0) {
    this.themeNodes = this.themeNodes.slice(-400); // finished sections drop off
    let dur = 0;
    if (this._themeKind === 'main') dur = this._mainSection(t0, this._pass);
    else if (this._themeKind === 'victory') this._victorySection(t0);
    else if (this._themeKind === 'defeat') this._defeatSection(t0);
    this._pass += 1;
    if (dur > 0) {
      const waitMs = Math.max(50, (t0 + dur - this.ctx.currentTime - 0.2) * 1000);
      this.themeTimer = setTimeout(() => {
        this.themeTimer = null;
        if (this.ready && this._themeKind === 'main') this._scheduleSection(t0 + dur);
      }, waitMs);
    }
  }

  // 8-bar tense E-minor march. Loops; lead phrase alternates between passes.
  _mainSection(t0, pass) {
    const beat = 0.30, bar = beat * 4;
    const CH = {
      em: { root: -5, chord: [7, 10, 14] },   // E minor
      c:  { root: -9, chord: [3, 7, 10] },    // C major
      g:  { root: -2, chord: [10, 14, 17] },  // G major
      am: { root: -12, chord: [0, 3, 7] },    // A minor
      b:  { root: -10, chord: [2, 6, 9] },    // B major (dominant tension)
    };
    const prog = [CH.em, CH.em, CH.c, CH.am, CH.em, CH.c, CH.g, CH.b];
    prog.forEach((ch, i) => {
      const bt = t0 + i * bar;
      // bass: driving eighths (triangle) over a sub-octave sine
      for (const [s, n] of [[0, 0], [0.5, 0], [1, 0], [1.5, 7], [2, 0], [2.5, 0], [3, 7], [3.5, 12]]) {
        this.themeNodes.push(this._osc('triangle', this._f(ch.root + n), bt + s * beat, beat * 0.45, 0.1, this.music));
        this.themeNodes.push(this._osc('sine', this._f(ch.root + n) / 2, bt + s * beat, beat * 0.5, 0.09, this.music));
      }
      this._pad(ch.chord, bt, bar * 0.98);
      // pulse arpeggio joins in the back half — rising urgency
      if (i >= 4) {
        const arp = [0, 7, 12, 7];
        for (let s = 0; s < 8; s++) {
          this.themeNodes.push(this._osc('square', this._f(ch.chord[0] + 12 + arp[s % 4]), bt + s * beat * 0.5, beat * 0.22, 0.013, this.music));
        }
      }
      this._kick([0, 2], bt, beat);
      this._snare([1, 3], bt, beat);
      if (i >= 2) this._hat([0.5, 1.5, 2.5, 3.5], bt, beat);
    });
    // lead: alternating first phrase, fixed resolution phrase; doubled voice
    const A = [[0, 7, 1.5], [2, 10, 1], [4, 12, 1.5], [6, 10, 1], [8, 7, 2], [12, 5, 1], [14, 3, 1]];
    const B = [[0, 14, 1.5], [2, 12, 1], [4, 10, 1.5], [6, 12, 1], [8, 15, 2], [12, 14, 1], [14, 10, 1]];
    const close = [[16, 7, 1.5], [18, 10, 1], [20, 14, 1.5], [22, 12, 1], [24, 10, 2], [26, 12, 1], [28, 7, 3]];
    for (const phrase of [pass % 2 ? B : A, close]) {
      this._melody(phrase, t0, beat, 'sawtooth', 0.05, 1);
      this._melody(phrase, t0 + 0.014, beat, 'square', 0.018, 1);
    }
    return prog.length * bar;
  }

  _victorySection(t0) {
    // bright fanfare in C: brass-like doubled arpeggio over pad, timpani, kit
    const beat = 0.26;
    const fanfare = [[0, 3, 1], [1, 7, 1], [2, 10, 1], [3, 15, 2.5], [6, 10, 0.8], [7, 15, 3.5],
      [11, 12, 1], [12, 15, 1], [13, 19, 4]];
    this._melody(fanfare, t0, beat, 'sawtooth', 0.06, 1);
    this._melody(fanfare, t0 + 0.012, beat, 'square', 0.03, 2);
    this._pad([3, 7, 10], t0, 6 * beat, 0.02);            // C
    this._pad([8, 12, 15], t0 + 6 * beat, 5 * beat, 0.02); // F
    this._pad([10, 14, 17], t0 + 11 * beat, 2 * beat, 0.02); // G
    this._pad([3, 7, 10, 15], t0 + 13 * beat, 4 * beat, 0.024); // C, full
    const timp = [[0, -9, 1], [3, -9, 1], [7, -2, 1], [11, -9, 1], [13, 3, 4]];
    this._melody(timp, t0, beat, 'sine', 0.2, 0);
    this._kick([0, 3, 7, 11, 13], t0, beat);
    this._snare([0, 3, 6, 7, 11, 13], t0, beat);
  }

  _defeatSection(t0) {
    // slow dirge in A minor: drone + pad, descending doubled line, heartbeat
    const beat = 0.55;
    const drone = [[0, -12, 8], [0, -5, 8]];
    const line = [[0, 12, 2], [2, 10, 2], [4, 8, 2], [6, 7, 3.5], [10, 3, 4]];
    this._melody(drone, t0, beat, 'triangle', 0.09);
    this._pad([0, 3, 7], t0, 8 * beat, 0.014);
    this._melody(line, t0, beat, 'sine', 0.09, 1);
    this._melody(line, t0 + 0.015, beat, 'sawtooth', 0.02, 0);
    this._kick([0, 0.7, 4, 4.7, 8, 8.7], t0, beat);
  }
}
