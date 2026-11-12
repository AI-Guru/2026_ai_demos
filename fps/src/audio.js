// ============================================================
// Fully synthesized audio — WebAudio, no samples.
// Gunshot, steps, reload, drones, bolts, explosions, ambience,
// plus a generated convolution reverb for the concrete bay.
// ============================================================

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._stepAlt = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
    this.master.connect(comp).connect(ctx.destination);

    // reverb send
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.9, 2.6);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain).connect(this.master);

    this.noiseBuf = this._noiseBuffer(2.0);
    this._startAmbience();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.75;
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
      }
    }
    return buf;
  }

  _out(node, verbAmount = 0.2) {
    node.connect(this.master);
    if (verbAmount > 0) {
      const g = this.ctx.createGain();
      g.gain.value = verbAmount;
      node.connect(g).connect(this.verb);
    }
  }

  _noise(opts = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = opts.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + (opts.dur ?? 0.1));
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const dur = opts.dur ?? 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.5, t + (opts.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this._out(g, opts.verb ?? 0.2);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(opts = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    const dur = opts.dur ?? 0.15;
    o.frequency.setValueAtTime(opts.freq ?? 220, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.3, t + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this._out(g, opts.verb ?? 0.15);
    o.start(t); o.stop(t + dur + 0.05);
  }

  shot() {
    if (!this.ctx) return;
    const p = 0.92 + Math.random() * 0.16;
    // crack
    this._noise({ freq: 2600 * p, freqEnd: 700, dur: 0.09, vol: 0.62, q: 0.7, verb: 0.3 });
    // body thump
    this._tone({ type: 'sine', freq: 170 * p, freqEnd: 52, dur: 0.11, vol: 0.55, verb: 0.25 });
    // mechanical click
    this._noise({ freq: 4200, dur: 0.025, vol: 0.16, q: 2, verb: 0.05 });
  }

  dryFire() { this._noise({ freq: 2400, dur: 0.03, vol: 0.2, q: 3, verb: 0.05 }); }

  reload() {
    this._noise({ freq: 1500, dur: 0.05, vol: 0.3, q: 2, delay: 0.05 });
    this._noise({ freq: 900, dur: 0.07, vol: 0.32, q: 1.5, delay: 0.55 });
    this._noise({ freq: 2000, dur: 0.04, vol: 0.3, q: 2.5, delay: 1.05 });
    this._noise({ freq: 1300, dur: 0.06, vol: 0.36, q: 2, delay: 1.32 });
  }

  step(sprint) {
    this._stepAlt ^= 1;
    this._noise({
      freq: this._stepAlt ? 420 : 360, freqEnd: 120, dur: 0.07,
      vol: sprint ? 0.22 : 0.14, type: 'lowpass', q: 0.5, verb: 0.25, rate: 0.8 + Math.random() * 0.3,
    });
  }

  jump() { this._noise({ freq: 500, freqEnd: 180, dur: 0.09, vol: 0.15, type: 'lowpass' }); }
  land() { this._noise({ freq: 300, freqEnd: 90, dur: 0.12, vol: 0.3, type: 'lowpass', verb: 0.3 }); }

  hit() { this._tone({ type: 'square', freq: 2100, freqEnd: 1500, dur: 0.045, vol: 0.12, verb: 0 }); }
  kill() {
    this._tone({ type: 'square', freq: 1400, freqEnd: 2100, dur: 0.07, vol: 0.14, verb: 0 });
    this._tone({ type: 'square', freq: 2100, dur: 0.06, vol: 0.12, delay: 0.06, verb: 0 });
  }

  hurt() {
    this._tone({ type: 'sine', freq: 140, freqEnd: 55, dur: 0.22, vol: 0.5, verb: 0.2 });
    this._noise({ freq: 800, freqEnd: 200, dur: 0.15, vol: 0.25, verb: 0.2 });
  }

  bolt() {
    this._tone({ type: 'sawtooth', freq: 1400, freqEnd: 240, dur: 0.16, vol: 0.16, verb: 0.3 });
    this._noise({ freq: 3000, freqEnd: 900, dur: 0.1, vol: 0.12, verb: 0.3 });
  }

  charge() { this._tone({ type: 'sine', freq: 320, freqEnd: 1150, dur: 0.45, vol: 0.1, attack: 0.1, verb: 0.2 }); }

  explosion() {
    this._noise({ freq: 2400, freqEnd: 120, dur: 0.5, vol: 0.7, type: 'lowpass', verb: 0.5 });
    this._tone({ type: 'sine', freq: 110, freqEnd: 34, dur: 0.5, vol: 0.65, verb: 0.4 });
    this._noise({ freq: 5000, dur: 0.06, vol: 0.3, verb: 0.3 });
  }

  pickup() {
    this._tone({ type: 'sine', freq: 620, dur: 0.08, vol: 0.2, verb: 0.1 });
    this._tone({ type: 'sine', freq: 930, dur: 0.12, vol: 0.2, delay: 0.07, verb: 0.1 });
  }

  waveStart() {
    this._tone({ type: 'square', freq: 440, dur: 0.16, vol: 0.12, verb: 0.3 });
    this._tone({ type: 'square', freq: 587, dur: 0.22, vol: 0.12, delay: 0.18, verb: 0.3 });
  }

  death() {
    this._tone({ type: 'sawtooth', freq: 220, freqEnd: 40, dur: 1.2, vol: 0.3, verb: 0.5 });
    this._noise({ freq: 1200, freqEnd: 100, dur: 1.0, vol: 0.3, type: 'lowpass', verb: 0.5 });
  }

  _startAmbience() {
    const ctx = this.ctx;
    // low room tone: looped filtered noise
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    // electrical hum
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth'; hum.frequency.value = 60;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass'; hf.frequency.value = 180;
    const hg = ctx.createGain(); hg.gain.value = 0.012;
    hum.connect(hf).connect(hg).connect(this.master);
    hum.start();
    this.ambienceGain = g;
  }

  // one shared drone hum whose volume follows the nearest drone
  setDroneHum(level) {
    if (!this.ctx) return;
    if (!this._hum) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = 148;
      const o2 = ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = 296.5;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 300; f.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g);
      this._out(g, 0.25);
      o.start(); o2.start();
      this._hum = g;
    }
    this._hum.gain.setTargetAtTime(Math.min(0.14, level * 0.14), this.ctx.currentTime, 0.15);
  }
}