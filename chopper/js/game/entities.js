/** Entities: enemy vehicles, structures, civilians, FARP. AI, damage, sprites. */
import { bearingDeg, angDiffDeg, dist3, los, clamp, lerp } from './world.js';

const DEG = Math.PI / 180;

export const TYPES = {
  tank:       { hp: 110, radius: 5.5, model: 'tank',       speed: 9,  score: 100, weapon: 'shell',   range: 1050, interval: 4.2 },
  bmp:        { hp: 70,  radius: 4.5, model: 'bmp',        speed: 12, score: 80,  weapon: 'burst',   range: 850,  interval: 2.6, burst: 6 },
  truck:      { hp: 40,  radius: 4.5, model: 'truck',      speed: 11, score: 60,  weapon: null,      range: 0 },
  gepard:     { hp: 90,  radius: 5,   model: 'gepard',     speed: 0,  score: 120, weapon: 'stream',  range: 950,  interval: 2.3, burst: 11 },
  osa:        { hp: 100, radius: 6,   model: 'osa',        speed: 0,  score: 150, weapon: 'sam',     range: 2400, lockTime: 2.8, reload: 9 },
  mi28:       { hp: 260, radius: 8,   model: 'mi28',       speed: 42, score: 300, weapon: 'gunship', range: 1500 },
  bunker:     { hp: 320, radius: 9,   model: 'bunker',     speed: 0,  score: 200, weapon: null },
  fueldepot:  { hp: 140, radius: 11,  model: 'fueldepot',  speed: 0,  score: 150, weapon: null, chain: true },
  radar:      { hp: 90,  radius: 7,   model: 'radar',      speed: 0,  score: 120, weapon: null },
  bridge:     { hp: 260, radius: 20,  model: 'bridge',     speed: 0,  score: 200, weapon: null },
  church:     { hp: 120, radius: 8,   model: 'church',     speed: 0,  score: -150, civilian: true },
  house:      { hp: 60,  radius: 7,   model: 'house',      speed: 0,  score: -100, civilian: true },
  watertower: { hp: 70,  radius: 5,   model: 'watertower', speed: 0,  score: -80, civilian: true },
  tent:       { hp: 25,  radius: 4,   model: 'tent',       speed: 0,  score: 20,  weapon: null },
  farp:       { hp: 1e9, radius: 14,  model: 'farp',       speed: 0,  score: 0,   friendly: true },
};

