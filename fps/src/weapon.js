// ============================================================
// MK-7 carbine viewmodel: procedural gun, ADS, recoil springs,
// sway/bob, muzzle flash + light, hitscan, tracers, brass.
// ============================================================
import * as THREE from 'three';

const MAG_SIZE = 30;
const FIRE_INTERVAL = 0.105;
const DAMAGE = 12;
const RELOAD_TIME = 1.6;

export class Weapon {
  constructor(scene, camera, level, fx, audio, tex, enemies, player, ui) {
    this.scene = scene;
    this.camera = camera;
    this.level = level;
    this.fx = fx;
    this.audio = audio;
    this.enemies = enemies;
    this.player = player;
    this.ui = ui;

    this.ammo = MAG_SIZE;
    this.reserve = 270;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.adsT = 0;
    this.bloom = 0;
    this.kickZ = 0; this.kickZV = 0;
    this.kickX = 0; this.kickXV = 0;
    this.swayX = 0; this.swayY = 0;
    this.flashT = 0;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 80;

    this._buildViewmodel(tex);
    this._buildShells();

    this.hipPos = new THREE.Vector3(0.26, -0.235, -0.42);
    this.adsPos = new THREE.Vector3(0, -0.082, -0.5);
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
  }

  _buildViewmodel(tex) {
    const gunmetal = new THREE.MeshStandardMaterial({ color: 0x4e545c, metalness: 0.85, roughness: 0.32, envMapIntensity: 2.2 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x26282c, metalness: 0.15, roughness: 0.62, envMapIntensity: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, metalness: 0.6, roughness: 0.45, envMapIntensity: 1.4 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 0.95, roughness: 0.3 });
    this._brassMat = brass;

    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      g.add(m);
      return m;
    };

