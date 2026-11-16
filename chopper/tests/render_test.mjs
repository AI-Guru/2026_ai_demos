// Headless renderer QA: renders frames to PNG without a browser.
// Uses real terrain if generated, otherwise a synthetic fractal stand-in.
// Run: node tests/render_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoxelRenderer } from '../js/engine/voxel.js';
import { encodePNG } from './png.mjs';
import { decodePNG } from './png_decode.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'tests', 'out');
fs.mkdirSync(outDir, { recursive: true });

// ImageData polyfill for node
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  };
}

const SIZE = 1024;
const CELL = 4;

function loadOrFakeTerrain() {
  const hp = path.join(root, 'assets/terrain/m1_height.bin');
  const cp = path.join(root, 'assets/terrain/m1_color.bin');
  const mp = path.join(root, 'assets/terrain/m1_meta.json');
  if (fs.existsSync(hp) && fs.existsSync(cp) && fs.existsSync(mp)) {
    const meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
    console.log('Using REAL terrain m1');
    return {
      height: new Uint8Array(fs.readFileSync(hp)),
      color: new Uint8Array(fs.readFileSync(cp)),
      size: SIZE,
      cell: CELL,
      heightScale: meta.heightScale,
      waterLevel: meta.waterLevel,
      sky: skyFor(meta.sky),
    };
  }
  console.log('Real terrain not found — generating synthetic stand-in');
  return fakeTerrain();
}

function skyFor(kind) {
  if (kind === 'dusk') {
    return {
      top: [42, 36, 74], horizon: [255, 150, 80], haze: [196, 130, 100],
      sunAz: (280 * Math.PI) / 180, sunEl: (6 * Math.PI) / 180,
      sunColor: [255, 170, 90], sunSize: 120, fogDensity: 0.0012,
    };
  }
  return {
    top: [64, 118, 196], horizon: [186, 210, 232], haze: [196, 212, 226],
    sunAz: (225 * Math.PI) / 180, sunEl: (42 * Math.PI) / 180,
    sunColor: [255, 250, 225], sunSize: 80, fogDensity: 0.00095,
  };
}

