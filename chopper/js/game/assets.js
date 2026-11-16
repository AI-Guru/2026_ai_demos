/**
 * Asset loading + procedural sprite generation.
 * Terrain binaries and voxel-model sprite sheets come from the Python pipeline;
 * rotors, shadows, particles, tracers and clouds are generated here at boot.
 */

export const SKIES = {
  day: {
    top: [62, 116, 196], horizon: [188, 212, 234], haze: [198, 214, 228],
    sunAz: (225 * Math.PI) / 180, sunEl: (42 * Math.PI) / 180,
    sunColor: [255, 250, 224], sunSize: 82, fogDensity: 0.00038,
  },
  dusk: {
    top: [40, 34, 72], horizon: [255, 148, 78], haze: [190, 126, 98],
    sunAz: (282 * Math.PI) / 180, sunEl: (5.5 * Math.PI) / 180,
    sunColor: [255, 168, 88], sunSize: 130, fogDensity: 0.00055,
  },
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function extract(c, ppm, ax, ay) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return {
    pixels: new Uint32Array(d.data.buffer.slice(0)),
    pw: c.width, ph: c.height,
    ax: ax ?? c.width / 2, ay: ay ?? c.height / 2,
    ppm,
  };
}

function blob(c, x, y, r, rgb, a0) {
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a0})`);
  g.addColorStop(0.55, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a0 * 0.55})`);
  g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export class Assets {
  constructor() {
    this.manifest = null;
    this.modelMeta = new Map();
    this.sheets = new Map();   // name → {data: Uint32Array, w, h, meta}
    this.frames = new Map();   // cache key → sprite
    this.terrains = new Map();
    this.sprites = {};
    this._genProcedural();
  }

  async loadManifest() {
    const r = await fetch('assets/manifest.json');
    this.manifest = await r.json();
    return this.manifest;
  }

  async loadTerrain(id) {
    if (this.terrains.has(id)) return this.terrains.get(id);
    const entry = this.manifest.terrain.find((t) => t.id === id);
    const [hb, cb, meta] = await Promise.all([
      fetch('assets/' + entry.height).then((r) => r.arrayBuffer()),
      fetch('assets/' + entry.color).then((r) => r.arrayBuffer()),
      fetch('assets/' + entry.meta).then((r) => r.json()),
    ]);
    const mapImg = await this._image('assets/' + entry.map);
    const t = {
      height: new Uint8Array(hb),
      color: new Uint8Array(cb),
      size: meta.size, cell: meta.cell,
      heightScale: meta.heightScale,
      waterLevel: meta.waterLevel,
      sky: SKIES[meta.sky] ?? SKIES.day,
      meta, mapImg,
    };
    this.terrains.set(id, t);
    return t;
  }

  _image(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  async loadModel(name) {
    if (this.modelMeta.has(name)) return this.modelMeta.get(name);
    const p = this.manifest.models[name];
    if (!p) throw new Error('unknown model ' + name);
    const meta = await fetch('assets/' + p).then((r) => r.json());
    this.modelMeta.set(name, meta);
    return meta;
  }

  async _sheet(name) {
    if (this.sheets.has(name)) return this.sheets.get(name);
    const meta = await this.loadModel(name);
    const img = await this._image('assets/models/' + meta.sheet);
    const c = canvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    const s = { data: new Uint32Array(d.data.buffer.slice(0)), w: c.width, h: c.height, meta };
    this.sheets.set(name, s);
    return s;
  }

  /** Extract one animation frame; wreck=true bakes a burnt-dark variant. */
  async modelFrame(name, yawIdx, elevIdx, wreck = false) {
    const key = `${name}:${yawIdx}:${elevIdx}:${wreck ? 1 : 0}`;
    if (this.frames.has(key)) return this.frames.get(key);
    const s = await this._sheet(name);
    const m = s.meta;
    const fw = m.frameW, fh = m.frameH;
    const ox = yawIdx * fw, oy = elevIdx * fh;
    const out = new Uint32Array(fw * fh);
    for (let y = 0; y < fh; y++) {
      const srcRow = (oy + y) * s.w + ox;
      const dstRow = y * fw;
      for (let x = 0; x < fw; x++) {
        let c = s.data[srcRow + x];
        if (wreck && c >>> 24) {
          const r = ((c & 255) * 0.3) | 0;
          const g = (((c >> 8) & 255) * 0.28) | 0;
          const b = (((c >> 16) & 255) * 0.26) | 0;
          c = (c & 0xff000000) | (b << 16) | (g << 8) | r;
        }
        out[dstRow + x] = c;
      }
    }
    const sprite = { pixels: out, pw: fw, ph: fh, ax: m.anchorX, ay: m.anchorY, ppm: m.pxPerMeter };
    if (this.frames.size > 900) this.frames.clear(); // crude cap
    this.frames.set(key, sprite);
    return sprite;
  }

  /** Choose yaw/elevation frame indices for a world-relative view. */
  pickFrame(meta, relBearingDeg, elevDeg) {
    const cols = meta.cols;
    let yi = Math.round(relBearingDeg / meta.yawStep) % cols;
    if (yi < 0) yi += cols;
    let ei = 0, best = 1e9;
    for (let i = 0; i < meta.elevations.length; i++) {
      const d = Math.abs(meta.elevations[i] - elevDeg);
      if (d < best) { best = d; ei = i; }
    }
    return { yi, ei };
  }

  // ---------------- procedural sprites ----------------
  _genProcedural() {
    const S = this.sprites;

    // particle blobs
    const mk = (size, fn, ppm) => { const c = canvas(size, size); fn(c); return extract(c, ppm); };
    S.smoke = mk(32, (c) => {
      blob(c, 16, 16, 15, [118, 116, 112], 0.5);
      blob(c, 11, 13, 9, [128, 126, 122], 0.35);
      blob(c, 21, 19, 10, [105, 103, 100], 0.35);
    }, 8);
    S.darksmoke = mk(32, (c) => {
      blob(c, 16, 16, 15, [46, 43, 40], 0.62);
      blob(c, 12, 12, 9, [58, 54, 50], 0.4);
      blob(c, 21, 20, 9, [36, 33, 30], 0.4);
    }, 8);
    S.dust = mk(32, (c) => {
      blob(c, 16, 16, 15, [152, 132, 100], 0.5);
      blob(c, 12, 18, 9, [164, 144, 110], 0.35);
    }, 8);
    S.fire = [
      mk(32, (c) => { blob(c, 16, 16, 15, [255, 236, 170], 0.95); blob(c, 16, 16, 9, [255, 250, 225], 0.9); }, 8),
      mk(32, (c) => { blob(c, 16, 16, 15, [255, 150, 44], 0.9); blob(c, 14, 14, 8, [255, 210, 110], 0.7); }, 8),
      mk(32, (c) => { blob(c, 16, 16, 15, [186, 62, 24], 0.8); blob(c, 18, 18, 8, [120, 40, 18], 0.6); }, 8),
    ];
    S.spark = mk(8, (c) => { blob(c, 4, 4, 4, [255, 232, 160], 1); }, 6);
    S.flash = mk(64, (c) => { blob(c, 32, 32, 31, [255, 248, 226], 1); blob(c, 32, 32, 14, [255, 255, 250], 1); }, 8);

    // tracers / projectiles
    const cap = (w, h, rgb, ppm) => {
      const c = canvas(w, h);
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      g.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`);
      g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, h * 0.25, w, h * 0.5);
      blob(c, w / 2, h / 2, h * 0.7, rgb, 0.9);
      return extract(c, ppm);
    };
    S.tracerP = cap(12, 5, [255, 240, 168], 6);
    S.tracerE = cap(12, 5, [255, 122, 58], 6);
    S.rocket = cap(14, 5, [210, 200, 170], 5);
    S.flare = mk(12, (c) => { blob(c, 6, 6, 6, [255, 244, 200], 1); blob(c, 6, 6, 3, [255, 255, 255], 1); }, 6);

    // missile body (horizontal, nose right)
    {
      const c = canvas(22, 8);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#b9bec4';
      ctx.fillRect(3, 2.5, 15, 3);
      ctx.fillStyle = '#7d838a';
      ctx.beginPath(); ctx.moveTo(18, 2.5); ctx.lineTo(21.5, 4); ctx.lineTo(18, 5.5); ctx.fill();
      ctx.fillStyle = '#5a6068';
      ctx.fillRect(4, 0.5, 3, 7); // fins
      ctx.fillRect(13, 1, 2, 6);
      S.missile = extract(c, 5);
    }

    // shadows: squash bands (view elevation)
    S.shadow = [0.22, 0.42, 0.68, 0.95].map((sq) => {
      const c = canvas(64, 64);
      const ctx = c.getContext('2d');
      ctx.save();
      ctx.translate(32, 32); ctx.scale(1, sq);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      g.addColorStop(0, 'rgba(10,12,8,0.5)');
      g.addColorStop(0.7, 'rgba(10,12,8,0.28)');
      g.addColorStop(1, 'rgba(10,12,8,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return extract(c, 32); // ppm 32 → 2m wide; caller scales ppm by 1/radius
    });

    // main rotor: 16 rotation frames × 5 elevation squashes
    S.rotor = [];
    const squashes = [0.14, 0.34, 0.64, 0.91, 1.0];
    for (const sq of squashes) {
      const row = [];
      for (let rot = 0; rot < 16; rot++) {
        const c = canvas(220, 220);
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.translate(110, 110); ctx.scale(1, sq);
        ctx.strokeStyle = 'rgba(210,214,210,0.10)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 99, 0, Math.PI * 2); ctx.stroke();
        for (let k = 0; k < 4; k++) {
          const a = ((rot * 22.5 + k * 90) * Math.PI) / 180;
          // motion-blur sweep
          const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 100);
          g.addColorStop(0, 'rgba(52,54,50,0.02)');
          g.addColorStop(1, 'rgba(52,54,50,0.20)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 100, a - 0.62, a + 0.06);
          ctx.closePath(); ctx.fill();
          // blade
          ctx.save();
          ctx.rotate(a);
          ctx.fillStyle = 'rgba(38,40,36,0.55)';
          ctx.beginPath();
          ctx.moveTo(8, -1.6); ctx.lineTo(99, -2.6); ctx.lineTo(99, 2.6); ctx.lineTo(8, 1.6);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(30,30,28,0.95)';
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        row.push(extract(c, 100 / 6.5));
      }
      S.rotor.push(row);
    }

    // tail rotor: 8 rotations × 5 width factors (view aspect)
    S.tail = [];
    for (const wf of [0.16, 0.38, 0.62, 0.85, 1.0]) {
      const row = [];
      for (let rot = 0; rot < 8; rot++) {
        const c = canvas(48, 48);
        const ctx = c.getContext('2d');
        ctx.save();
        ctx.translate(24, 24); ctx.scale(wf, 1);
        for (let k = 0; k < 3; k++) {
          const a = ((rot * 45 + k * 120) * Math.PI) / 180;
          ctx.fillStyle = 'rgba(40,42,38,0.4)';
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 21, a - 0.8, a + 0.1); ctx.closePath(); ctx.fill();
          ctx.save(); ctx.rotate(a);
          ctx.fillStyle = 'rgba(30,32,28,0.6)';
          ctx.fillRect(3, -1.2, 18, 2.4);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(24,24,22,0.95)';
        ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        row.push(extract(c, 21 / 0.95));
      }
      S.tail.push(row);
    }

    // clouds
    const cloudSet = (rgb) => {
      const arr = [];
      for (let v = 0; v < 6; v++) {
        const c = canvas(256, 128);
        const rnd = mulberry(9000 + v);
        for (let i = 0; i < 14; i++) {
          const x = 40 + rnd() * 176;
          const y = 44 + rnd() * 44;
          const r = 18 + rnd() * 34;
          blob(c, x, y, r, rgb, 0.10 + rnd() * 0.12);
        }
        arr.push(extract(c, 0.8)); // 256px ≈ 320m
      }
      return arr;
    };
    S.clouds = cloudSet([255, 255, 255]);
    S.cloudsDusk = cloudSet([255, 196, 160]);
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}