    // receiver + rail
    add(new THREE.BoxGeometry(0.058, 0.085, 0.40), gunmetal, 0, 0, 0);
    add(new THREE.BoxGeometry(0.032, 0.014, 0.44), dark, 0, 0.05, -0.04);
    // rail teeth
    for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(0.034, 0.006, 0.012), gunmetal, 0, 0.058, 0.14 - i * 0.05);
    // handguard
    add(new THREE.BoxGeometry(0.052, 0.058, 0.30), polymer, 0, -0.004, -0.33);
    add(new THREE.BoxGeometry(0.056, 0.01, 0.28), dark, 0, -0.036, -0.33);
    // vent slots on handguard
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.054, 0.02, 0.03), dark, 0, 0.005, -0.24 - i * 0.06);
    // barrel + muzzle device
    add(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 12), gunmetal, 0, 0.008, -0.55, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.023, 0.023, 0.075, 12), dark, 0, 0.008, -0.70, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 12), gunmetal, 0, 0.008, -0.735, Math.PI / 2);
    // front sight post
    add(new THREE.BoxGeometry(0.008, 0.035, 0.008), gunmetal, 0, 0.045, -0.62);
    // stock (dropped so it stays below the ADS sight line)
    add(new THREE.BoxGeometry(0.042, 0.075, 0.20), polymer, 0, -0.12, 0.29);
    add(new THREE.BoxGeometry(0.042, 0.10, 0.03), dark, 0, -0.13, 0.395);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), gunmetal, 0, -0.06, 0.22, Math.PI / 2);
    // grip
    add(new THREE.BoxGeometry(0.042, 0.10, 0.05), polymer, 0, -0.085, 0.09, 0.32);
    // trigger guard + trigger
    add(new THREE.BoxGeometry(0.01, 0.008, 0.07), gunmetal, 0, -0.062, 0.02);
    add(new THREE.BoxGeometry(0.008, 0.03, 0.01), dark, 0, -0.05, 0.03, 0.2);
    // magazine
    this.mag = add(new THREE.BoxGeometry(0.044, 0.15, 0.068), gunmetal, 0, -0.115, -0.03, -0.12);
    add(new THREE.BoxGeometry(0.046, 0.02, 0.07), dark, 0, -0.185, -0.041, -0.12);
    // foregrip
    add(new THREE.BoxGeometry(0.032, 0.07, 0.038), polymer, 0, -0.068, -0.30);
    // charging handle + ejection port
    add(new THREE.BoxGeometry(0.02, 0.014, 0.05), dark, 0.035, 0.02, 0.06);
    add(new THREE.BoxGeometry(0.006, 0.026, 0.06), dark, 0.031, 0.005, -0.02);
    // red dot sight: open tube (mount + hood), ring + emissive dot
    add(new THREE.BoxGeometry(0.04, 0.018, 0.05), dark, 0, 0.056, -0.02);
    add(new THREE.BoxGeometry(0.04, 0.006, 0.05), dark, 0, 0.104, -0.02);
    add(new THREE.BoxGeometry(0.005, 0.042, 0.05), dark, -0.0195, 0.08, -0.02);
    add(new THREE.BoxGeometry(0.005, 0.042, 0.05), dark, 0.0195, 0.08, -0.02);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 8, 20), gunmetal);
    ring.position.set(0, 0.082, -0.045);
    g.add(ring);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.0028, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2818, emissiveIntensity: 8 })
    );
    dot.position.set(0, 0.082, -0.043);
    g.add(dot);
    // sling loop
    add(new THREE.TorusGeometry(0.012, 0.003, 6, 12), gunmetal, -0.026, -0.06, 0.3, 0, Math.PI / 2);

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.group = g;
    this.camera.add(g);

    // muzzle anchor + flash sprite + light
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.008, -0.75);
    g.add(this.muzzle);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex.muzzle, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
    }));
    this.flashSprite.visible = false;
    this.flashSprite.renderOrder = 20;
    this.muzzle.add(this.flashSprite);
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 8, 2);
    this.muzzle.add(this.muzzleLight);

    // dedicated viewmodel fill so the gun reads against dark walls
    this.fillLight = new THREE.PointLight(0xdfe8f0, 2.4, 1.4, 2);
    this.fillLight.position.set(-0.3, 0.45, -0.5);
    this.camera.add(this.fillLight);
  }

  _buildShells() {
    this.shells = [];
    const geo = new THREE.BoxGeometry(0.007, 0.007, 0.019);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, this._brassMat);
      m.visible = false;
      m.castShadow = true;
      this.scene.add(m);
      this.shells.push({ obj: m, vel: new THREE.Vector3(), ang: new THREE.Vector3(), life: 0, bounced: false });
    }
  }

  _ejectShell() {
    const s = this.shells.find(s => s.life <= 0);
    if (!s) return;
    this.group.updateWorldMatrix(true, false);
    const port = this._v1.set(0.04, 0.01, -0.02).applyMatrix4(this.group.matrixWorld);
    s.obj.visible = true;
    s.obj.position.copy(port);
    // eject right + up relative to view
    const right = this._v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = this._v3.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    s.vel.copy(right).multiplyScalar(1.6 + Math.random()).addScaledVector(up, 1.8 + Math.random());
    s.ang.set(Math.random() * 14, Math.random() * 14, Math.random() * 14);
    s.life = 1.4;
    s.bounced = false;
  }

  get spread() {
    const move = this.player.speedRatio * (this.adsT > 0.6 ? 0.006 : 0.02);
    const base = THREE.MathUtils.lerp(0.013, 0.0022, this.adsT);
    return base + move + this.bloom;
  }

  startReload() {
    if (this.reloading || this.ammo >= MAG_SIZE || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.audio.reload();
    this.ui.setReloading(true);
  }

  fire() {
    if (this.reloading || this.cooldown > 0 || this.player.dead) return;
    if (this.ammo <= 0) {
      this.audio.dryFire();
      this.cooldown = 0.25;
      this.startReload();
      return;
    }
    this.ammo--;
    this.cooldown = FIRE_INTERVAL;
    this.bloom = Math.min(0.02, this.bloom + 0.0038);
    this.kickZV += 2.6 + Math.random() * 0.5;
    this.kickXV += 1.5 + Math.random() * 0.6;
    this.flashT = 0.045;
    this.muzzleLight.intensity = 42;
    this.flashSprite.visible = true;
    this.flashSprite.material.rotation = Math.random() * Math.PI * 2;
    const fs = 0.22 + Math.random() * 0.14;
    this.flashSprite.scale.set(fs, fs, 1);
    this._ejectShell();
    this.audio.shot();

    // camera recoil
    const ads = this.adsT > 0.6;
    this.player.pitch += (ads ? 0.0038 : 0.0062) + Math.random() * 0.003;
    this.player.yaw += (Math.random() - 0.5) * (ads ? 0.002 : 0.0035);

    // hitscan
    const origin = this.camera.getWorldPosition(this._v1.clone());
    const dir = this.camera.getWorldDirection(this._v2.clone());
    const sp = this.spread;
    dir.x += (Math.random() - 0.5) * sp * 2;
    dir.y += (Math.random() - 0.5) * sp * 2;
    dir.z += (Math.random() - 0.5) * sp * 2;
    dir.normalize();
    this.raycaster.set(origin, dir);

    const targets = [...this.enemies.hitMeshes, ...this.level.solids];
    const hits = this.raycaster.intersectObjects(targets, false);
    const muzzleWorld = this.muzzle.getWorldPosition(this._v3.clone());
    let end = origin.clone().addScaledVector(dir, 60);

    if (hits.length > 0) {
      const h = hits[0];
      end = h.point;
      const drone = h.object.userData.drone;
      if (drone) {
        const killed = this.enemies.damage(drone, DAMAGE, h.point);
        this.fx.sparks(h.point, dir.clone().negate(), 8, 0xffa060, 4);
        this.ui.hitmarker(killed);
        if (killed) this.audio.kill(); else this.audio.hit();
      } else {
        const n = h.face
          ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
          : dir.clone().negate();
        this.fx.decal(h.point, n, 0.15);
        this.fx.sparks(h.point, n, 7, 0xffd9a0, 4.5);
        this.fx.smoke(h.point, 1, 0.12, 0.5, 0x8a8f96);
        this.fx.light(h.point, 0xffc890, 14);
      }
    }
    this.fx.tracer(muzzleWorld, end, 0xffd9a0);
    this.ui.setAmmo(this.ammo, this.reserve);
    if (this.ammo === 0) this.ui.setAmmoEmpty(true);
  }

  update(dt, time, input, lookDX, lookDY) {
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.028);

    // ADS blend
    const adsTarget = input.ads && !this.reloading && !this.player.sprinting ? 1 : 0;
    this.adsT = THREE.MathUtils.lerp(this.adsT, adsTarget, Math.min(1, dt * 11));
    this.ui.setADS(this.adsT > 0.6);

    // recoil springs
    this.kickZV += (-this.kickZ * 210 - this.kickZV * 17) * dt;
    this.kickZ += this.kickZV * dt;
    this.kickXV += (-this.kickX * 190 - this.kickXV * 15) * dt;
    this.kickX += this.kickXV * dt;

    // sway from look input (weapon lags the camera)
    const swayScale = 1 - this.adsT * 0.85;
    const tx = THREE.MathUtils.clamp(-lookDX * 0.00045, -0.028, 0.028) * swayScale;
    const ty = THREE.MathUtils.clamp(lookDY * 0.00035, -0.022, 0.022) * swayScale;
    this.swayX = THREE.MathUtils.lerp(this.swayX, tx, Math.min(1, dt * 9));
    this.swayY = THREE.MathUtils.lerp(this.swayY, ty, Math.min(1, dt * 9));

    // reload animation
    let reloadDip = 0, reloadRot = 0;
    if (this.reloading) {
      this.reloadT += dt;
      const t = this.reloadT / RELOAD_TIME;
      reloadDip = Math.sin(Math.min(1, t) * Math.PI) * 0.16;
      reloadRot = Math.sin(Math.min(1, t) * Math.PI) * -0.55;
      if (this.reloadT >= RELOAD_TIME) {
        const need = MAG_SIZE - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
        this.ui.setReloading(false);
        this.ui.setAmmo(this.ammo, this.reserve);
        this.ui.setAmmoEmpty(false);
      }
    }

    // compose viewmodel transform
    const p = this.player;
    const bobScale = (1 - this.adsT * 0.82) * p.bobAmp;
    const bobX = Math.cos(p.bobPhase) * 0.014 * bobScale;
    const bobY = Math.sin(p.bobPhase * 2) * 0.011 * bobScale;
    const breathe = Math.sin(time * 1.4) * 0.0022 * (1 - this.adsT * 0.7);
    const sprintDip = p.sprinting ? 0.05 : 0;

    this.group.position.lerpVectors(this.hipPos, this.adsPos, this.adsT);
    this.group.position.x += this.swayX + bobX;
    this.group.position.y += this.swayY + bobY + breathe - reloadDip - sprintDip + p.landDip * 0.6;
    this.group.position.z += this.kickZ * 0.045;
    this.group.rotation.set(
      this.kickX * 0.05 + reloadRot + this.swayY * 0.9 + (p.sprinting ? 0.12 : 0),
      this.swayX * 1.2 + (p.sprinting ? -0.1 : 0),
      this.swayX * 0.6 + Math.cos(p.bobPhase) * 0.008 * bobScale
    );

    // muzzle flash + light decay
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flashSprite.visible = false;
    }
    this.muzzleLight.intensity *= Math.max(0, 1 - dt * 26);
    if (this.muzzleLight.intensity < 0.3) this.muzzleLight.intensity = 0;

    // brass physics
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.obj.visible = false; continue; }
      s.vel.y -= 14 * dt;
      s.obj.position.addScaledVector(s.vel, dt);
      s.obj.rotation.x += s.ang.x * dt;
      s.obj.rotation.y += s.ang.y * dt;
      s.obj.rotation.z += s.ang.z * dt;
      if (s.obj.position.y < 0.008) {
        s.obj.position.y = 0.008;
        if (!s.bounced) {
          s.vel.y *= -0.35; s.vel.x *= 0.5; s.vel.z *= 0.5;
          s.ang.multiplyScalar(0.4);
          s.bounced = true;
        } else {
          s.vel.set(0, 0, 0); s.ang.set(0, 0, 0);
        }
      }
    }
  }

  reset() {
    this.ammo = MAG_SIZE;
    this.reserve = 270;
    this.cooldown = 0;
    this.reloading = false;
    this.bloom = 0;
    this.adsT = 0;
    this.kickZ = this.kickZV = this.kickX = this.kickXV = 0;
    for (const s of this.shells) { s.life = 0; s.obj.visible = false; }
    this.ui.setAmmo(this.ammo, this.reserve);
    this.ui.setReloading(false);
    this.ui.setAmmoEmpty(false);
  }
}