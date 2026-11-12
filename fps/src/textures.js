// ============================================================
// Procedural PBR texture factory — seamless albedo / normal /
// roughness-metalness maps generated at load time. No assets.
// ============================================================
import * as THREE from 'three';

// ---------- tileable value noise ----------
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
// periodic value noise: lattice wraps at `period` so textures tile
function vnoise(x, y, seed, period) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const w = (a) => ((a % period) + period) % period;
  const x0 = w(ix), x1 = w(ix + 1), y0 = w(iy), y1 = w(iy + 1);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, oct, seed, period) {
  let v = 0, amp = 0.5, f = 1, p = period, tot = 0;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f, seed + i * 101, p);
    tot += amp; amp *= 0.5; f *= 2; p *= 2;
  }
  return v / tot;
}
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- map builder ----------
// fn(u, v, x, y) -> { r,g,b (0..1), h (height 0..1), rough, metal }
// postDraw(ctx, size) optionally paints decals (stencils) onto the albedo
function buildMaps(size, fn, normalStrength = 2.0, postDraw = null) {
  const alb = new Uint8ClampedArray(size * size * 4);
  const orm = new Uint8ClampedArray(size * size * 4);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const o = fn(x / size, y / size, x, y);
      alb[i * 4] = o.r * 255; alb[i * 4 + 1] = o.g * 255; alb[i * 4 + 2] = o.b * 255; alb[i * 4 + 3] = 255;
      orm[i * 4] = 255; orm[i * 4 + 1] = clamp01(o.rough) * 255; orm[i * 4 + 2] = clamp01(o.metal) * 255; orm[i * 4 + 3] = 255;
      hgt[i] = o.h;
    }
  }
  // normal map from height (OpenGL convention, wrapped sampling)
  const nrm = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = hgt[y * size + ((x - 1 + size) % size)];
      const xr = hgt[y * size + ((x + 1) % size)];
      const yu = hgt[((y - 1 + size) % size) * size + x];
      const yd = hgt[((y + 1) % size) * size + x];
      let nx = (xl - xr) * normalStrength;
      let ny = (yd - yu) * normalStrength;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nrm[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;
    }
  }
  const toTex = (data, srgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
    if (srgb && postDraw) postDraw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: toTex(alb, true), normalMap: toTex(nrm, false), ormMap: toTex(orm, false) };
}

// ---------- material definitions ----------
function concreteFn(u, v, x, y) {
  const S = 512;
  const base = fbm(u * 6, v * 6, 5, 11, 6);
  const fine = fbm(u * 40, v * 40, 3, 23, 40);
  const stain = fbm(u * 2.5, v * 2.5, 4, 47, 3);
  let g = 0.46 + (base - 0.5) * 0.16 + (fine - 0.5) * 0.07;
  // dark water stains, bottom-heavy
  const st = clamp01((stain - 0.52) * 3.2) * (0.35 + 0.65 * v);
  g -= st * 0.14;
  // formwork panel seams every 256px + tie holes
  const seamX = Math.min(x % 256, 256 - (x % 256));
  const seamY = Math.min(y % 256, 256 - (y % 256));
  const seam = Math.min(seamX, seamY);
  let h = 0.5 + (base - 0.5) * 0.35 + (fine - 0.5) * 0.18;
  if (seam < 2) { g -= 0.12; h -= 0.3; }
  // tie holes at panel centers
  const hx = (x % 256) - 128, hy = (y % 256) - 128;
  const hd = Math.sqrt(hx * hx + hy * hy);
  if (hd < 7) { g -= 0.18 * (1 - hd / 7); h -= 0.4 * (1 - hd / 7); }
  // speckle
  const sp = hash2(x, y, 91);
  if (sp > 0.994) g += 0.12; else if (sp < 0.006) g -= 0.12;
  g = clamp01(g);
  const warm = 0.015;
  return { r: g + warm, g: g + warm * 0.6, b: g, h: clamp01(h), rough: 0.82 + (fine - 0.5) * 0.16 + st * 0.1, metal: 0.0 };
}

