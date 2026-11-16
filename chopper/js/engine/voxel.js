/**
 * Voxel Space renderer — the NovaLogic technique (Comanche, 1992).
 *
 * Pass 1: a heightmap + colormap is raycast per screen column, front to back.
 * Each sample projects to a screen Y; the vertical span between the previous
 * top (y-buffer) and the new projection is filled with the colormap color,
 * blended into distance haze. Nearer terrain occludes farther. Every drawn
 * span records (topY, distance) so we keep a coarse per-column depth profile.
 *
 * Pass 2: sprites (pre-rendered voxel models, particles, projectiles) are
 * composited far-to-near. Each sprite pixel is depth-tested against the
 * terrain profile of its column: visible only where the terrain surface seen
 * at that pixel is farther than the sprite. Transparent gaps therefore show
 * the terrain behind them correctly — the thing most voxel demos get wrong.
 *
 * Pure software rendering into a Uint32 pixel buffer (ImageData). No WebGL.
 */

const FOG_GAMMA = 1.12;
const MAXSEG = 256;

export class VoxelRenderer {
  constructor(width, height) {
    this.terrain = null;
    this.drawDist = 1500;
    this.fogDensity = 0.00038;
    this.time = 0;
    this.resize(width, height);
  }

  resize(width, height) {
    this.w = width | 0;
    this.h = height | 0;
    const ImageDataCtor =
      typeof ImageData !== 'undefined'
        ? ImageData
        : class {
            constructor(w, h) {
              this.width = w;
              this.height = h;
              this.data = new Uint8ClampedArray(w * h * 4);
            }
          };
    this.image = new ImageDataCtor(this.w, this.h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.ybuf = new Float32Array(this.w);
    // per-column terrain depth profile: (topY, zFar) pairs, tops descending
    this.segTop = new Float32Array(this.w * MAXSEG);
    this.segZ = new Float32Array(this.w * MAXSEG);
    this.segN = new Uint16Array(this.w);
    this.fov = (66 * Math.PI) / 180;
    this.focal = this.w / 2 / Math.tan(this.fov / 2);
    this.colAngle = new Float32Array(this.w);
    this.colInvCos = new Float32Array(this.w);
    this.colScale = new Float32Array(this.w); // focal / cos(offset)
    for (let x = 0; x < this.w; x++) {
      const off = Math.atan((x - this.w / 2 + 0.5) / this.focal);
      this.colAngle[x] = off;
      this.colInvCos[x] = 1 / Math.cos(off);
      this.colScale[x] = this.focal * this.colInvCos[x];
    }
    this._skyRows = new Uint32Array(this.h);
    this._fog = new Uint8Array(this.drawDist + 2);
    this._rebuildFog();
  }

  _rebuildFog() {
    for (let z = 0; z <= this.drawDist + 1; z++) {
      const f = 1 - Math.exp(-z * this.fogDensity);
      this._fog[z] = Math.min(255, (Math.pow(f, FOG_GAMMA) * 256) | 0);
    }
  }

  /**
   * terrain: {
   *   height: Uint8Array(size*size), color: Uint8Array(size*size*3) RGB,
   *   size, cell, heightScale, waterLevel,
   *   sky: { top:[r,g,b], horizon:[r,g,b], haze:[r,g,b],
   *          sunAz, sunEl, sunColor:[r,g,b], sunSize, fogDensity }
   * }
   */
  setTerrain(t) {
    this.terrain = t;
    const n = t.size * t.size;
    this.heightF = new Float32Array(n);
    for (let i = 0; i < n; i++) this.heightF[i] = t.height[i] * t.heightScale;
    this.color32 = new Uint32Array(n);
    const c = t.color;
    for (let i = 0; i < n; i++) {
      this.color32[i] = (255 << 24) | (c[i * 3 + 2] << 16) | (c[i * 3 + 1] << 8) | c[i * 3];
    }
    this.size = t.size;
    this.invCell = 1 / t.cell;
    this.worldSize = t.size * t.cell;
    this.waterLevel = t.waterLevel;
    this.sky = t.sky;
    this.fogDensity = t.sky.fogDensity ?? 0.00038;
    this.haze32 = this._pack(t.sky.haze);
    this.hazeR = t.sky.haze[0];
    this.hazeG = t.sky.haze[1];
    this.hazeB = t.sky.haze[2];
    this._rebuildFog();
    this._skyRows = new Uint32Array(this.h);
  }

  _pack(rgb) {
    return (255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
  }

  /** Camera-space projection shared by HUD, particles and sprite bucketing. */
  project(x, y, z, cam) {
    const dx = x - cam.x;
    const dz = z - cam.z;
    const sh = Math.sin(cam.heading);
    const ch = Math.cos(cam.heading);
    const depth = dx * sh + dz * ch; // along view axis
    if (depth < 0.3) return null;
    const lat = dx * ch - dz * sh;
    const scale = this.focal / depth;
    const horizonY = this.h / 2 + Math.tan(cam.pitch) * this.focal;
    return {
      x: this.w / 2 + lat * scale,
      y: horizonY + (cam.y - y) * scale,
      scale,
      depth,
      dist: Math.sqrt(dx * dx + dz * dz),
      horizonY,
    };
  }

  horizonY(cam) {
    return this.h / 2 + Math.tan(cam.pitch) * this.focal;
  }

  /**
   * sprites: array of {
   *   pixels: Uint32Array (pw*ph, ABGR), pw, ph,
   *   ax, ay: anchor pixel in frame, ppm: pixels per meter,
   *   x, y, z: world position of anchor,
   *   alpha: 0..1 global multiplier (optional),
   *   noFog: bool (optional)
   * }
   */
  render(cam, sprites) {
    const { w, h, buf, ybuf } = this;
    const t = this.terrain;
    if (!t) return;
    this.time += 1 / 60;
    const horizonY = this.horizonY(cam);
    const sky = this.sky;

    // ---- sky ----
    const top = sky.top;
    const hor = sky.horizon;
    const hz = horizonY > 1 ? horizonY : 1;
    for (let y = 0; y < h; y++) {
      let r, g, b;
      if (y <= horizonY) {
        const u = Math.pow(y / hz, 0.72);
        r = top[0] + (hor[0] - top[0]) * u;
        g = top[1] + (hor[1] - top[1]) * u;
        b = top[2] + (hor[2] - top[2]) * u;
      } else {
        r = sky.haze[0];
        g = sky.haze[1];
        b = sky.haze[2];
      }
      this._skyRows[y] = (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
    }
    for (let y = 0; y < h; y++) buf.fill(this._skyRows[y], y * w, (y + 1) * w);

    // sun glow
    let azDiff = sky.sunAz - cam.heading;
    while (azDiff > Math.PI) azDiff -= 2 * Math.PI;
    while (azDiff < -Math.PI) azDiff += 2 * Math.PI;
    if (Math.abs(azDiff) < this.fov / 2 + 0.35) {
      const sx = w / 2 + Math.tan(azDiff) * this.focal;
      const sy = horizonY - Math.tan(sky.sunEl) * this.focal;
      const R = sky.sunSize ?? 90;
      const sc = sky.sunColor;
      const x0 = Math.max(0, (sx - R) | 0);
      const x1 = Math.min(w - 1, (sx + R) | 0);
      const y0 = Math.max(0, (sy - R) | 0);
      const y1 = Math.min(h - 1, (sy + R) | 0);
      const invR2 = 1 / (R * R);
      for (let y = y0; y <= y1; y++) {
        const dy = y - sy;
        const row = y * w;
        for (let x = x0; x <= x1; x++) {
          const dx = x - sx;
          const d2 = (dx * dx + dy * dy) * invR2;
          if (d2 >= 1) continue;
          const fall = (1 - d2) * (1 - d2);
          const core = d2 < 0.02 ? 1 : 0;
          const add = fall * 0.85 + core * 0.9;
          const i = row + x;
          const c = buf[i];
          const r = Math.min(255, (c & 255) + sc[0] * add);
          const g = Math.min(255, ((c >> 8) & 255) + sc[1] * add);
          const b = Math.min(255, ((c >> 16) & 255) + sc[2] * add);
          buf[i] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
    }

    // ---- pass 1: terrain march, recording depth profiles ----
    const heightF = this.heightF;
    const color32 = this.color32;
    const size = this.size;
    const invCell = this.invCell;
    const worldSize = this.worldSize;
    const camY = cam.y;
    const camX = cam.x;
    const camZ = cam.z;
    const heading = cam.heading;
    const fog = this._fog;
    const hazeR = this.hazeR;
    const hazeG = this.hazeG;
    const hazeB = this.hazeB;
    const segTop = this.segTop;
    const segZ = this.segZ;
    const segN = this.segN;
    const dz0 = 0.5;
    const ddz = 0.055;
    const drawDist = this.drawDist;

    for (let x = 0; x < w; x++) {
      const ang = heading + this.colAngle[x];
      const rx = Math.sin(ang);
      const rz = Math.cos(ang);
      const scaleCol = this.colScale[x];
      let yTop = h;
      let ns = 0;
      const segBase = x * MAXSEG;
      let z = 0.7;
      let dz = dz0;
      while (z < drawDist) {
        let wx = camX + rx * z;
        let wz = camZ + rz * z;
        if (wx < 0) wx = 0;
        else if (wx >= worldSize) wx = worldSize - 0.01;
        if (wz < 0) wz = 0;
        else if (wz >= worldSize) wz = worldSize - 0.01;
        const ix = (wx * invCell) | 0;
        const iz = (wz * invCell) | 0;
        const idx = iz * size + ix;
        const hgt = heightF[idx];
        const sy = horizonY + (camY - hgt) * (scaleCol / z);
        if (sy < yTop) {
          const topI = sy < 0 ? 0 : sy | 0;
          const bot = yTop > h ? h : yTop | 0;
          let c = color32[idx];
          const f = fog[z | 0];
          if (f > 0) {
            const invF = 256 - f;
            const r = (((c & 255) * invF + hazeR * f) >> 8);
            const g = ((((c >> 8) & 255) * invF + hazeG * f) >> 8);
            const b = ((((c >> 16) & 255) * invF + hazeB * f) >> 8);
            c = (255 << 24) | (b << 16) | (g << 8) | r;
          }
          for (let y = topI; y < bot; y++) buf[y * w + x] = c;
          if (ns < MAXSEG) {
            segTop[segBase + ns] = sy;
            segZ[segBase + ns] = z;
            ns++;
          }
          yTop = sy;
        }
        z += dz;
        dz += ddz;
      }
      // ground beyond draw distance fades into haze up to the horizon
      if (yTop > horizonY) {
        const topI = Math.max(0, horizonY | 0);
        const bot = Math.min(h, yTop | 0);
        for (let y = topI; y < bot; y++) buf[y * w + x] = this.haze32;
        if (ns < MAXSEG) {
          segTop[segBase + ns] = horizonY;
          segZ[segBase + ns] = drawDist * 4; // "far ground" placeholder
          ns++;
        }
      }
      segN[x] = ns;
      ybuf[x] = yTop;
    }

    // ---- pass 2: sprites far → near, per-pixel terrain depth test ----
    if (sprites && sprites.length) {
      const entries = [];
      for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        const dx = s.x - cam.x;
        const dz = s.z - cam.z;
        const sh = Math.sin(heading);
        const ch = Math.cos(heading);
        const depth = dx * sh + dz * ch;
        if (depth < 1 || depth > drawDist * 1.04) continue;
        const lat = dx * ch - dz * sh;
        const scale = this.focal / depth;
        const sx = w / 2 + lat * scale;
        const sy = horizonY + (camY - s.y) * scale;
        const k = scale / s.ppm;
        const sw = s.pw * k;
        const shh = s.ph * k;
        const x0 = sx - s.ax * k;
        const y0 = sy - s.ay * k;
        if (x0 + sw < 0 || x0 >= w || y0 + shh < 0 || y0 >= h) continue;
        if (sw < 0.7 || shh < 0.7) continue;
        entries.push({
          s, depth, x0, y0, sw, sh: shh,
          suStep: s.pw / sw, svStep: s.ph / shh,
          fog: s.noFog ? 0 : fog[Math.min(drawDist + 1, depth | 0)],
          alpha: s.alpha ?? 1,
          cx0: Math.max(0, x0 | 0),
          cx1: Math.min(w - 1, (x0 + sw) | 0),
          cy0: Math.max(0, y0 | 0),
          cy1: Math.min(h, (y0 + shh) | 0),
        });
      }
      entries.sort((a, b) => b.depth - a.depth);

      for (let ei = 0; ei < entries.length; ei++) {
        const e = entries[ei];
        const s = e.s;
        const pix = s.pixels;
        const pw = s.pw;
        const ph = s.ph;
        const f = e.fog;
        const invF = 256 - f;
        const ga = e.alpha;
        const depth = e.depth;
        for (let x = e.cx0; x <= e.cx1; x++) {
          const su = Math.min(pw - 1, Math.max(0, ((x - e.x0) * e.suStep) | 0));
          const ns = segN[x];
          const segBase = x * MAXSEG;
          for (let y = e.cy0; y < e.cy1; y++) {
            const sv = Math.min(ph - 1, Math.max(0, ((y - e.y0) * e.svStep) | 0));
            const c = pix[sv * pw + su];
            const a = (c >>> 24) * ga;
            if (a < 8) continue;
            // terrain depth at this pixel: segments have descending tops
            let tz = Infinity;
            if (ns > 0 && y >= segTop[segBase + ns - 1]) {
              let lo = 0, hi = ns - 1;
              while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (segTop[segBase + mid] <= y) lo = mid;
                else hi = mid - 1;
              }
              tz = segZ[segBase + lo];
            }
            if (depth > tz + 0.5) continue; // terrain in front hides sprite
            let r = c & 255;
            let g = (c >> 8) & 255;
            let b = (c >> 16) & 255;
            if (f > 0) {
              r = (r * invF + hazeR * f) >> 8;
              g = (g * invF + hazeG * f) >> 8;
              b = (b * invF + hazeB * f) >> 8;
            }
            const i = y * w + x;
            if (a >= 250) {
              buf[i] = (255 << 24) | (b << 16) | (g << 8) | r;
            } else {
              const d = buf[i];
              const ia = 256 - a;
              r = (r * a + (d & 255) * ia) >> 8;
              g = (g * a + ((d >> 8) & 255) * ia) >> 8;
              b = (b * a + ((d >> 16) & 255) * ia) >> 8;
              buf[i] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
          }
        }
      }
    }
  }

  /** The internal ImageData (main.js puts it on a canvas). */
  getImage() {
    return this.image;
  }
}