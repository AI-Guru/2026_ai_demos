// ============================================================
// FX: pooled sprites (sparks / smoke / flashes), bullet decals,
// tracers, shockwave rings, one shared impact light.
// ============================================================
import * as THREE from 'three';

const MAX_SPRITES = 260;
const MAX_DECALS = 72;
const MAX_TRACERS = 24;
const MAX_RINGS = 8;

export class FX {
  constructor(scene, tex) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.sprites = [];
    this.decals = [];
    this.tracers = [];
    this.rings = [];
    this.decalIdx = 0;

    const sparkBase = new THREE.SpriteMaterial({
      map: tex.spark, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    const smokeBase = new THREE.SpriteMaterial({
      map: tex.smoke, blending: THREE.NormalBlending, depthWrite: false, transparent: true,
    });
    for (let i = 0; i < MAX_SPRITES; i++) {
      const additive = i < MAX_SPRITES * 0.7;
      const s = new THREE.Sprite((additive ? sparkBase : smokeBase).clone());
      s.visible = false;
      s.renderOrder = 8;
      this.group.add(s);
      this.sprites.push({
        obj: s, additive, life: 0, maxLife: 1, vel: new THREE.Vector3(),
        gravity: 0, drag: 0, grow: 0, size0: 0.1, spin: 0,
      });
    }

    const decalMat = new THREE.MeshBasicMaterial({
      map: tex.bulletHole, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(decalGeo, decalMat);
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.decals.push(m);
    }

    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      m.renderOrder = 7;
      this.group.add(m);
      this.tracers.push({ obj: m, life: 0 });
    }

    const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffc080, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      m.renderOrder = 8;
      this.group.add(m);
      this.rings.push({ obj: m, life: 0 });
    }

    this.impactLight = new THREE.PointLight(0xffc890, 0, 9, 2);
    this.group.add(this.impactLight);
    this._lightDecay = 0;
  }

  _sprite(additive) {
    // find a dead slot, prefer matching blend mode
    for (let i = 0; i < MAX_SPRITES; i++) {
      const s = this.sprites[i];
      if (s.life <= 0 && s.additive === additive) return s;
    }
    for (const s of this.sprites) if (s.life <= 0) return s;
    return null;
  }

  spawn(pos, opts) {
    const s = this._sprite(opts.additive !== false);
    if (!s) return;
    const o = s.obj;
    o.visible = true;
    o.position.copy(pos);
    o.material.color.set(opts.color ?? 0xffffff);
    o.material.opacity = opts.opacity ?? 1;
    o.material.rotation = Math.random() * Math.PI * 2;
    s.size0 = opts.size ?? 0.08;
    o.scale.setScalar(s.size0);
    s.life = s.maxLife = opts.life ?? 0.5;
    s.vel.copy(opts.vel ?? new THREE.Vector3());
    s.gravity = opts.gravity ?? 0;
    s.drag = opts.drag ?? 0;
    s.grow = opts.grow ?? 0;
    s.spin = opts.spin ?? 0;
    s.baseOpacity = opts.opacity ?? 1;
  }

  sparks(pos, normal, count = 10, color = 0xffc873, speed = 5) {
    const n = normal ?? new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)
      ).multiplyScalar(2).add(n).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      this.spawn(pos, {
        color, size: 0.03 + Math.random() * 0.05, life: 0.25 + Math.random() * 0.4,
        vel: v, gravity: -12, drag: 1.2, additive: true,
      });
    }
  }

  smoke(pos, count = 4, size = 0.35, life = 1.2, color = 0x777d85) {
    for (let i = 0; i < count; i++) {
      this.spawn(pos, {
        color, size: size * (0.7 + Math.random() * 0.6), life: life * (0.7 + Math.random() * 0.6),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5),
        drag: 0.8, grow: size * 1.6, opacity: 0.32, additive: false, spin: (Math.random() - 0.5) * 1.5,
      });
    }
  }

  flash(pos, size = 0.6, color = 0xffe0b0, life = 0.08) {
    this.spawn(pos, { color, size, life, additive: true, opacity: 0.95 });
  }

  explosion(pos) {
    this.flash(pos, 1.6, 0xffd9a0, 0.12);
    this.sparks(pos, new THREE.Vector3(0, 1, 0), 26, 0xffb050, 8);
    this.sparks(pos, new THREE.Vector3(0, 1, 0), 12, 0xff5030, 5);
    this.smoke(pos, 8, 0.6, 1.8, 0x3a3f45);
    this.ring(pos);
    this.light(pos, 0xffa050, 90);
  }

  ring(pos) {
    const r = this.rings.find(r => r.life <= 0);
    if (!r) return;
    r.obj.visible = true;
    r.obj.position.copy(pos);
    r.obj.scale.setScalar(0.2);
    r.obj.material.opacity = 0.8;
    r.life = 0.4;
  }

  tracer(from, to, color = 0xffd9a0) {
    const t = this.tracers.find(t => t.life <= 0);
    if (!t) return;
    const o = t.obj;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.1) return;
    o.visible = true;
    o.position.copy(from).addScaledVector(dir, 0.5);
    o.lookAt(to);
    o.scale.set(0.018, 0.018, len);
    o.material.color.set(color);
    o.material.opacity = 0.85;
    t.life = 0.07;
  }

  decal(pos, normal, size = 0.16) {
    const m = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % MAX_DECALS;
    m.visible = true;
    m.position.copy(pos).addScaledVector(normal, 0.006);
    m.lookAt(pos.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size * (0.8 + Math.random() * 0.5));
    m.material.opacity = 1;
  }

  light(pos, color = 0xffc890, intensity = 50) {
    this.impactLight.position.copy(pos);
    this.impactLight.color.set(color);
    this.impactLight.intensity = intensity;
    this._lightDecay = intensity;
  }

  update(dt, camera) {
    for (const s of this.sprites) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const o = s.obj;
      if (s.life <= 0) { o.visible = false; continue; }
      s.vel.y += s.gravity * dt;
      if (s.drag) s.vel.multiplyScalar(Math.max(0, 1 - s.drag * dt));
      o.position.addScaledVector(s.vel, dt);
      if (o.position.y < 0.02 && s.gravity < 0) { o.position.y = 0.02; s.vel.y *= -0.3; s.vel.x *= 0.6; s.vel.z *= 0.6; }
      const t = s.life / s.maxLife;
      o.material.opacity = s.baseOpacity * (s.additive ? t : Math.min(1, t * 2));
      if (s.grow) o.scale.setScalar(s.size0 + s.grow * (1 - t));
      if (s.spin) o.material.rotation += s.spin * dt;
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.obj.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) t.obj.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / 0.4;
      r.obj.scale.setScalar(0.2 + t * 3.2);
      r.obj.material.opacity = 0.8 * (1 - t);
      r.obj.lookAt(camera.position);
      if (r.life <= 0) r.obj.visible = false;
    }
    if (this.impactLight.intensity > 0) {
      this.impactLight.intensity *= Math.max(0, 1 - dt * 20);
      if (this.impactLight.intensity < 0.5) this.impactLight.intensity = 0;
    }
  }

  reset() {
    for (const s of this.sprites) { s.life = 0; s.obj.visible = false; }
    for (const d of this.decals) d.visible = false;
    for (const t of this.tracers) { t.life = 0; t.obj.visible = false; }
    for (const r of this.rings) { r.life = 0; r.obj.visible = false; }
    this.impactLight.intensity = 0;
    this.decalIdx = 0;
  }
}