function floorFn(u, v, x, y) {
  const T = 128; // 4x4 tiles
  const tx = x % T, ty = y % T;
  const tileId = Math.floor(x / T) + Math.floor(y / T) * 4;
  const tint = (hash2(tileId, 7, 55) - 0.5) * 0.07;
  const base = fbm(u * 8, v * 8, 5, 31, 8);
  const fine = fbm(u * 48, v * 48, 3, 77, 48);
  const wear = fbm(u * 3, v * 3, 4, 99, 3);
  let g = 0.24 + tint + (base - 0.5) * 0.09 + (fine - 0.5) * 0.045;
  // polished wear patches — smoother & slightly lighter
  const w = clamp01((wear - 0.55) * 3.5);
  g += w * 0.03;
  // grout lines
  const gx = Math.min(tx, T - tx), gy = Math.min(ty, T - ty);
  const grout = Math.min(gx, gy);
  let h = 0.55 + (base - 0.5) * 0.2 + (fine - 0.5) * 0.1;
  if (grout < 3) { g -= 0.13 * (1 - grout / 3); h -= 0.45 * (1 - grout / 3); }
  // hairline cracks
  const cr = fbm(u * 5 + 3.7, v * 5 + 1.3, 4, 133, 5);
  if (Math.abs(cr - 0.5) < 0.003) { g -= 0.06; h -= 0.06; }
  // dirt accumulation near grout
  if (grout < 14) g -= 0.03 * (1 - grout / 14);
  g = clamp01(g);
  const rough = clamp01(0.5 - w * 0.3 + (fine - 0.5) * 0.18 + (grout < 3 ? 0.25 : 0));
  return { r: g * 0.98, g: g, b: g * 1.04, h: clamp01(h), rough, metal: 0.02 };
}

function ceilingFn(u, v, x, y) {
  const o = concreteFn(u, v, x, y);
  return { r: o.r * 0.62, g: o.g * 0.64, b: o.b * 0.68, h: o.h, rough: 0.9, metal: 0 };
}

function metalFn(u, v, x, y) {
  const P = 256; // 2x2 panels
  const px = x % P, py = y % P;
  const panelId = Math.floor(x / P) + Math.floor(y / P) * 2;
  const tint = (hash2(panelId, 3, 21) - 0.5) * 0.05;
  // brushed horizontal grain
  const brush = vnoise(u * 4, v * 220, 61, 220) * 0.5 + fbm(u * 10, v * 10, 4, 17, 10) * 0.5;
  let g = 0.36 + tint + (brush - 0.5) * 0.08;
  let h = 0.5 + (brush - 0.5) * 0.08;
  let rough = 0.38 + (brush - 0.5) * 0.22;
  let metal = 0.92;
  // panel seams
  const sx = Math.min(px, P - px), sy = Math.min(py, P - py);
  const seam = Math.min(sx, sy);
  if (seam < 3) { g -= 0.14 * (1 - seam / 3); h -= 0.4 * (1 - seam / 3); rough += 0.2; }
  // rivets near panel corners
  const rx = px < P / 2 ? px - 16 : px - (P - 16);
  const ry = py < P / 2 ? py - 16 : py - (P - 16);
  const rd = Math.sqrt(rx * rx + ry * ry);
  if (rd < 5) { g += 0.08 * (1 - rd / 5); h += 0.35 * (1 - rd / 5); rough -= 0.1; }
  // scratches
  const scr = hash2(Math.floor(x / 2), Math.floor(y / 40), 83);
  if (scr > 0.985 && (y % 40) < 1) { g += 0.14; rough -= 0.15; }
  // rust creeping from seams
  const rustN = fbm(u * 7, v * 7, 5, 119, 7);
  const seamProx = clamp01(1 - seam / 40);
  const rust = clamp01((rustN - 0.58) * 4 + seamProx * 0.35 - 0.25);
  if (rust > 0) {
    const rr = 0.36 + (rustN - 0.5) * 0.2, rg = 0.19 + (rustN - 0.5) * 0.1, rb = 0.10;
    g = lerp(g, rr, rust); // reuse channels below
    return {
      r: lerp(0.36 + tint, rr, rust), g: lerp(g, rg, rust), b: lerp(0.38 + tint, rb, rust),
      h: clamp01(h + rust * 0.25), rough: clamp01(rough + rust * 0.4), metal: clamp01(metal - rust * 0.75),
    };
  }
  return { r: g * 0.96, g: g, b: g * 1.06, h: clamp01(h), rough: clamp01(rough), metal };
}