/** Async sprite-frame cache: returns last-ready frame, loads new ones in background. */
export class FrameCache {
  constructor(assets) {
    this.assets = assets;
    this.map = new Map();
    this.pending = new Set();
  }
  get(name, yi, ei, wreck = false) {
    const key = `${name}:${yi}:${ei}:${wreck ? 1 : 0}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    if (!this.pending.has(key)) {
      this.pending.add(key);
      this.assets.modelFrame(name, yi, ei, wreck).then((s) => {
        this.map.set(key, s);
        this.pending.delete(key);
        if (this.map.size > 1200) {
          const first = this.map.keys().next().value;
          this.map.delete(first);
        }
      }).catch(() => this.pending.delete(key));
    }
    return null;
  }
  async warm(name, yi, ei, wreck = false) {
    const s = await this.assets.modelFrame(name, yi, ei, wreck);
    this.map.set(`${name}:${yi}:${ei}:${wreck ? 1 : 0}`, s);
    return s;
  }
}

export class Entities {
  constructor(defs, sampler, terrain) {
    this.sampler = sampler;
    this.terrain = terrain;
    this.list = defs.map((d, i) => {
      const t = TYPES[d.type];
      const y = Math.max(sampler(d.x, d.z), terrain.waterLevel);
      return {
        id: i, def: d, type: d.type, t,
        x: d.x, z: d.z, y,
        heading: (d.heading ?? 0) * DEG,
        hp: t.hp, maxHp: t.hp,
        alive: true, wreck: false, friendly: !!t.friendly, civilian: !!t.civilian,
        group: d.group ?? null,
        patrol: d.patrol ?? null, wpIdx: 0, convoyIndex: d.convoyIndex ?? null,
        escaped: false,
        fireT: 1 + Math.random() * 2, lockT: 0, reloadT: 0,
        burstLeft: 0, burstT: 0,
        burnT: 0, smokeAcc: 0, chain: [],
        orbit: Math.random() * Math.PI * 2,
        flareT: 0, jink: { x: 0, z: 0 },
        sprite: null, lastYi: -1, lastEi: -1,
      };
    });
  }

  byGroup(group) { return this.list.filter((e) => e.group === group); }

  update(dt, ctx) {
    const { player, particles, weapons, audio, onEvent, time } = ctx;
    const pAlive = !player.crashed;
    let samLock = 0;
    let missileInbound = false;

    for (const e of this.list) {
      // burning wrecks
      if (e.wreck && e.burnT > 0) {
        e.burnT -= dt;
        e.smokeAcc += dt;
        if (e.smokeAcc > 0.14) {
          e.smokeAcc = 0;
          particles.spawn(e.burnT > 20 ? 'darksmoke' : 'smoke',
            e.x + (Math.random() - 0.5) * 3, e.y + 2, e.z + (Math.random() - 0.5) * 3, {
              vy: 3 + Math.random() * 3, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
              ttl: 2.5 + Math.random() * 1.5, s0: 3, s1: 11, a0: 0.8, drag: 0.5,
            });
          if (e.burnT > 21 && Math.random() < 0.5) {
            particles.spawn('fire', e.x, e.y + 1.5, e.z, { ttl: 0.4, s0: 3, s1: 5, vy: 3 });
          }
        }
      }
      // chain explosions (fuel depots)
      for (let i = e.chain.length - 1; i >= 0; i--) {
        e.chain[i].t -= dt;
        if (e.chain[i].t <= 0) {
          const c = e.chain.splice(i, 1)[0];
          particles.explosion(e.x + c.dx, e.y + 2, e.z + c.dz, c.s, e.y);
          audio.explosion(dist3(player.x, player.y, player.z, e.x, e.y, e.z), 0);
        }
      }
      if (!e.alive) continue;

      // patrol movement
      if (e.patrol && e.t.speed > 0 && !e.escaped) {
        const wp = e.patrol[e.wpIdx];
        const dx = wp[0] - e.x, dz = wp[1] - e.z;
        const d = Math.hypot(dx, dz);
        if (d < 12) {
          if (e.type === 'mi28') {
            e.wpIdx = (e.wpIdx + 1) % e.patrol.length;
          } else if (e.wpIdx < e.patrol.length - 1) {
            e.wpIdx++;
          } else {
            e.escaped = true;
            onEvent('escape', e);
          }
        } else {
          const want = Math.atan2(dx, dz);
          let dh = want - e.heading;
          while (dh > Math.PI) dh -= 2 * Math.PI;
          while (dh < -Math.PI) dh += 2 * Math.PI;
          e.heading += clamp(dh, -1.2 * dt, 1.2 * dt);
          const sp = e.t.speed * (e.type === 'mi28' ? 1 : 1);
          e.x += Math.sin(e.heading) * sp * dt;
          e.z += Math.cos(e.heading) * sp * dt;
        }
      }

      if (e.type === 'mi28') {
        const ground = Math.max(this.sampler(e.x, e.z), this.terrain.waterLevel);
        const wantY = ground + 75 + Math.sin(time * 0.7 + e.orbit) * 8;
        e.y = lerp(e.y, wantY, 1 - Math.exp(-1.5 * dt));
        // jink when the player has a missile lock on us
        if (ctx.playerLockTarget === e) {
          e.flareT -= dt;
          if (e.flareT <= 0) {
            e.flareT = 2.2;
            weapons.spawnFlaresAt(e.x, e.y, e.z, 2, { x: 0, y: 0, z: 0 });
          }
          e.jink.x = (Math.random() - 0.5) * 60;
          e.jink.z = (Math.random() - 0.5) * 60;
        }
      } else if (e.t.speed > 0 || e.type === 'bridge') {
        e.y = Math.max(this.sampler(e.x, e.z), this.terrain.waterLevel);
      }

      // combat
      if (!pAlive || !e.t.weapon || e.friendly) continue;
      const d = dist3(e.x, e.y, e.z, player.x, player.y, player.z);
      if (d > e.t.range) { e.lockT = Math.max(0, e.lockT - dt); continue; }
      if (player.agl > 430 && e.t.weapon !== 'sam') continue;
      const canSee = los(this.sampler, e.x, e.y + 3, e.z, player.x, player.y, player.z);
      if (!canSee) { e.lockT = Math.max(0, e.lockT - dt * 2); continue; }

      const lead = (projSpeed) => {
        const t = d / projSpeed;
        return {
          x: player.x + player.vel.x * t,
          y: player.y + player.vel.y * t * 0.6,
          z: player.z + player.vel.z * t,
        };
      };

      switch (e.t.weapon) {
        case 'shell': {
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = e.t.interval * (0.8 + Math.random() * 0.5);
            const p = lead(480);
            const err = 14 + d * 0.012;
            weapons.spawnEnemy('shell', e.x, e.y + 2.5, e.z,
              p.x + (Math.random() - 0.5) * err, p.y + (Math.random() - 0.5) * err * 0.5, p.z + (Math.random() - 0.5) * err);
          }
          break;
        }
        case 'burst':
        case 'stream': {
          e.fireT -= dt;
          if (e.fireT <= 0 && e.burstLeft <= 0) {
            e.fireT = e.t.interval * (0.8 + Math.random() * 0.5);
            e.burstLeft = e.t.burst;
          }
          if (e.burstLeft > 0) {
            e.burstT -= dt;
            if (e.burstT <= 0) {
              e.burstT = e.t.weapon === 'stream' ? 0.065 : 0.11;
              e.burstLeft--;
              const p = lead(620);
              const err = e.t.weapon === 'stream' ? 10 + d * 0.014 : 16 + d * 0.02;
              weapons.spawnEnemy('etracer', e.x, e.y + 2.2, e.z,
                p.x + (Math.random() - 0.5) * err, p.y + (Math.random() - 0.5) * err * 0.6, p.z + (Math.random() - 0.5) * err);
            }
          }
          break;
        }
        case 'sam': {
          e.reloadT -= dt;
          if (e.reloadT <= 0) {
            e.lockT += dt;
            samLock = Math.max(samLock, e.lockT / e.t.lockTime);
            if (e.lockT >= e.t.lockTime) {
              e.lockT = 0;
              e.reloadT = e.t.reload;
              weapons.spawnEnemy('sam', e.x, e.y + 4, e.z, player.x, player.y, player.z);
              onEvent('samLaunch', e);
            }
          }
          break;
        }
        case 'gunship': {
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = 4.5 + Math.random() * 2;
            const p = lead(170);
            for (let i = 0; i < 6; i++) {
              weapons.spawnEnemy('erocket', e.x, e.y - 1, e.z,
                p.x + (Math.random() - 0.5) * 40, p.y + (Math.random() - 0.5) * 20, p.z + (Math.random() - 0.5) * 40);
            }
          }
          e.burstT -= dt;
          if (e.burstT <= 0) {
            e.burstT = 0.1;
            if (Math.random() < 0.55) {
              const p = lead(650);
              const err = 12 + d * 0.012;
              weapons.spawnEnemy('etracer', e.x, e.y - 1.5, e.z,
                p.x + (Math.random() - 0.5) * err, p.y + (Math.random() - 0.5) * err, p.z + (Math.random() - 0.5) * err);
            }
          }
          break;
        }
      }
    }

    // missile threat aggregation
    for (const pr of weapons.projectiles) {
      if (pr.kind === 'sam' && pr.owner === 'enemy') missileInbound = true;
    }
    ctx.samLock = samLock;
    ctx.missileInbound = missileInbound;
    this._samLock = samLock;
    this._missileInbound = missileInbound;
  }

  damage(e, amt, ctx) {
    if (!e.alive || e.friendly) return;
    e.hp -= amt;
    if (e.hp <= 0) {
      e.alive = false;
      e.wreck = true;
      e.burnT = e.civilian ? 14 : 26;
      const scale = e.type === 'fueldepot' || e.type === 'bunker' ? 1.8
        : e.type === 'bridge' ? 1.6
        : e.type === 'mi28' ? 1.7
        : e.type === 'house' || e.type === 'church' ? 1.1 : 0.9;
      ctx.particles.explosion(e.x, e.y + 1.5, e.z, scale, e.y);
      ctx.audio.explosion(dist3(ctx.player.x, ctx.player.y, ctx.player.z, e.x, e.y, e.z),
        clamp((e.x - ctx.player.x) / 600, -1, 1));
      if (e.t.chain) {
        e.chain = [
          { t: 0.45, dx: -6, dz: 3, s: 1.3 },
          { t: 0.9, dx: 5, dz: -4, s: 1.5 },
          { t: 1.5, dx: 0, dz: 6, s: 1.1 },
        ];
      }
      ctx.onEvent(e.civilian ? 'collateral' : 'kill', e);
    }
  }

  buildSprites(assets, cache, cam, out, drawDist, time, dusk) {
    const S = assets.sprites;
    for (const e of this.list) {
      const dx = e.x - cam.x, dz = e.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > drawDist * drawDist) continue;
      const hd = Math.sqrt(d2);
      const meta = assets.modelMeta.get(e.t.model);
      if (!meta) { assets.loadModel(e.t.model); continue; }
      const rel = angDiffDeg(bearingDeg(e.x, e.z, cam.x, cam.z), e.heading / DEG);
      const elev = (Math.atan2(cam.y - e.y, hd) * 180) / Math.PI;
      const { yi, ei } = assets.pickFrame(meta, rel, elev);
      const spr = cache.get(e.t.model, yi, ei, e.wreck);
      if (spr) {
        out.push({ pixels: spr.pixels, pw: spr.pw, ph: spr.ph, ax: spr.ax, ay: spr.ay, ppm: spr.ppm, x: e.x, y: e.y, z: e.z });
      }
      // blob shadow
      const band = elev < 12 ? 0 : elev < 30 ? 1 : elev < 52 ? 2 : 3;
      const sh = S.shadow[band];
      out.push({
        pixels: sh.pixels, pw: sh.pw, ph: sh.ph, ax: sh.ax, ay: sh.ay,
        ppm: 32 / (e.t.radius * 1.15),
        x: e.x, y: Math.max(this.sampler(e.x, e.z), this.terrain.waterLevel) + 0.25, z: e.z,
        alpha: dusk ? 0.45 : 0.75,
      });
      // Mi-28 rotor
      if (e.type === 'mi28' && e.alive) {
        this._rotorSprites(assets, cam, e.x, e.y, e.z, e.heading, time, out, 4.4, -0.5, -8.2, 3.2);
      }
    }
  }

  _rotorSprites(assets, cam, x, y, z, heading, time, out, hubY, hubZ, tailZ, tailY) {
    const S = assets.sprites;
    const sh = Math.sin(heading), ch = Math.cos(heading);
    // main rotor hub (local z forward)
    const hx = x + sh * hubZ, hz = z + ch * hubZ, hy = y + hubY;
    const hd = Math.hypot(cam.x - hx, cam.z - hz);
    const elev = (Math.atan2(cam.y - hy, hd) * 180) / Math.PI;
    const band = elev < 12 ? 0 : elev < 28 ? 1 : elev < 50 ? 2 : elev < 75 ? 3 : 4;
    const rot = ((time * 5.7 * 16) | 0) % 16;
    const r = S.rotor[band][rot];
    out.push({ pixels: r.pixels, pw: r.pw, ph: r.ph, ax: r.ax, ay: r.ay, ppm: r.ppm, x: hx, y: hy, z: hz, alpha: 0.92 });
    // tail rotor (vertical disc, left side)
    const tx = x + sh * tailZ + ch * -0.55, tz = z + ch * tailZ - sh * -0.55, ty = y + tailY;
    const rel = Math.abs(Math.sin(bearingDeg(tx, tz, cam.x, cam.z) * DEG - heading));
    const wf = Math.min(4, (rel * 5) | 0);
    const trot = ((time * 30 * 8) | 0) % 8;
    const tr = S.tail[wf][trot];
    out.push({ pixels: tr.pixels, pw: tr.pw, ph: tr.ph, ax: tr.ax, ay: tr.ay, ppm: tr.ppm, x: tx, y: ty, z: tz, alpha: 0.9 });
  }
}