// --- synthetic fractal terrain (value noise fBm) ---
function fakeTerrain() {
  const rng = mulberry(1337);
  const height = new Uint8Array(SIZE * SIZE);
  const color = new Uint8Array(SIZE * SIZE * 3);
  const octaves = [8, 16, 32, 64, 128].map((n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return { n, g };
  });
  const sample = (o, x, z) => {
    const fx = ((x + 0.5) * o.n) / SIZE - 0.5;
    const fz = ((z + 0.5) * o.n) / SIZE - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const w = (xx, zz) => o.g[((zz % o.n) + o.n) % o.n * o.n + (((xx % o.n) + o.n) % o.n)];
    const a = w(x0, z0), b = w(x0 + 1, z0), c = w(x0, z0 + 1), d = w(x0 + 1, z0 + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0, amp = 0.55, tot = 0;
      for (const o of octaves) { v += sample(o, x, z) * amp; tot += amp; amp *= 0.5; }
      v /= tot;
      const hM = 30 + v * 220;
      const i = z * SIZE + x;
      height[i] = Math.max(0, Math.min(255, Math.round(hM / 1.5)));
      // color by height + noise
      const t = v;
      let r, g, b;
      if (hM < 40) { r = 42; g = 74; b = 106; }
      else if (t < 0.45) { r = 106; g = 138; b = 74; }
      else if (t < 0.62) { r = 58; g = 88; b = 46; }
      else if (t < 0.78) { r = 122; g = 114; b = 96; }
      else { r = 226; g = 228; b = 232; }
      const j = (rng() - 0.5) * 14;
      color[i * 3] = Math.max(0, Math.min(255, r + j));
      color[i * 3 + 1] = Math.max(0, Math.min(255, g + j));
      color[i * 3 + 2] = Math.max(0, Math.min(255, b + j));
    }
  }
  return { height, color, size: SIZE, cell: CELL, heightScale: 1.5, waterLevel: 40, sky: skyFor('day') };
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

// --- synthetic sprite: a solid quad with an anchor at bottom-center ---
function makeQuadSprite(pw, ph, rgb) {
  const pixels = new Uint32Array(pw * ph);
  const c = (255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      // leave a transparent notch at top to test alpha edges
      const edge = x < 2 || x >= pw - 2 || y < 2;
      pixels[y * pw + x] = edge ? 0 : c;
    }
  return { pixels, pw, ph, ax: pw / 2, ay: ph, ppm: 8 };
}

const terrain = loadOrFakeTerrain();
const W = 960, H = 540;
const renderer = new VoxelRenderer(W, H);
renderer.setTerrain(terrain);

const heightAt = (x, z) => {
  const ix = Math.max(0, Math.min(SIZE - 1, (x / CELL) | 0));
  const iz = Math.max(0, Math.min(SIZE - 1, (z / CELL) | 0));
  return terrain.height[iz * SIZE + ix] * terrain.heightScale;
};

const shots = [
  { name: 'chase', cam: { x: 2048, y: heightAt(2048, 500) + 90, z: 500, heading: 0, pitch: (-7 * Math.PI) / 180, roll: 0 } },
  { name: 'high', cam: { x: 2048, y: 620, z: 900, heading: (20 * Math.PI) / 180, pitch: (-24 * Math.PI) / 180, roll: 0 } },
  { name: 'lowpass', cam: { x: 2048, y: heightAt(2048, 2048) + 26, z: 2048, heading: (10 * Math.PI) / 180, pitch: (-2 * Math.PI) / 180, roll: 0 } },
  { name: 'dusk', cam: { x: 1500, y: heightAt(1500, 1500) + 120, z: 1500, heading: (225 * Math.PI) / 180, pitch: (-5 * Math.PI) / 180, roll: 0 }, sky: 'dusk' },
];

for (const shot of shots) {
  if (shot.sky) renderer.setTerrain({ ...terrain, sky: skyFor(shot.sky) });
  const t0 = performance.now();
  renderer.render(shot.cam, []);
  const ms = performance.now() - t0;
  const png = encodePNG(W, H, renderer.getImage().data);
  fs.writeFileSync(path.join(outDir, `${shot.name}.png`), png);
  console.log(`${shot.name}: ${ms.toFixed(1)} ms/frame`);
}

// Sprite occlusion test: red wall BEHIND a ridge should be partly hidden;
// green wall in front fully visible. Camera looks north from a valley.
renderer.setTerrain(terrain);
const camZ = 1700;
const camY = heightAt(2048, camZ) + 40;
const cam = { x: 2048, y: camY, z: camZ, heading: 0, pitch: (-3 * Math.PI) / 180, roll: 0 };
const red = makeQuadSprite(64, 96, [220, 40, 40]);
const green = makeQuadSprite(64, 96, [40, 220, 60]);
// find a ridge north of camera: scan for local max
let ridgeZ = camZ + 300, ridgeH = 0;
for (let z = camZ + 100; z < camZ + 700; z += 4) {
  const h = heightAt(2048, z);
  if (h > ridgeH) { ridgeH = h; ridgeZ = z; }
}
const sprites = [
  { ...red, x: 2048, y: ridgeH + 2, z: ridgeZ + 120 },   // behind ridge, base at ridge height
  { ...green, x: 2140, y: heightAt(2140, camZ + 150), z: camZ + 150 }, // in front
];
renderer.render(cam, sprites);
fs.writeFileSync(path.join(outDir, 'occlusion.png'), encodePNG(W, H, renderer.getImage().data));
console.log(`occlusion test: ridge at z=${ridgeZ} h=${ridgeH.toFixed(0)}, camY=${camY.toFixed(0)}`);

// Real model sprites through the engine (if assets exist)
const tigerPath = path.join(root, 'assets/models/tiger.png');
const tigerMetaPath = path.join(root, 'assets/models/tiger.json');
if (fs.existsSync(tigerPath) && fs.existsSync(tigerMetaPath)) {
  const meta = JSON.parse(fs.readFileSync(tigerMetaPath, 'utf8'));
  const sheet = decodePNG(fs.readFileSync(tigerPath));
  const frame = (col, row) => {
    const px = new Uint32Array(meta.frameW * meta.frameH);
    for (let y = 0; y < meta.frameH; y++)
      for (let x = 0; x < meta.frameW; x++)
        px[y * meta.frameW + x] = sheet.pixels[(row * meta.frameH + y) * sheet.width + col * meta.frameW + x];
    return { pixels: px, pw: meta.frameW, ph: meta.frameH, ax: meta.anchorX, ay: meta.anchorY, ppm: meta.pxPerMeter };
  };
  const gy = heightAt(2048, 1200);
  const cam2 = { x: 2048, y: gy + 14, z: 1200 - 30, heading: 0, pitch: (-6 * Math.PI) / 180, roll: 0 };
  const tankMeta = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/tank.json'), 'utf8'));
  const tankSheet = decodePNG(fs.readFileSync(path.join(root, 'assets/models/tank.png')));
  const tankFrame = {
    pixels: (() => {
      const px = new Uint32Array(tankMeta.frameW * tankMeta.frameH);
      for (let y = 0; y < tankMeta.frameH; y++)
        for (let x = 0; x < tankMeta.frameW; x++)
          px[y * tankMeta.frameW + x] = tankSheet.pixels[(1 * tankMeta.frameH + y) * tankSheet.width + 8 * tankMeta.frameW + x];
      return px;
    })(),
    pw: tankMeta.frameW, ph: tankMeta.frameH, ax: tankMeta.anchorX, ay: tankMeta.anchorY, ppm: tankMeta.pxPerMeter,
  };
  renderer.render(cam2, [
    { ...frame(16, 1), x: 2048, y: gy, z: 1200 },          // Tiger rear view, 30 m ahead
    { ...tankFrame, x: 2000, y: heightAt(2000, 1350), z: 1350 },
    { ...tankFrame, x: 2110, y: heightAt(2110, 1500), z: 1500 },
  ]);
  fs.writeFileSync(path.join(outDir, 'models.png'), encodePNG(W, H, renderer.getImage().data));
  console.log('models test rendered');
}
console.log('Done → tests/out/');