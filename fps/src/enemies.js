// ============================================================
// Sentinel drones: hover AI, strafe orbits, telegraphed plasma
// bursts, hit reactions, explosions, heal-orb drops, wave manager.
// ============================================================
import * as THREE from 'three';

const DRONE_HP = 30;
const MAX_BOLTS = 48;

export class Enemies {
  constructor(scene, level, fx, audio, tex, player, callbacks) {
    this.scene = scene;
    this.level = level;
    this.fx = fx;
    this.audio = audio;
    this.player = player;
    this.cb = callbacks;
    this.drones = [];
    this.bolts = [];
    this.orbs = [];
    this.wave = 0;
    this.spawnQueue = 0;
    this.spawnTimer = 0;
    this.waveActive = false;
    this.time = 0;
    // difficulty scaling (set by main)
    this.dmgScale = 1;
    this.speedBonus = 0;
    this.countBonus = 0;

    // shared geometry
    this.geoCore = new THREE.IcosahedronGeometry(0.32, 1);
    this.geoEye = new THREE.SphereGeometry(0.105, 16, 12);
    this.geoRing = new THREE.TorusGeometry(0.44, 0.032, 8, 28);
    this.geoRing2 = new THREE.TorusGeometry(0.40, 0.02, 8, 28);
    this.geoPod = new THREE.BoxGeometry(0.14, 0.1, 0.22);
    this.geoAntenna = new THREE.CylinderGeometry(0.008, 0.005, 0.24, 6);
    this.geoHit = new THREE.SphereGeometry(0.55, 8, 6);
    this.geoBolt = new THREE.SphereGeometry(0.07, 10, 8);
    this.geoOrb = new THREE.IcosahedronGeometry(0.13, 1);
    this.matHit = new THREE.MeshBasicMaterial({ visible: false });
    this.matBolt = new THREE.MeshStandardMaterial({ color: 0x301005, emissive: 0xff5a28, emissiveIntensity: 7 });
    this.tex = tex;

    for (let i = 0; i < MAX_BOLTS; i++) {
      const m = new THREE.Mesh(this.geoBolt, this.matBolt);
      m.visible = false;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex.glow, color: 0xff7038, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8,
      }));
      glow.scale.setScalar(0.55);
      m.add(glow);
      scene.add(m);
      this.bolts.push({ obj: m, vel: new THREE.Vector3(), life: 0, trailT: 0 });
    }
  }

  get hitMeshes() { return this.drones.map(d => d.hit); }
  get aliveCount() { return this.drones.length + this.spawnQueue; }

  startWave(n) {
    this.wave = n;
    this.waveActive = true;
    this.spawnQueue = Math.min(3 + n + this.countBonus, 10);
    this.spawnTimer = 0.4;
  }

  _spawnDrone() {
    const spawn = this.level.droneSpawns[Math.floor(Math.random() * this.level.droneSpawns.length)];
    const g = new THREE.Group();

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x6a7280, metalness: 0.55, roughness: 0.42, flatShading: true,
      emissive: 0xffffff, emissiveIntensity: 0, envMapIntensity: 1.2,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x1a0505, emissive: 0xff2418, emissiveIntensity: 2.4, roughness: 0.25,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x40464e, metalness: 0.6, roughness: 0.45, envMapIntensity: 1.0,
    });

    const core = new THREE.Mesh(this.geoCore, coreMat);
    core.scale.setScalar(1.12);
    const eye = new THREE.Mesh(this.geoEye, eyeMat);
    eye.position.set(0, 0.02, 0.3);
    eye.scale.setScalar(1.15);
    const ring = new THREE.Mesh(this.geoRing, ringMat);
    ring.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Mesh(this.geoRing2, ringMat);
    ring2.material = ringMat.clone();
    ring2.material.emissive = new THREE.Color(0x1a3a44);
    ring2.material.emissiveIntensity = 0.8;
    const podL = new THREE.Mesh(this.geoPod, ringMat); podL.position.set(-0.42, -0.05, 0);
    const podR = new THREE.Mesh(this.geoPod, ringMat); podR.position.set(0.42, -0.05, 0);
    const slitMatL = new THREE.MeshStandardMaterial({ color: 0x100800, emissive: 0xff8030, emissiveIntensity: 3.5 });
    const slitL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.16), slitMatL);
    slitL.position.set(-0.5, -0.05, 0);
    const slitR = slitL.clone(); slitR.position.x = 0.5;
    const antenna = new THREE.Mesh(this.geoAntenna, ringMat);
    antenna.position.set(0.1, 0.38, -0.05);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), eyeMat);
    tip.position.set(0.1, 0.51, -0.05);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex.glow, color: 0xff3020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55,
    }));
    glow.scale.setScalar(0.8);
    glow.position.copy(eye.position);
    const thruster = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex.glow, color: 0x66d9ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45,
    }));
    thruster.scale.setScalar(0.5);
    thruster.position.set(0, -0.4, 0);

    const hit = new THREE.Mesh(this.geoHit, this.matHit);
    g.add(core, eye, ring, ring2, podL, podR, slitL, slitR, antenna, tip, glow, thruster, hit);
    g.position.copy(spawn);
    g.scale.setScalar(0.01);
    this.scene.add(g);

    const drone = {
      group: g, core, eye, glow, thruster, ring2, hit, coreMat, eyeMat, ringMat, slitMatL,
      ring2Mat: ring2.material,
      hp: DRONE_HP,
      hover: 1.5 + Math.random() * 1.2,
      seed: Math.random() * 100,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 1.5 + Math.random() * 2.5,
      fireTimer: 1.6 + Math.random() * 1.8,
      burstLeft: 0, burstTimer: 0,
      telegraphed: false,
      spawnT: 0, flashT: 0,
      vel: new THREE.Vector3(),
    };
    hit.userData.drone = drone;
    this.drones.push(drone);
    this.fx.flash(spawn, 1.0, 0xff5030, 0.2);
    this.fx.sparks(spawn, new THREE.Vector3(0, 1, 0), 10, 0xff6040, 3);
    this.audio.bolt();
  }

  damage(drone, amount, point) {
    if (!this.drones.includes(drone)) return false;
    drone.hp -= amount;
    drone.flashT = 1;
    if (drone.hp <= 0) {
      this._kill(drone);
      return true;
    }
    return false;
  }

  _kill(drone) {
    const pos = drone.group.position;
    this.fx.explosion(pos);
    this.audio.explosion();
    this.scene.remove(drone.group);
    drone.coreMat.dispose();
    drone.eyeMat.dispose();
    drone.ringMat.dispose();
    drone.ring2Mat.dispose();
    drone.slitMatL.dispose();
    this.drones.splice(this.drones.indexOf(drone), 1);
    this.cb.onKill(100 + this.wave * 10);
    // heal drop
    if (Math.random() < 0.3 && this.orbs.length < 4) {
      const m = new THREE.Mesh(this.geoOrb, new THREE.MeshStandardMaterial({
        color: 0x06180a, emissive: 0x3dff70, emissiveIntensity: 3.5, roughness: 0.3,
      }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex.glow, color: 0x40ff80, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6,
      }));
      glow.scale.setScalar(0.7);
      m.add(glow);
      m.position.set(pos.x, 0.5, pos.z);
      this.scene.add(m);
      this.orbs.push({ obj: m, life: 14, seed: Math.random() * 10 });
    }
  }

  _fireBolt(drone) {
    const b = this.bolts.find(b => b.life <= 0);
    if (!b) return;
    const from = drone.group.position.clone();
    const target = this.player.camera.position.clone();
    target.y -= 0.15;
    const dir = target.sub(from).normalize();
    const spread = 0.045;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    b.obj.visible = true;
    b.obj.position.copy(from).addScaledVector(dir, 0.5);
    b.vel.copy(dir).multiplyScalar(15);
    b.life = 4;
    b.trailT = 0;
    this.audio.bolt();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const playerPos = this.player.pos;
    const camPos = this.player.camera.position;

    // spawn queue
    if (this.waveActive && this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this._spawnDrone();
        this.spawnQueue--;
        this.spawnTimer = 0.85;
      }
    }

    let nearest = 100;
    const bounds = this.level.bounds;

    for (const d of this.drones) {
      const g = d.group;
      // spawn-in
      if (d.spawnT < 1) {
        d.spawnT = Math.min(1, d.spawnT + dt * 1.6);
        const e = 1 - Math.pow(1 - d.spawnT, 3);
        g.scale.setScalar(Math.max(0.01, e));
        continue;
      }
      d.flashT = Math.max(0, d.flashT - dt * 5);
      d.coreMat.emissiveIntensity = d.flashT * 1.6;

      const toPlayer = new THREE.Vector3().subVectors(playerPos, g.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      nearest = Math.min(nearest, dist);
      toPlayer.normalize();

      // desired distance band
      const desired = 6.5 + Math.sin(d.seed) * 1.5;
      const approach = THREE.MathUtils.clamp(dist - desired, -1, 1);
      const perp = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(d.strafeDir);
      d.strafeTimer -= dt;
      if (d.strafeTimer <= 0) {
        d.strafeDir *= -1;
        d.strafeTimer = 1.6 + Math.random() * 2.6;
      }
      const speed = 2.1 + this.wave * 0.12 + this.speedBonus;
      const wish = new THREE.Vector3()
        .addScaledVector(toPlayer, approach * speed)
        .addScaledVector(perp, 1.5);
      d.vel.lerp(wish, Math.min(1, dt * 2.2));
      g.position.addScaledVector(d.vel, dt);

      // hover height + bob
      const targetY = d.hover + Math.sin(t * 2.1 + d.seed) * 0.16;
      g.position.y = THREE.MathUtils.lerp(g.position.y, targetY, Math.min(1, dt * 3));

      // separation
      for (const o of this.drones) {
        if (o === d) continue;
        const delta = new THREE.Vector3().subVectors(g.position, o.group.position);
        const l = delta.length();
        if (l < 1.15 && l > 0.001) {
          g.position.addScaledVector(delta.normalize(), (1.15 - l) * 0.5);
        }
      }

      // bounds + collider avoidance
      g.position.x = THREE.MathUtils.clamp(g.position.x, bounds.minX + 0.4, bounds.maxX - 0.4);
      g.position.z = THREE.MathUtils.clamp(g.position.z, bounds.minZ + 0.4, bounds.maxZ - 0.4);
      for (const c of this.level.colliders) {
        if (g.position.y - 0.5 > c.max.y || g.position.y + 0.5 < c.min.y) continue;
        const cx = THREE.MathUtils.clamp(g.position.x, c.min.x, c.max.x);
        const cz = THREE.MathUtils.clamp(g.position.z, c.min.z, c.max.z);
        const dx = g.position.x - cx, dz = g.position.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.6 * 0.6) {
          if (d2 > 0.0001) {
            const dl = Math.sqrt(d2);
            g.position.x = cx + (dx / dl) * 0.6;
            g.position.z = cz + (dz / dl) * 0.6;
          } else {
            g.position.x = c.max.x + 0.6;
          }
        }
      }

      // face player, bank into strafe
      g.lookAt(camPos.x, g.position.y, camPos.z);
      g.rotateZ(-d.strafeDir * 0.12);
      g.rotateX(Math.sin(t * 1.7 + d.seed) * 0.05);
      d.ring2.rotation.z += dt * 2.4;
      d.ring2.rotation.x = Math.sin(t * 1.3 + d.seed) * 0.35;
      d.thruster.material.opacity = 0.35 + 0.18 * Math.sin(t * 23 + d.seed * 7);

      // fire control
      if (!this.player.dead && dist < 15) {
        if (d.burstLeft > 0) {
          d.burstTimer -= dt;
          if (d.burstTimer <= 0) {
            this._fireBolt(d);
            d.burstLeft--;
            d.burstTimer = 0.15;
          }
        } else {
          d.fireTimer -= dt;
          if (d.fireTimer < 0.5 && !d.telegraphed) {
            d.telegraphed = true;
            if (dist < 12) this.audio.charge();
          }
          if (d.fireTimer <= 0) {
            d.burstLeft = 3;
            d.burstTimer = 0;
            d.telegraphed = false;
            d.fireTimer = Math.max(1.3, 2.6 - this.wave * 0.12) + Math.random() * 1.4;
          }
        }
      }
      // eye glow: idle pulse + telegraph ramp + hit flash
      const tele = d.telegraphed ? (1 - Math.max(0, d.fireTimer) / 0.5) : 0;
      d.eyeMat.emissiveIntensity = 2.2 + Math.sin(t * 5 + d.seed) * 0.5 + tele * 7 + d.flashT * 4;
      d.glow.material.opacity = 0.4 + tele * 0.5 + d.flashT * 0.3;
      d.glow.scale.setScalar(0.7 + tele * 0.5);
    }

    this.audio.setDroneHum(this.drones.length ? THREE.MathUtils.clamp(1 - nearest / 16, 0, 1) : 0);

    // bolts
    for (const b of this.bolts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      b.obj.position.addScaledVector(b.vel, dt);
      const p = b.obj.position;
      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 0.035;
        this.fx.spawn(p, { color: 0xff6a30, size: 0.1, life: 0.16, additive: true, opacity: 0.5 });
      }
      let dead = b.life <= 0;
      if (!dead && !this.player.dead && this.player.hitTest(p, 0.45)) {
        const dmg = Math.min(16, Math.round((8 + this.wave) * this.dmgScale));
        this.fx.sparks(p, b.vel.clone().normalize().negate(), 8, 0xff5030, 3);
        this.fx.light(p, 0xff4020, 3);
        this.cb.onPlayerHit(dmg);
        dead = true;
      }
      if (!dead && (p.y < 0.04 || p.y > 5.9 ||
          p.x < bounds.minX - 0.5 || p.x > bounds.maxX + 0.5 ||
          p.z < bounds.minZ - 0.5 || p.z > bounds.maxZ + 0.5)) {
        this.fx.sparks(p, new THREE.Vector3(0, 1, 0), 6, 0xff7040, 3);
        this.fx.light(p, 0xff6030, 12);
        dead = true;
      }
      if (!dead) {
        for (const c of this.level.colliders) {
          if (c.containsPoint(p)) {
            this.fx.sparks(p, new THREE.Vector3(0, 1, 0), 6, 0xff7040, 3);
            dead = true;
            break;
          }
        }
      }
      if (dead) { b.life = 0; b.obj.visible = false; }
    }

    // heal orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dt;
      o.obj.rotation.y += dt * 1.8;
      o.obj.position.y = 0.5 + Math.sin(t * 2.5 + o.seed) * 0.08;
      const dx = o.obj.position.x - playerPos.x, dz = o.obj.position.z - playerPos.z;
      const picked = dx * dx + dz * dz < 1.2 && playerPos.y < 1.2;
      if (picked) {
        this.cb.onHeal(25);
        this.audio.pickup();
        this.fx.flash(o.obj.position, 0.8, 0x50ff90, 0.15);
      }
      if (picked || o.life <= 0) {
        this.scene.remove(o.obj);
        o.obj.material.dispose();
        this.orbs.splice(i, 1);
      } else if (o.life < 3) {
        o.obj.visible = Math.sin(t * 12) > -0.3;
      }
    }

    // wave cleared?
    if (this.waveActive && this.spawnQueue === 0 && this.drones.length === 0) {
      this.waveActive = false;
      this.cb.onWaveCleared(this.wave);
    }
  }

  reset() {
    for (const d of this.drones) {
      this.scene.remove(d.group);
      d.coreMat.dispose(); d.eyeMat.dispose(); d.ringMat.dispose(); d.ring2Mat.dispose(); d.slitMatL.dispose();
    }
    this.drones = [];
    for (const b of this.bolts) { b.life = 0; b.obj.visible = false; }
    for (const o of this.orbs) { this.scene.remove(o.obj); o.obj.material.dispose(); }
    this.orbs = [];
    this.spawnQueue = 0;
    this.waveActive = false;
    this.wave = 0;
    this.audio.setDroneHum(0);
  }
}