function crateFn(u, v, x, y) {
  const S = 512;
  const base = fbm(u * 6, v * 6, 4, 201, 6);
  const fine = fbm(u * 30, v * 30, 3, 202, 30);
  // olive drab paint
  let r = 0.30 + (base - 0.5) * 0.07, g = 0.33 + (base - 0.5) * 0.07, b = 0.22 + (base - 0.5) * 0.05;
  let h = 0.5 + (fine - 0.5) * 0.1;
  let rough = 0.6 + (fine - 0.5) * 0.2, metal = 0.25;
  // vertical reinforcing ribs
  const rib = x % 128;
  if (rib < 14 || rib > 114) { const t = rib < 14 ? rib / 14 : (128 - rib) / 14; h += 0.3 * Math.sin(t * Math.PI); r *= 0.9; g *= 0.9; b *= 0.9; }
  // edge wear — bare metal at borders
  const ex = Math.min(x, S - x), ey = Math.min(y, S - y);
  const edge = Math.min(ex, ey);
  const wearN = fbm(u * 20, v * 20, 3, 203, 20);
  const wear = clamp01((1 - edge / 22) * 1.4 + (wearN - 0.6) * 1.2) * clamp01(1 - edge / 30);
  if (wear > 0.05) {
    const m = 0.42 + (wearN - 0.5) * 0.15;
    r = lerp(r, m, wear); g = lerp(g, m, wear); b = lerp(b, m * 1.05, wear);
    rough = lerp(rough, 0.35, wear); metal = lerp(metal, 0.9, wear);
  }
  return { r, g, b, h: clamp01(h), rough: clamp01(rough), metal: clamp01(metal) };
}

function crateStencil(ctx, s) {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(-0.015);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(222, 226, 210, 0.62)';
  ctx.font = '900 58px "Arial Black", Arial, sans-serif';
  ctx.fillText('SECTOR-07', 0, -52);
  ctx.font = '700 34px Arial, sans-serif';
  ctx.fillStyle = 'rgba(222, 226, 210, 0.45)';
  ctx.fillText('MUNITIONS · 5.56', 0, 4);
  ctx.strokeStyle = 'rgba(222, 226, 210, 0.4)';
  ctx.lineWidth = 4;
  ctx.strokeRect(-168, -104, 336, 150);
  // up-arrows
  ctx.fillStyle = 'rgba(222, 226, 210, 0.4)';
  for (const ax of [-120, 120]) {
    ctx.beginPath();
    ctx.moveTo(ax, 118); ctx.lineTo(ax - 16, 146); ctx.lineTo(ax - 6, 146);
    ctx.lineTo(ax - 6, 172); ctx.lineTo(ax + 6, 172); ctx.lineTo(ax + 6, 146);
    ctx.lineTo(ax + 16, 146); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // paint chips over the stencil
  ctx.fillStyle = 'rgba(58, 62, 44, 0.5)';
  for (let i = 0; i < 26; i++) {
    const x = hash2(i, 5, 77) * s, y = hash2(i, 6, 77) * s;
    ctx.fillRect(x, y, 2 + hash2(i, 7, 77) * 7, 1 + hash2(i, 8, 77) * 3);
  }
}

function hazardFn(u, v, x, y) {
  const stripe = ((x + y) % 128) < 64;
  const wear = fbm(u * 10, v * 10, 4, 301, 10);
  const w = clamp01((wear - 0.6) * 3);
  let r, g, b;
  if (stripe) { r = 0.75; g = 0.58; b = 0.08; } else { r = 0.08; g = 0.08; b = 0.09; }
  r = lerp(r, 0.3, w * 0.6); g = lerp(g, 0.28, w * 0.6); b = lerp(b, 0.25, w * 0.6);
  return { r, g, b, h: 0.5 + (wear - 0.5) * 0.1, rough: 0.55 + w * 0.3, metal: 0.1 };
}

// ---------- sprite textures ----------
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function radial(size, stops) {
  return canvasTex(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
}

function makeBulletHole() {
  return canvasTex(64, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(5,5,6,0.98)');
    g.addColorStop(0.22, 'rgba(10,10,12,0.95)');
    g.addColorStop(0.4, 'rgba(30,28,26,0.55)');
    g.addColorStop(0.7, 'rgba(60,58,55,0.18)');
    g.addColorStop(1, 'rgba(80,78,75,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    // cracks
    ctx.strokeStyle = 'rgba(15,14,13,0.6)'; ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + hash2(i, 1, 5) * 0.6;
      const len = 8 + hash2(i, 2, 5) * 14;
      ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * 4, c + Math.sin(a) * 4);
      ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len); ctx.stroke();
    }
    // bright rim
    ctx.strokeStyle = 'rgba(190,185,175,0.35)';
    ctx.beginPath(); ctx.arc(c, c, 6.5, 0, Math.PI * 2); ctx.stroke();
  });
}

