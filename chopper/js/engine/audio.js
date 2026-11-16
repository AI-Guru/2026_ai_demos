// ============================================================================
// js/engine/audio.js — TIGER: Operation Weißer Blitz
// Fully procedural WebAudio: zero dependencies, zero assets. Every sound is
// synthesized from oscillators + ONE shared 2 s noise buffer.
// Graph: one-shots/flight → sfxBus, lock/warnings → warnBus, music → musicBus;
// buses → master → compressor → destination. Pause ducks flight + warnBus.
// No AudioContext until unlock() (autoplay policy); every method no-ops
// gracefully before unlock / after dispose and never throws.
// ============================================================================

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const EPS = 0.0001; // exponential ramps may never reach 0

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null; this.sfxBus = null; this.musicBus = null; this.warnBus = null;
    this.noiseBuf = null;
    this.flight = null;          // continuous rotor/turbine/wind bed
    this._lock = null;           // seeker beep state
    this._warn = null;           // warning loop state
    this._music = null;          // title music scheduler state
    this._expVoices = [];        // live explosion voices (capped)
    this._lastGun = -1;          // gun rate-limit timestamp
    this.paused = false;
    this._vol = { master: 0.9, sfx: 0.9, music: 0.65 }; // survive pre-unlock sets
  }

  // ---- Lifecycle -----------------------------------------------------------

  /** Create/resume the AudioContext on a user gesture. Safe to call repeatedly. */
  unlock() {
    try {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      if (typeof window === 'undefined') return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // WebAudio unavailable → everything stays a no-op
      this.ctx = new AC();

      this.master = this.ctx.createGain(); this.master.gain.value = this._vol.master;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.25;
      this.master.connect(comp).connect(this.ctx.destination);

      const bus = (v) => { const g = this.ctx.createGain(); g.gain.value = v; return g; };
      this.sfxBus = bus(this._vol.sfx); this.sfxBus.connect(this.master);
      this.musicBus = bus(this._vol.music); this.musicBus.connect(this.master);
      this.warnBus = bus(this.paused ? 0.15 : 1); this.warnBus.connect(this.sfxBus);

      // ONE 2-second white-noise buffer, reused by rotor, wind and every burst.
      const len = Math.floor(this.ctx.sampleRate * 2);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (_) { this.ctx = null; }
  }

  /** Tear everything down. The instance is inert afterwards (unlock rebuilds). */
  dispose() {
    try {
      this.stopMusic(); this.stopLock(); this.stopWarning(); this.stopFlight();
      if (this.ctx) {
        if (this.master) this.master.disconnect();
        this.ctx.close().catch(() => {});
      }
    } catch (_) { /* never throw */ }
    this.ctx = null; this.master = this.sfxBus = this.musicBus = this.warnBus = null;
    this.noiseBuf = null; this.flight = null;
    this._lock = this._warn = this._music = null; this._expVoices = [];
  }

  // ---- Mixer ---------------------------------------------------------------

  setMasterVolume(v01) { this._rampVol('master', this.master, v01); }
  setSfxVolume(v01) { this._rampVol('sfx', this.sfxBus, v01); }
  setMusicVolume(v01) { this._rampVol('music', this.musicBus, v01); }

  _rampVol(key, node, v) {
    try {
      this._vol[key] = clamp01(v);
      if (!this.ctx || !node) return;
      node.gain.setTargetAtTime(this._vol[key], this.ctx.currentTime, 0.06);
    } catch (_) { /* never throw */ }
  }

  /** Duck flight bed + warnings to ~15% while paused. Music keeps playing. */
  setPaused(on) {
    try {
      this.paused = !!on;
      if (!this.ctx) return;
      const t = this.ctx.currentTime, lvl = this.paused ? 0.15 : 1;
      if (this.flight) this.flight.duck.gain.setTargetAtTime(lvl, t, 0.1);
      if (this.warnBus) this.warnBus.gain.setTargetAtTime(lvl, t, 0.1);
    } catch (_) { /* never throw */ }
  }

  // ---- Internal helpers (self-cleaning: sources stop, onended disconnects) --

  _noise(loop = false) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop;
    return s;
  }

  _panner(v) {
    if (!this.ctx.createStereoPanner) return this.ctx.createGain(); // mono fallback
    const p = this.ctx.createStereoPanner(); p.pan.value = clamp(v, -1, 1);
    return p;
  }

  /** Filtered noise burst with attack/decay envelope. Returns nothing; cleans itself. */
  _burst(t, o) {
    const dur = o.dur ?? 0.2;
    const s = this._noise();
    s.playbackRate.value = o.rate ?? 1;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.freq ?? 1000, t);
    f.Q.value = o.q ?? 0.8;
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(o.to, 20), t + (o.sweep ?? dur));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(Math.max(o.peak ?? 0.3, EPS), t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    s.connect(f).connect(g).connect(o.dest ?? this.sfxBus);
    s.start(t, Math.random() * Math.max(0, 1.9 - dur));
    s.stop(t + dur + 0.05);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
  }

  /** Oscillator voice with attack/decay envelope and optional pitch glide. */
  _tone(t, o) {
    const dur = o.dur ?? 0.2;
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq ?? 440, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(o.glide, 1), t + (o.glideTime ?? dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(Math.max(o.peak ?? 0.2, EPS), t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    osc.connect(g).connect(o.dest ?? this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  }

  /** Clean gate envelope for seeker/warning beeps on a persistent gain node. */
  _beep(g, t, peak, dur) {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + 0.008);
    g.setValueAtTime(peak, t + Math.max(dur - 0.015, 0.012));
    g.linearRampToValueAtTime(0, t + dur);
  }

  /** Persistent oscillator → gate gain → warnBus, for lock/warning loops. */
  _loopVoice(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = 0;
    o.connect(g).connect(this.warnBus);
    o.start(this.ctx.currentTime);
    return { o, g };
  }

  /** Fade out and tear down a lock/warning loop voice. */
  _stopLoop(L) {
    if (!L) return;
    clearInterval(L.timer);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    L.g.gain.cancelScheduledValues(t);
    L.g.gain.setTargetAtTime(EPS, t, 0.02);
    L.o.stop(t + 0.15);
    L.o.onended = () => { L.o.disconnect(); L.g.disconnect(); };
  }

  // ---- Flight bed: rotor blade-pass thump, turbine, wind, damage sputter ----

  startFlight() {
    try {
      if (!this.ctx || this.flight) return;
      const t = this.ctx.currentTime;
      const all = [], srcs = [];
      const keep = (n) => { all.push(n); return n; };

      const duck = keep(this.ctx.createGain());           // pause duck target
      duck.gain.value = this.paused ? 0.15 : 1;
      duck.connect(this.sfxBus);
      const mix = keep(this.ctx.createGain());            // spool-up fade target
      mix.gain.setValueAtTime(EPS, t); mix.gain.setTargetAtTime(1, t, 0.45);
      mix.connect(duck);
      const rotorBus = keep(this.ctx.createGain());       // sputter-dip target
      rotorBus.gain.value = 1;
      rotorBus.connect(mix);
      // Rotor: ONE blade-pass LFO (rpm/60*4 ≈ 22 Hz) amplitude-modulates two
      // noise voices panned ±0.4, started 30 ms apart for stereo width.
      const lfo = keep(this.ctx.createOscillator());
      lfo.type = 'sine'; lfo.frequency.value = 22;
      const amps = [], depths = [];
      for (const side of [-0.4, 0.4]) {
        const s = keep(this._noise(true));
        const bp = keep(this.ctx.createBiquadFilter());
        bp.type = 'bandpass'; bp.frequency.value = 350; bp.Q.value = 0.8;
        const amp = keep(this.ctx.createGain());
        amp.gain.value = 0.42;
        const depth = keep(this.ctx.createGain());
        depth.gain.value = 0.36;                          // pronounced thump
        lfo.connect(depth).connect(amp.gain);
        const pan = keep(this._panner(side));
        s.connect(bp).connect(amp).connect(pan).connect(rotorBus);
        s.start(t, side < 0 ? 0 : 0.03);
        srcs.push(s); amps.push(amp); depths.push(depth);
      }
      // Low 52 Hz "thump" layer, gain-modulated at the same blade-pass rate.
      const thump = keep(this.ctx.createOscillator());
      thump.type = 'sine'; thump.frequency.value = 52;
      const thumpGain = keep(this.ctx.createGain()); thumpGain.gain.value = 0.22;
      const thumpDepth = keep(this.ctx.createGain()); thumpDepth.gain.value = 0.2;
      lfo.connect(thumpDepth).connect(thumpGain.gain);
      thump.connect(thumpGain).connect(rotorBus);
      thump.start(t); srcs.push(thump);
      // Turbine: two detuned saws through a bandpass, plus a faint 4 kHz whine.
      const sawA = keep(this.ctx.createOscillator());
      const sawB = keep(this.ctx.createOscillator());
      sawA.type = sawB.type = 'sawtooth';
      sawA.frequency.value = sawB.frequency.value = 950;
      sawA.detune.value = -6; sawB.detune.value = 6;
      const tbp = keep(this.ctx.createBiquadFilter());
      tbp.type = 'bandpass'; tbp.frequency.value = 2400; tbp.Q.value = 2;
      const turbGain = keep(this.ctx.createGain()); turbGain.gain.value = 0.045;
      sawA.connect(tbp); sawB.connect(tbp);
      tbp.connect(turbGain).connect(rotorBus);
      sawA.start(t); sawB.start(t); srcs.push(sawA, sawB);
      const whine = keep(this.ctx.createOscillator());
      whine.type = 'sine'; whine.frequency.value = 4000;
      const whineGain = keep(this.ctx.createGain()); whineGain.gain.value = 0.006;
      whine.connect(whineGain).connect(rotorBus);
      whine.start(t); srcs.push(whine);
      // Wind: looped noise through a speed-driven lowpass.
      const windSrc = keep(this._noise(true));
      const windLP = keep(this.ctx.createBiquadFilter());
      windLP.type = 'lowpass'; windLP.frequency.value = 500;
      const windGain = keep(this.ctx.createGain()); windGain.gain.value = 0;
      windSrc.connect(windLP).connect(windGain).connect(mix);
      windSrc.start(t, 0.7); srcs.push(windSrc);
      // Damage roughness: low saw, silent until damaged.
      const rough = keep(this.ctx.createOscillator());
      rough.type = 'sawtooth'; rough.frequency.value = 34;
      const roughGain = keep(this.ctx.createGain()); roughGain.gain.value = 0;
      rough.connect(roughGain).connect(rotorBus);
      rough.start(t); srcs.push(rough);

      lfo.start(t); srcs.push(lfo);
      this.flight = {
        duck, mix, rotorBus, lfo, amps, depths, thump, thumpDepth,
        sawA, sawB, turbGain, whine, windLP, windGain, rough, roughGain,
        all, srcs, nextSputter: 0,
      };
    } catch (_) { /* never throw */ }
  }

  stopFlight() {
    try {
      const f = this.flight;
      if (!this.ctx || !f) return;
      this.flight = null;
      const t = this.ctx.currentTime;
      f.mix.gain.cancelScheduledValues(t); f.mix.gain.setTargetAtTime(EPS, t, 0.15);
      for (const s of f.srcs) { try { s.stop(t + 0.6); } catch (_) {} }
      f.srcs[0].onended = () => { for (const n of f.all) { try { n.disconnect(); } catch (_) {} } };
    } catch (_) { /* never throw */ }
  }

  /** Per-frame flight parameters. Everything smoothed via setTargetAtTime. */
  updateFlight({ speed = 0, collective = 0, rpm = 330, agl = 100, damaged = false } = {}) {
    try {
      const f = this.flight;
      if (!this.ctx || !f) return;
      const t = this.ctx.currentTime;
      speed = clamp(speed, 0, 85); collective = clamp01(collective);
      rpm = clamp(rpm, 280, 380); agl = Math.max(0, agl);
      const rpmN = rpm / 330;

      // Rotor blade-pass frequency tracks rpm (4 blades).
      f.lfo.frequency.setTargetAtTime(rpm / 60 * 4, t, 0.15);
      f.thump.frequency.setTargetAtTime(52 * rpmN, t, 0.2);
      // Ground effect: thump is heavier close to the ground; collective loads it.
      const ge = clamp(1 - agl / 40, 0, 1);
      f.thumpDepth.gain.setTargetAtTime(0.14 + 0.12 * ge, t, 0.3);
      for (const d of f.depths) d.gain.setTargetAtTime(0.3 + collective * 0.12, t, 0.2);

      // Turbine pitch rises with collective (×1..2.3) and rpm.
      const tf = 950 * (1 + collective * 1.3) * rpmN;
      f.sawA.frequency.setTargetAtTime(tf, t, 0.12);
      f.sawB.frequency.setTargetAtTime(tf, t, 0.12);
      f.whine.frequency.setTargetAtTime(4000 * rpmN, t, 0.15);
      f.turbGain.gain.setTargetAtTime(0.03 + collective * 0.035, t, 0.15);

      // Wind grows quadratically with speed.
      f.windLP.frequency.setTargetAtTime(500 + speed * 10, t, 0.2);
      f.windGain.gain.setTargetAtTime(Math.pow(speed / 85, 2) * 0.3, t, 0.25);

      // Damage: roughness layer + irregular sputter dips on the rotor bus.
      f.roughGain.gain.setTargetAtTime(damaged ? 0.09 : 0, t, 0.2);
      if (damaged) {
        f.rough.frequency.setTargetAtTime(28 + Math.random() * 14, t, 0.1);
        if (t >= f.nextSputter) {
          const g = f.rotorBus.gain;
          g.cancelScheduledValues(t);
          g.setValueAtTime(0.2 + Math.random() * 0.3, t);
          g.setTargetAtTime(1, t + 0.02 + Math.random() * 0.05, 0.06);
          f.nextSputter = t + 0.1 + Math.random() * 0.4;
        }
      }
    } catch (_) { /* never throw */ }
  }

  // ---- Weapons -------------------------------------------------------------

  /** 30 mm cannon. Internal ~70 ms rate limit so held fire never stacks. */
  fireGun() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      if (t - this._lastGun < 0.07) return;
      this._lastGun = t;
      const pitch = 0.94 + Math.random() * 0.12;
      this._burst(t, { type: 'highpass', freq: 700, peak: 0.5, dur: 0.06, rate: pitch });
      this._tone(t, { freq: 130 * pitch, glide: 70, peak: 0.35, dur: 0.05 });
    } catch (_) { /* never throw */ }
  }

  /** 70 mm rocket: ignition crack + 0.5 s bandpass whoosh sweeping 300→1400 Hz. */
  fireRocket() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._burst(t, { type: 'highpass', freq: 1500, peak: 0.45, dur: 0.03 });
      this._burst(t + 0.015, { type: 'bandpass', freq: 300, to: 1400, sweep: 0.5, q: 1.2, peak: 0.4, attack: 0.02, dur: 0.5 });
    } catch (_) { /* never throw */ }
  }

  /** PARS 3 LR: deeper 0.9 s whoosh + crack + faint sustained roar tail. */
  fireMissile() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._burst(t, { type: 'highpass', freq: 1200, peak: 0.5, dur: 0.035 });
      this._burst(t + 0.02, { type: 'bandpass', freq: 200, to: 900, sweep: 0.9, q: 1.1, peak: 0.45, attack: 0.03, dur: 0.9 });
      this._burst(t + 0.1, { type: 'lowpass', freq: 420, peak: 0.12, attack: 0.15, dur: 1.6 });
    } catch (_) { /* never throw */ }
  }

  /** Decoy flare: hiss pop + 2 kHz ping. */
  flare() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._burst(t, { type: 'highpass', freq: 1800, peak: 0.25, dur: 0.3 });
      this._tone(t, { type: 'triangle', freq: 2000, glide: 1400, peak: 0.1, dur: 0.15 });
    } catch (_) { /* never throw */ }
  }

  // ---- Impacts -------------------------------------------------------------

  /** Distance-attenuated, pannable explosion. Max 8 voices; oldest is stolen. */
  explosion(distMeters = 0, pan = 0) {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._expVoices = this._expVoices.filter((v) => v.end > t);
      while (this._expVoices.length >= 8) {
        const old = this._expVoices.shift();
        old.g.gain.cancelScheduledValues(t);
        old.g.gain.setTargetAtTime(EPS, t, 0.015);
      }
      const g0 = this.ctx.createGain(); g0.gain.value = 1;
      const out = this._panner(pan);
      g0.connect(out).connect(this.sfxBus);
      const gain = 0.9 / (1 + Math.max(0, distMeters) / 250);
      this._expVoices.push({ g: g0, end: t + 1.8 });

      // Brown-ish body: noise through a 3000→150 Hz lowpass sweep.
      this._burst(t, { freq: 3000, to: 150, sweep: 1.1, peak: gain, attack: 0.006, dur: 1.15, dest: g0 });
      this._tone(t, { freq: 48, glide: 30, peak: gain * 0.8, dur: 0.9, dest: g0 });
      for (let i = 0; i < 3; i++) {
        this._burst(t + 0.05 + i * 0.09 + Math.random() * 0.05,
          { type: 'highpass', freq: 2500, peak: gain * 0.45, dur: 0.03, dest: g0 });
      }
      // g0/out have no source of their own; a silent keeper source gives them
      // an onended hook so the whole voice disconnects when it finishes.
      const keep = this._noise();
      const kg = this.ctx.createGain(); kg.gain.value = 0;
      keep.connect(kg).connect(g0);
      keep.start(t); keep.stop(t + 1.8);
      keep.onended = () => { keep.disconnect(); kg.disconnect(); g0.disconnect(); out.disconnect(); };
    } catch (_) { /* never throw */ }
  }

  /** Player took a hit: metallic thunk + brief noise. */
  hit() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._tone(t, { freq: 520, glide: 380, peak: 0.25, dur: 0.12 });
      this._tone(t, { freq: 870, glide: 640, peak: 0.12, dur: 0.1 });
      this._burst(t, { type: 'bandpass', freq: 900, q: 3, peak: 0.3, dur: 0.07 });
    } catch (_) { /* never throw */ }
  }

  /** Big layered crash: roar + sub + metallic ring + crackle. */
  crash() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._burst(t, { freq: 2600, to: 110, sweep: 1.5, peak: 0.85, attack: 0.006, dur: 1.7 });
      this._tone(t, { freq: 44, glide: 28, peak: 0.7, dur: 1.4 });
      for (const [f, p] of [[310, 0.06], [540, 0.05], [830, 0.04]]) {
        this._tone(t + 0.02, { type: 'square', freq: f, glide: f * 0.7, peak: p, dur: 0.7 });
      }
      for (let i = 0; i < 4; i++) {
        this._burst(t + 0.06 + i * 0.12 + Math.random() * 0.06,
          { type: 'highpass', freq: 2200, peak: 0.35, dur: 0.035 });
      }
      this._tone(t + 0.18, { freq: 60, glide: 34, peak: 0.4, dur: 0.5 });
    } catch (_) { /* never throw */ }
  }

  /** Soft skid/wheel thud on touchdown. */
  landing() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._tone(t, { freq: 65, glide: 45, peak: 0.3, dur: 0.22 });
      this._burst(t, { freq: 350, peak: 0.12, dur: 0.1 });
      this._tone(t + 0.12, { freq: 55, glide: 40, peak: 0.14, dur: 0.15 });
    } catch (_) { /* never throw */ }
  }

  // ---- Seeker lock: 1150 Hz square beeps ~7 Hz, solid tone when locked ------

  startLock() {
    try {
      if (!this.ctx || this._lock) return;
      const { o, g } = this._loopVoice('square', 1150);
      this._lock = { o, g, locked: false, next: this.ctx.currentTime + 0.05, timer: null };
      this._lock.timer = setInterval(() => this._lockTick(), 60);
    } catch (_) { /* never throw */ }
  }

  _lockTick() {
    try {
      const L = this._lock;
      if (!this.ctx || !L || L.locked) return;
      const now = this.ctx.currentTime;
      if (L.next < now - 0.2) L.next = now + 0.03; // resync after tab sleep
      while (L.next < now + 0.18) {
        this._beep(L.g.gain, L.next, 0.09, 0.075);
        L.next += 1 / 7;
      }
    } catch (_) { /* never throw */ }
  }

  /** true → solid 1150 Hz tone at lower gain; false → resume acquisition beeps. */
  setLocked(on) {
    try {
      const L = this._lock;
      if (!this.ctx || !L || L.locked === !!on) return;
      L.locked = !!on;
      const t = this.ctx.currentTime, g = L.g.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      if (L.locked) g.setTargetAtTime(0.05, t, 0.02);
      else { g.setTargetAtTime(0, t, 0.02); L.next = t + 0.1; }
    } catch (_) { /* never throw */ }
  }

  stopLock() {
    try { const L = this._lock; this._lock = null; this._stopLoop(L); } catch (_) { /* never throw */ }
  }

  // ---- Warning loops: radar / missile / pullup (idempotent per kind) --------

  warning(kind) {
    try {
      if (!this.ctx) return;
      if (this._warn && this._warn.kind === kind) return; // idempotent
      if (!['radar', 'missile', 'pullup'].includes(kind)) return;
      this.stopWarning();
      const type = kind === 'missile' ? 'square' : 'sine';
      const freq = kind === 'radar' ? 600 : kind === 'missile' ? 800 : 900;
      const { o, g } = this._loopVoice(type, freq);
      this._warn = { kind, o, g, idx: 0, next: this.ctx.currentTime + 0.05, timer: null };
      this._warn.timer = setInterval(() => this._warnTick(), 90);
    } catch (_) { /* never throw */ }
  }

  _warnTick() {
    try {
      const W = this._warn;
      if (!this.ctx || !W) return;
      const now = this.ctx.currentTime;
      if (W.next < now - 0.25) W.next = now + 0.03;
      while (W.next < now + 0.3) {
        const t = W.next;
        if (W.kind === 'radar') {
          this._beep(W.g.gain, t, 0.08, 0.12);            // slow 2 Hz
          W.next += 0.5;
        } else if (W.kind === 'missile') {
          W.o.frequency.setValueAtTime(W.idx % 2 ? 1100 : 800, t);
          this._beep(W.g.gain, t, 0.06, 0.07);            // urgent ~8 Hz
          W.next += 0.125;
        } else {                                          // pullup: triple beep
          const slot = W.idx % 8;
          if (slot < 3) this._beep(W.g.gain, t, 0.09, 0.09);
          W.next += slot === 2 ? 0.9 : 0.16;
        }
        W.idx++;
      }
    } catch (_) { /* never throw */ }
  }

  stopWarning() {
    try { const W = this._warn; this._warn = null; this._stopLoop(W); } catch (_) { /* never throw */ }
  }

  // ---- Radio & UI ----------------------------------------------------------

  /** Squelch burst with a click at the end (message start/end marker). */
  radioClick() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._burst(t, { type: 'bandpass', freq: 1800, q: 1.2, peak: 0.12, attack: 0.002, dur: 0.06 });
      this._burst(t + 0.065, { type: 'highpass', freq: 3000, peak: 0.1, dur: 0.012 });
      this._tone(t + 0.065, { type: 'square', freq: 1400, peak: 0.035, dur: 0.012 });
    } catch (_) { /* never throw */ }
  }

  uiClick() {
    try {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._tone(t, { type: 'triangle', freq: 950, peak: 0.08, dur: 0.035 });
      this._burst(t, { type: 'highpass', freq: 4000, peak: 0.04, dur: 0.01 });
    } catch (_) { /* never throw */ }
  }

  uiHover() {
    try {
      if (!this.ctx) return;
      this._tone(this.ctx.currentTime, { freq: 1400, peak: 0.025, dur: 0.02 });
    } catch (_) { /* never throw */ }
  }

  // ---- Title music: somber A-minor ambient, lookahead-scheduled -------------

  startMusic(kind) {
    try {
      if (!this.ctx || this._music || kind !== 'title') return;
      const t = this.ctx.currentTime;
      const fade = this.ctx.createGain();                 // stopMusic fades this
      fade.gain.setValueAtTime(EPS, t); fade.gain.setTargetAtTime(1, t, 0.6);
      fade.connect(this.musicBus);

      // Detuned saw pad: A2 / E3 / A3 / C4 through a slowly breathing lowpass.
      const padNodes = [fade];
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.6;
      const padGain = this.ctx.createGain();
      padGain.gain.setValueAtTime(EPS, t); padGain.gain.setTargetAtTime(0.1, t, 1.2); // ≤ 0.12
      filter.connect(padGain).connect(fade);
      padNodes.push(filter, padGain);
      for (const [freq, det] of [[110, -5], [164.81, 4], [220, -3], [261.63, 6]]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
        o.connect(filter); o.start(t);
        padNodes.push(o);
      }
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.06;      // ~17 s filter sweep
      const lfoDepth = this.ctx.createGain(); lfoDepth.gain.value = 260;
      lfo.connect(lfoDepth).connect(filter.frequency);
      lfo.start(t);
      padNodes.push(lfo, lfoDepth);

      this._music = { fade, padNodes, next: t + 0.1, beat: 0, timer: null };
      // Lookahead scheduler: 250 ms tick, 0.6 s horizon → never drifts.
      this._music.timer = setInterval(() => this._musicTick(), 250);
    } catch (_) { /* never throw */ }
  }

  _musicTick() {
    try {
      const M = this._music;
      if (!this.ctx || !M) return;
      const now = this.ctx.currentTime, beatDur = 60 / 70; // ~70 bpm
      if (M.next < now - 0.5) M.next = now + 0.05;
      // Am–F–C–E, one chord per bar (4 beats), 16-beat loop.
      const chords = [
        [220, 261.63, 329.63, 440],        // Am
        [174.61, 220, 261.63, 349.23],     // F
        [261.63, 329.63, 392, 523.25],     // C
        [329.63, 415.3, 493.88, 659.25],   // E
      ];
      while (M.next < now + 0.6) {
        const t = M.next, b = M.beat % 16;
        const ch = chords[(b / 4) | 0], step = b % 4;
        // Sparse triangle plucks on beats 1, 3, 4 with two echo repeats.
        const note = step === 0 ? ch[0] : step === 2 ? ch[2] : step === 3 ? ch[3] : null;
        if (note) {
          for (const [dt, pk] of [[0, 0.07], [0.43, 0.028], [0.86, 0.012]]) {
            this._tone(t + dt, { type: 'triangle', freq: note, peak: pk, attack: 0.004, dur: 0.55, dest: M.fade });
          }
        }
        // Soft timpani pulse every 2 beats: 65 Hz pitch-drop + noise tap.
        if (b % 2 === 0) {
          this._tone(t, { freq: 65, glide: 42, glideTime: 0.25, peak: 0.16, attack: 0.005, dur: 0.55, dest: M.fade });
          this._burst(t, { freq: 250, peak: 0.05, attack: 0.004, dur: 0.07, dest: M.fade });
        }
        M.next += beatDur; M.beat++;
      }
    } catch (_) { /* never throw */ }
  }

  stopMusic() {
    try {
      const M = this._music;
      if (!M) return;
      this._music = null;
      clearInterval(M.timer);
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      M.fade.gain.cancelScheduledValues(t);
      M.fade.gain.setTargetAtTime(EPS, t, 0.25);
      for (const n of M.padNodes) if (n.stop) { try { n.stop(t + 1.2); } catch (_) {} }
      const lastOsc = M.padNodes.find((n) => n.stop);
      if (lastOsc) lastOsc.onended = () => {
        for (const n of M.padNodes) { try { n.disconnect(); } catch (_) {} }
      };
    } catch (_) { /* never throw */ }
  }
}