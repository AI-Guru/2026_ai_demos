/** Particle system: explosions, smoke columns, trails, dust, sparks.
 *  Particles render through the voxel sprite pipeline (terrain-occluded). */

export class Particles {
  constructor() {
    this.list = [];
  }

  spawn(kind, x, y, z, o = {}) {
    if (this.list.length > 750) this.list.splice(0, 40);
    this.list.push({
      kind, x, y, z,
      vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      ttl: o.ttl ?? 1, age: 0,
      s0: o.s0 ?? 3, s1: o.s1 ?? 6,
      a0: o.a0 ?? 1,
      grav: o.grav ?? 0, drag: o.drag ?? 0,
      seed: Math.random(),
    });
  }

  explosion(x, y, z, scale = 1, groundY = null) {
    this.spawn('flash', x, y + 1, z, { ttl: 0.13, s0: 9 * scale, s1: 13 * scale });
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 5 + Math.random() * 13 * scale;
      this.spawn('fire', x, y + 1.5, z, {
        vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 3 + Math.random() * 9,
        ttl: 0.45 + Math.random() * 0.5, s0: 4.5 * scale, s1: 8 * scale, drag: 2.2,
      });
    }
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 6;
      this.spawn(Math.random() < 0.5 ? 'smoke' : 'darksmoke', x, y + 2, z, {
        vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 3.5 + Math.random() * 5,
        ttl: 2.2 + Math.random() * 1.6, s0: 4 * scale, s1: (13 + Math.random() * 7) * scale,
        a0: 0.9, drag: 0.8,
      });
    }
    for (let i = 0; i < 13; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 14 + Math.random() * 24 * scale;
      this.spawn('spark', x, y + 1, z, {
        vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 8 + Math.random() * 18,
        ttl: 0.4 + Math.random() * 0.55, s0: 0.55, s1: 0.3, grav: -24,
      });
    }
    if (groundY !== null && y - groundY < 8) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const v = 9 + Math.random() * 8;
        this.spawn('dust', x, groundY + 1, z, {
          vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: 1.5,
          ttl: 1.3 + Math.random() * 0.7, s0: 4, s1: 12 * scale, a0: 0.75, drag: 1.4,
        });
      }
    }
  }

  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.ttl) { l.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      if (p.drag) { const d = 1 - p.drag * dt; p.vx *= d; p.vy *= d; p.vz *= d; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
  }

  /** Append render sprites. cam used only for culling. */
  buildSprites(assets, cam, out, drawDist) {
    const S = assets.sprites;
    for (const p of this.list) {
      const dx = p.x - cam.x, dz = p.z - cam.z;
      if (dx * dx + dz * dz > drawDist * drawDist) continue;
      const u = p.age / p.ttl;
      const size = p.s0 + (p.s1 - p.s0) * u;
      let spr, alpha = p.a0;
      switch (p.kind) {
        case 'flash': spr = S.flash; alpha = 1 - u; break;
        case 'fire': spr = S.fire[u < 0.3 ? 0 : u < 0.65 ? 1 : 2]; alpha = 1 - u * 0.6; break;
        case 'smoke': spr = S.smoke; alpha = p.a0 * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85); break;
        case 'darksmoke': spr = S.darksmoke; alpha = p.a0 * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85); break;
        case 'dust': spr = S.dust; alpha = p.a0 * (1 - u); break;
        case 'spark': spr = S.spark; alpha = 1 - u * u; break;
        default: spr = S.smoke;
      }
      out.push({
        pixels: spr.pixels, pw: spr.pw, ph: spr.ph, ax: spr.ax, ay: spr.ay,
        ppm: spr.pw / Math.max(0.3, size),
        x: p.x, y: p.y, z: p.z, alpha: Math.max(0, Math.min(1, alpha)),
      });
    }
  }
}