/** Shared world helpers: terrain sampling, line-of-sight, angle math. */

export function makeSampler(terrain) {
  const { height, size, cell, heightScale } = terrain;
  const inv = 1 / cell;
  const world = size * cell;
  return (x, z) => {
    let ix = (x * inv) | 0, iz = (z * inv) | 0;
    if (ix < 0) ix = 0; else if (ix >= size) ix = size - 1;
    if (iz < 0) iz = 0; else if (iz >= size) iz = size - 1;
    return height[iz * size + ix] * heightScale;
  };
}

export function surfaceAt(terrain, sampler, x, z) {
  const h = sampler(x, z);
  return h < terrain.waterLevel ? terrain.waterLevel : h;
}

/** Terrain line-of-sight between two world points. */
export function los(sampler, ax, ay, az, bx, by, bz) {
  const n = 14;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const y = ay + (by - ay) * t;
    if (sampler(x, z) > y + 2) return false;
  }
  return true;
}

export function bearingDeg(fx, fz, tx, tz) {
  return (Math.atan2(tx - fx, tz - fz) * 180) / Math.PI;
}

export function angDiffDeg(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function dist3(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }