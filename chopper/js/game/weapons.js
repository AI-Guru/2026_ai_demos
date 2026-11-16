/** Weapons: 30 mm cannon, 70 mm rockets, PARS 3 LR, flares; enemy projectiles.
 *  Everything is a real projectile in the world (terrain-occluded tracers). */
import { dist3, los, clamp } from './world.js';

const DEG = Math.PI / 180;

const PROJ = {
  gun:     { speed: 950, dmg: 9,  grav: 0,    ttl: 1.7, splash: 0,  owner: 'player' },
  rocket:  { speed: 135, dmg: 70, grav: -3.5, ttl: 4.6, splash: 14, owner: 'player' },
  pars:    { speed: 110, dmg: 150, grav: 0,   ttl: 15,  splash: 10, owner: 'player', guided: true, maxSpeed: 265 },
  etracer: { speed: 620, dmg: 7,  grav: 0,    ttl: 2.3, splash: 0,  owner: 'enemy' },
  shell:   { speed: 480, dmg: 20, grav: -3,   ttl: 3.4, splash: 7,  owner: 'enemy' },
  erocket: { speed: 170, dmg: 26, grav: -3,   ttl: 4.2, splash: 11, owner: 'enemy' },
  sam:     { speed: 130, dmg: 42, grav: 0,    ttl: 13,  splash: 12, owner: 'enemy', guided: true, maxSpeed: 238 },
  flare:   { speed: 0,   dmg: 0,  grav: -4,   ttl: 3.2, splash: 0,  owner: 'decoy' },
};

export class Weapons {
  constructor(loadout) {
    this.ammo = { gun: loadout.gun, rockets: loadout.rockets, pars: loadout.pars, flares: loadout.flares };
    this.selected = 0;
    this.projectiles = [];
    this.lock = { target: null, progress: 0, locked: false };
    this.gunCd = 0; this.rocketCd = 0; this.parsCd = 0; this.flareCd = 0;
    this.rocketSide = 1;
    this.stats = { shots: 0, hits: 0 };
    this.lockAudio = false;
  }

  select(i) { this.selected = clamp(i, 0, 2); }

  aimDir(cam) {
    const cp = Math.cos(cam.pitch);
    return { x: Math.sin(cam.heading) * cp, y: Math.sin(cam.pitch), z: Math.cos(cam.heading) * cp };
  }

  update(dt, ctx) {
    const { input, player, cam, entities, particles, audio, sampler, terrain, onEvent } = ctx;
    this.gunCd -= dt; this.rocketCd -= dt; this.parsCd -= dt; this.flareCd -= dt;
    const aim = this.aimDir(cam);
    const canFire = !player.crashed && player.fuel > 0;

    // ---- PARS 3 lock acquisition ----
    let best = null, bestAng = 4.5;
    for (const e of entities.list) {
      if (!e.alive || e.friendly) continue;
      const dx = e.x - cam.x, dy = e.y + e.t.radius * 0.4 - cam.y, dz = e.z - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 4200 || d < 40) continue;
      const dot = (dx * aim.x + dy * aim.y + dz * aim.z) / d;
      const ang = Math.acos(clamp(dot, -1, 1)) / DEG;
      if (ang < bestAng && los(sampler, cam.x, cam.y, cam.z, e.x, e.y + 2, e.z)) {
        bestAng = ang; best = e;
      }
    }
    if (best) {
      if (this.lock.target !== best) this.lock.progress = 0;
      this.lock.target = best;
      this.lock.progress = Math.min(1, this.lock.progress + dt / 1.1);
    } else {
      this.lock.progress = Math.max(0, this.lock.progress - dt * 2.5);
      if (this.lock.progress === 0) this.lock.target = null;
    }
    this.lock.locked = this.lock.progress >= 1;
    if (this.lock.progress > 0.02) {
      if (!this.lockAudio) { audio.startLock(); this.lockAudio = true; }
      audio.setLocked(this.lock.locked);
    } else if (this.lockAudio) { audio.stopLock(); this.lockAudio = false; }

    // ---- firing ----
    const fireHeld = input.down('Space');
    const fireTap = input.hit('Space');
    const f = player.forward;
    const right = { x: Math.cos(player.heading), z: -Math.sin(player.heading) };
    const muzzle = (lat, fwd, up) => ({
      x: player.x + f.x * fwd + right.x * lat,
      y: player.y + up,
      z: player.z + f.z * fwd + right.z * lat,
    });
    const aimPoint = (range) => ({ x: cam.x + aim.x * range, y: cam.y + aim.y * range, z: cam.z + aim.z * range });

    if (canFire && fireHeld && this.selected === 0 && this.gunCd <= 0 && this.ammo.gun > 0) {
      this.gunCd = 1 / 11;
      this.ammo.gun--;
      this.stats.shots++;
      const m = muzzle(1.6, 6, 0.6);
      const ap = aimPoint(1200);
      const spread = 0.55 * DEG;
      this._spawn('gun', m, ap, spread);
      particles.spawn('flash', m.x, m.y, m.z, { ttl: 0.06, s0: 1.6, s1: 2.2 });
      audio.fireGun();
    }
    if (canFire && fireHeld && this.selected === 1 && this.rocketCd <= 0 && this.ammo.rockets >= 2) {
      this.rocketCd = 0.3;
      this.ammo.rockets -= 2;
      this.stats.shots += 2;
      const ap = aimPoint(900);
      for (const side of [-1, 1]) {
        const m = muzzle(side * 2.2, 3, 0.4);
        const p = this._spawn('rocket', m, ap, 0.9 * DEG);
        p.vx += player.vel.x; p.vy += player.vel.y; p.vz += player.vel.z;
      }
      audio.fireRocket();
    }
    if (canFire && fireTap && this.selected === 2 && this.parsCd <= 0 && this.ammo.pars > 0 && this.lock.locked) {
      this.parsCd = 1.1;
      this.ammo.pars--;
      this.stats.shots++;
      this.rocketSide *= -1;
      const m = muzzle(this.rocketSide * 2.7, 2, 0.2);
      const p = this._spawn('pars', m, aimPoint(2000), 0);
      p.vx += player.vel.x * 0.6; p.vy += player.vel.y * 0.6 + 10; p.vz += player.vel.z * 0.6;
      p.target = this.lock.target;
      p.launchT = 0.45;
      audio.fireMissile();
      onEvent('parsLaunch', this.lock.target);
      this.lock.progress = 0.35;
    }
    if (input.hit('KeyF') && this.flareCd <= 0 && this.ammo.flares >= 2 && !player.crashed) {
      this.flareCd = 0.9;
      this.ammo.flares -= 2;
      this.spawnFlaresAt(player.x, player.y, player.z, 2, player.vel);
      audio.flare();
      // decoy incoming SAMs
      for (const pr of this.projectiles) {
        if (pr.kind !== 'sam' || pr.owner !== 'enemy') continue;
        if (dist3(pr.x, pr.y, pr.z, player.x, player.y, player.z) < 560 && Math.random() < 0.72) {
          let nearest = null, nd = 1e9;
          for (const fl of this.projectiles) {
            if (fl.kind !== 'flare') continue;
            const d = dist3(pr.x, pr.y, pr.z, fl.x, fl.y, fl.z);
            if (d < nd) { nd = d; nearest = fl; }
          }
          if (nearest) pr.decoy = nearest;
        }
      }
    }

    // ---- projectiles ----
    const surface = (x, z) => Math.max(sampler(x, z), terrain.waterLevel);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age >= p.ttl) {
        if (p.kind === 'pars' || p.kind === 'sam') particles.explosion(p.x, p.y, p.z, 0.5);
        this.projectiles.splice(i, 1);
        continue;
      }
      const spec = PROJ[p.kind];

      // guidance
      if (spec.guided) {
        let tgt = null;
        if (p.kind === 'pars') {
          if (p.target && p.target.alive) tgt = { x: p.target.x, y: p.target.y + 1.5, z: p.target.z };
          else {
            p.target = null;
            let nd = 300;
            for (const e of entities.list) {
              if (!e.alive || e.friendly) continue;
              const d = dist3(p.x, p.y, p.z, e.x, e.y, e.z);
              if (d < nd) { nd = d; p.target = e; }
            }
            if (p.target) tgt = { x: p.target.x, y: p.target.y + 1.5, z: p.target.z };
          }
          if (tgt) {
            const d = dist3(p.x, p.y, p.z, tgt.x, tgt.y, tgt.z);
            if (d > 550) tgt.y += 85; // top-attack cruise
            p.launchT -= dt;
            const sp = Math.min(spec.maxSpeed, Math.hypot(p.vx, p.vy, p.vz) + 70 * dt);
            this._guide(p, tgt, 1.7 * dt, sp);
            if (d < 11 && p.target) {
              entities.damage(p.target, spec.dmg, ctx);
              this.stats.hits++;
              particles.explosion(p.x, p.y, p.z, 1.1, surface(p.x, p.z));
              audio.explosion(dist3(player.x, player.y, player.z, p.x, p.y, p.z), 0);
              this._splash(p, spec, ctx, surface);
              this.projectiles.splice(i, 1);
              continue;
            }
          }
        } else if (p.kind === 'sam') {
          if (p.decoy && p.decoy.age < p.decoy.ttl) {
            tgt = p.decoy;
          } else {
            p.decoy = null;
            if (!player.crashed) tgt = { x: player.x + player.vel.x * 0.35, y: player.y + player.vel.y * 0.2, z: player.z + player.vel.z * 0.35 };
          }
          if (tgt) {
            const sp = Math.min(spec.maxSpeed, Math.hypot(p.vx, p.vy, p.vz) + 85 * dt);
            this._guide(p, tgt, 2.0 * dt, sp);
            const d = dist3(p.x, p.y, p.z, tgt.x, tgt.y, tgt.z);
            if (d < (p.decoy ? 8 : 13)) {
              particles.explosion(p.x, p.y, p.z, 0.9);
              audio.explosion(dist3(player.x, player.y, player.z, p.x, p.y, p.z), 0);
              if (!p.decoy && !player.crashed) {
                player.damage(spec.dmg);
                audio.hit();
                onEvent('playerHit', null);
              }
              this.projectiles.splice(i, 1);
              continue;
            }
          }
        }
      } else {
        p.vy += spec.grav * dt;
      }
      if (p.kind === 'flare') { p.vx *= 1 - 1.6 * dt; p.vz *= 1 - 1.6 * dt; }

      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      // smoke trails
      if (p.kind === 'pars' || p.kind === 'sam' || p.kind === 'rocket' || p.kind === 'erocket') {
        p.trailAcc = (p.trailAcc ?? 0) + dt;
        const iv = p.kind === 'rocket' || p.kind === 'erocket' ? 0.05 : 0.035;
        if (p.trailAcc >= iv) {
          p.trailAcc = 0;
          particles.spawn('smoke', p.x, p.y, p.z, {
            ttl: p.kind === 'sam' ? 2.6 : 1.9, s0: 1.2, s1: p.kind === 'rocket' ? 4 : 5.5,
            a0: 0.55, vy: 0.6, drag: 0.6,
          });
        }
      }
      if (p.kind === 'flare' && Math.random() < 0.4) {
        particles.spawn('spark', p.x, p.y, p.z, { ttl: 0.25, s0: 0.4, s1: 0.2, vy: -2, grav: -6 });
      }

      // terrain impact
      const g = surface(p.x, p.z);
      if (p.y <= g + 0.4) {
        if (spec.splash > 0) {
          particles.explosion(p.x, g + 0.5, p.z, p.kind === 'pars' ? 1.2 : 0.85, g);
          audio.explosion(dist3(player.x, player.y, player.z, p.x, p.y, p.z), clamp((p.x - player.x) / 600, -1, 1));
          this._splash(p, spec, ctx, surface);
        } else {
          particles.spawn('dust', p.x, g + 0.5, p.z, { ttl: 0.6, s0: 1.5, s1: 3.5, a0: 0.6, vy: 1.5 });
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      // hits
      if (p.owner === 'player') {
        let hit = null;
        for (const e of entities.list) {
          if (!e.alive || e.friendly) continue;
          if (dist3(p.x, p.y, p.z, e.x, e.y + e.t.radius * 0.35, e.z) < e.t.radius + 1.2) { hit = e; break; }
        }
        if (hit) {
          entities.damage(hit, spec.dmg, ctx);
          this.stats.hits++;
          particles.spawn('fire', p.x, p.y, p.z, { ttl: 0.25, s0: 2, s1: 3.5 });
          if (spec.splash > 0) {
            particles.explosion(p.x, p.y, p.z, 0.9, g);
            audio.explosion(dist3(player.x, player.y, player.z, p.x, p.y, p.z), 0);
            this._splash(p, spec, ctx, surface, hit);
          }
          this.projectiles.splice(i, 1);
          continue;
        }
      } else if (p.owner === 'enemy' && !player.crashed) {
        if (dist3(p.x, p.y, p.z, player.x, player.y + 1, player.z) < 5.2) {
          player.damage(spec.dmg);
          audio.hit();
          onEvent('playerHit', null);
          if (spec.splash > 0) particles.explosion(p.x, p.y, p.z, 0.7);
          else particles.spawn('fire', p.x, p.y, p.z, { ttl: 0.2, s0: 1.6, s1: 2.6 });
          this.projectiles.splice(i, 1);
          continue;
        }
      }
    }
  }

  _spawn(kind, from, toward, spreadRad) {
    const spec = PROJ[kind];
    let dx = toward.x - from.x, dy = toward.y - from.y, dz = toward.z - from.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= d; dy /= d; dz /= d;
    if (spreadRad > 0) {
      dx += (Math.random() - 0.5) * spreadRad * 2;
      dy += (Math.random() - 0.5) * spreadRad * 2;
      dz += (Math.random() - 0.5) * spreadRad * 2;
      const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= n; dy /= n; dz /= n;
    }
    const p = {
      kind, owner: spec.owner, x: from.x, y: from.y, z: from.z,
      vx: dx * spec.speed, vy: dy * spec.speed, vz: dz * spec.speed,
      age: 0, ttl: spec.ttl, dmg: spec.dmg, trailAcc: 0,
    };
    this.projectiles.push(p);
    return p;
  }

  spawnEnemy(kind, x, y, z, tx, ty, tz) {
    return this._spawn(kind, { x, y, z }, { x: tx, y: ty, z: tz }, kind === 'etracer' ? 0.012 : 0.02);
  }

  spawnFlaresAt(x, y, z, n, vel) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.projectiles.push({
        kind: 'flare', owner: 'decoy', x, y: y - 0.5, z,
        vx: vel.x * 0.7 + Math.cos(a) * 16, vy: -3 + Math.random() * 4, vz: vel.z * 0.7 + Math.sin(a) * 16,
        age: 0, ttl: PROJ.flare.ttl, dmg: 0,
      });
    }
  }

  _guide(p, tgt, maxTurn, speed) {
    let dx = tgt.x - p.x, dy = tgt.y - p.y, dz = tgt.z - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= d; dy /= d; dz /= d;
    const v = Math.hypot(p.vx, p.vy, p.vz) || 1;
    let ux = p.vx / v, uy = p.vy / v, uz = p.vz / v;
    const dot = clamp(ux * dx + uy * dy + uz * dz, -1, 1);
    const ang = Math.acos(dot);
    if (ang > 1e-4) {
      const t = Math.min(1, maxTurn / ang);
      // slerp-ish toward desired direction
      let nx = ux + (dx - ux) * t, ny = uy + (dy - uy) * t, nz = uz + (dz - uz) * t;
      const n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      p.vx = (nx / n) * speed; p.vy = (ny / n) * speed; p.vz = (nz / n) * speed;
    } else {
      p.vx = ux * speed; p.vy = uy * speed; p.vz = uz * speed;
    }
  }

  _splash(p, spec, ctx, surface, exclude = null) {
    const { entities, player, onEvent, audio } = ctx;
    for (const e of entities.list) {
      if (!e.alive || e.friendly || e === exclude) continue;
      const d = dist3(p.x, p.y, p.z, e.x, e.y + 1, e.z);
      if (d < spec.splash + e.t.radius) {
        entities.damage(e, spec.dmg * 0.75 * (1 - d / (spec.splash + e.t.radius)), ctx);
      }
    }
    if (p.owner === 'enemy' && !player.crashed) {
      const d = dist3(p.x, p.y, p.z, player.x, player.y, player.z);
      if (d < spec.splash + 4) {
        player.damage(spec.dmg * 0.6 * (1 - d / (spec.splash + 4)));
        audio.hit();
        onEvent('playerHit', null);
      }
    }
  }

  buildSprites(assets, cam, out, drawDist) {
    const S = assets.sprites;
    for (const p of this.projectiles) {
      const dx = p.x - cam.x, dz = p.z - cam.z;
      if (dx * dx + dz * dz > drawDist * drawDist) continue;
      let spr;
      switch (p.kind) {
        case 'gun': spr = S.tracerP; break;
        case 'etracer': spr = S.tracerE; break;
        case 'rocket': case 'erocket': spr = S.rocket; break;
        case 'pars': case 'sam': spr = S.missile; break;
        case 'flare': spr = S.flare; break;
        default: continue;
      }
      out.push({ pixels: spr.pixels, pw: spr.pw, ph: spr.ph, ax: spr.ax, ay: spr.ay, ppm: spr.ppm, x: p.x, y: p.y, z: p.z, alpha: p.kind === 'flare' ? 1 - (p.age / p.ttl) * 0.5 : 1 });
    }
  }
}