function makeMuzzle() {
  return canvasTex(128, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.18, 'rgba(255,220,150,0.95)');
    g.addColorStop(0.45, 'rgba(255,140,40,0.45)');
    g.addColorStop(1, 'rgba(255,80,10,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    // star spikes
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const len = c * (0.65 + hash2(i, 9, 3) * 0.35);
      const grad = ctx.createLinearGradient(c, c, c + Math.cos(a) * len, c + Math.sin(a) * len);
      grad.addColorStop(0, 'rgba(255,240,200,0.9)');
      grad.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len); ctx.stroke();
    }
  });
}

function makeSmoke() {
  return canvasTex(128, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s, v = y / s;
      const dx = u - 0.5, dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const n = fbm(u * 5, v * 5, 4, 401, 5);
      const a = clamp01((1 - d) * 1.6) * (0.45 + n * 0.55);
      const i = (y * s + x) * 4;
      const g = 160 + n * 60;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

function makeSign() {
  return canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#2a2e33'; ctx.fillRect(0, 0, s, s);
    const n = fbm(0, 0, 1, 1, 1); // seed noise via per-pixel below
    const img = ctx.getImageData(0, 0, s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = fbm(x / s * 8, y / s * 8, 4, 501, 8);
      const i = (y * s + x) * 4;
      const m = 0.85 + v * 0.3;
      img.data[i] *= m; img.data[i + 1] *= m; img.data[i + 2] *= m;
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(180,190,200,0.5)'; ctx.lineWidth = 6;
    ctx.strokeRect(18, 18, s - 36, s - 36);
    ctx.fillStyle = 'rgba(215,225,235,0.88)';
    ctx.font = '900 210px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('07', s / 2, s / 2 - 28);
    ctx.font = '700 40px Arial, sans-serif';
    ctx.fillStyle = 'rgba(215,225,235,0.6)';
    ctx.fillText('SECTOR', s / 2, s / 2 + 128);
    ctx.font = '700 22px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,180,80,0.75)';
    ctx.fillText('AUTHORIZED PERSONNEL ONLY', s / 2, s / 2 + 176);
    // grime
    ctx.fillStyle = 'rgba(20,18,15,0.25)';
    for (let i = 0; i < 40; i++) {
      const x = hash2(i, 1, 9) * s, y = hash2(i, 2, 9) * s, r = 4 + hash2(i, 3, 9) * 26;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}

export function createTextures() {
  const S = 512;
  const tex = {
    concrete: buildMaps(S, concreteFn, 2.2),
    floor: buildMaps(S, floorFn, 2.6),
    ceiling: buildMaps(S, ceilingFn, 1.6),
    metal: buildMaps(S, metalFn, 2.4),
    crate: buildMaps(S, crateFn, 2.2, crateStencil),
    hazard: buildMaps(S, hazardFn, 1.2),
    bulletHole: makeBulletHole(),
    muzzle: makeMuzzle(),
    smoke: makeSmoke(),
    sign: makeSign(),
    spark: radial(32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]),
    glow: radial(64, [[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]),
    softCircle: canvasTex(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, '#f0f0f0');
      g.addColorStop(0.8, '#6a6a6a');
      g.addColorStop(1, '#000000');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }),
  };
  return tex;
}