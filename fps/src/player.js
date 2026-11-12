// ============================================================
// Player: pointer-lock FPS controller with AABB physics,
// sprint / jump, head-bob, landing dip, health + regen.
// ============================================================
import * as THREE from 'three';

const HALF = 0.34;       // half width/depth
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 24;
const JUMP = 7.9;
const WALK = 4.4;
const SPRINT = 7.1;

export class Player {
  constructor(camera, level, audio) {
    this.camera = camera;
    this.level = level;
    this.audio = audio;
    camera.rotation.order = 'YXZ';
    this.pos = level.playerSpawn.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.health = 100;
    this.lastDamage = -100;
    this.dead = false;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.landDip = 0;
    this.landVel = 0;
    this.stepDist = 0;
    this.speedRatio = 0;
    this.sprinting = false;
    this.god = false;
    this._box = new THREE.Box3();
    this._tmp = new THREE.Vector3();
  }

  reset() {
    this.pos.copy(this.level.playerSpawn);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.health = 100; this.dead = false;
    this.lastDamage = -100;
    this.landDip = 0; this.landVel = 0;
  }

  look(dx, dy, sensitivity = 0.0022) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  _collide(axis) {
    const p = this.pos;
    this._box.min.set(p.x - HALF, p.y, p.z - HALF);
    this._box.max.set(p.x + HALF, p.y + HEIGHT, p.z + HALF);
    for (const c of this.level.colliders) {
      if (!this._box.intersectsBox(c)) continue;
      if (axis === 'x') {
        if (this.vel.x > 0) p.x = c.min.x - HALF - 0.001;
        else if (this.vel.x < 0) p.x = c.max.x + HALF + 0.001;
        this.vel.x = 0;
      } else if (axis === 'z') {
        if (this.vel.z > 0) p.z = c.min.z - HALF - 0.001;
        else if (this.vel.z < 0) p.z = c.max.z + HALF + 0.001;
        this.vel.z = 0;
      } else {
        if (this.vel.y <= 0 && this._box.min.y < c.max.y && this._box.max.y > c.max.y) {
          // landing on top
          if (p.y + HEIGHT > c.max.y && p.y < c.max.y) {
            p.y = c.max.y;
            if (!this.onGround && this.vel.y < -5) {
              this.landVel = this.vel.y * 0.012;
              this.audio.land();
            }
            this.vel.y = 0;
            this.onGround = true;
          }
        } else if (this.vel.y > 0) {
          p.y = c.min.y - HEIGHT - 0.001;
          this.vel.y = 0;
        }
      }
      this._box.min.set(p.x - HALF, p.y, p.z - HALF);
      this._box.max.set(p.x + HALF, p.y + HEIGHT, p.z + HALF);
    }
  }

  update(dt, input, time) {
    if (this.dead) {
      // death cam: sink & tilt
      this.camera.position.set(this.pos.x, Math.max(0.35, this.camera.position.y - dt * 1.4), this.pos.z);
      this.camera.rotation.z = THREE.MathUtils.lerp(this.camera.rotation.z, 0.5, dt * 2);
      this.camera.rotation.x = THREE.MathUtils.lerp(this.camera.rotation.x, -0.15, dt * 2);
      return;
    }

    // ---- look ----
    this.look(input.mouseDX, input.mouseDY, input.ads ? 0.0015 : 0.0022);
    input.mouseDX = 0; input.mouseDY = 0;

    // ---- wish direction ----
    const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = this._tmp.set(-sin * f + cos * s, 0, -cos * f - sin * s);
    if (wish.lengthSq() > 0) wish.normalize();

    this.sprinting = input.sprint && f > 0 && !input.ads;
    const maxSpeed = this.sprinting ? SPRINT : (input.ads ? WALK * 0.6 : WALK);
    const accel = this.onGround ? 55 : 10;

    // friction
    if (this.onGround) {
      const drop = Math.max(0, 1 - 9 * dt);
      this.vel.x *= drop; this.vel.z *= drop;
    }
    // accelerate toward wish velocity
    const cur = this.vel.x * wish.x + this.vel.z * wish.z;
    const add = maxSpeed - cur;
    if (add > 0) {
      const a = Math.min(accel * dt * maxSpeed, add);
      this.vel.x += wish.x * a;
      this.vel.z += wish.z * a;
    }

    // jump
    if (input.jump && this.onGround) {
      this.vel.y = JUMP;
      this.onGround = false;
      this.audio.jump();
    }
    this.vel.y -= GRAVITY * dt;

    // integrate + resolve per axis
    this.onGround = false;
    this.pos.x += this.vel.x * dt; this._collide('x');
    this.pos.z += this.vel.z * dt; this._collide('z');
    this.pos.y += this.vel.y * dt; this._collide('y');
    // floor
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vel.y < -5) {
        this.landVel = this.vel.y * 0.012;
        this.audio.land();
      }
      this.pos.y = 0; this.vel.y = 0; this.onGround = true;
    }
    // room bounds safety
    const b = this.level.bounds;
    this.pos.x = Math.max(b.minX, Math.min(b.maxX, this.pos.x));
    this.pos.z = Math.max(b.minZ, Math.min(b.maxZ, this.pos.z));

    // ---- camera ----
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speedRatio = hSpeed / SPRINT;
    if (this.onGround && hSpeed > 0.5) {
      this.bobPhase += dt * (4.6 + hSpeed * 1.15);
      this.bobAmp = THREE.MathUtils.lerp(this.bobAmp, Math.min(1, hSpeed / WALK), dt * 8);
      this.stepDist += hSpeed * dt;
      const stride = this.sprinting ? 2.5 : 2.0;
      if (this.stepDist > stride) { this.stepDist = 0; this.audio.step(this.sprinting); }
    } else {
      this.bobAmp = THREE.MathUtils.lerp(this.bobAmp, 0, dt * 6);
    }
    // landing dip spring
    this.landVel += (-this.landDip * 140 - this.landVel * 14) * dt;
    this.landDip += this.landVel * dt;

    const bobY = Math.sin(this.bobPhase * 2) * 0.032 * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.018 * this.bobAmp;
    this.camera.position.set(
      this.pos.x + bobX * cos,
      this.pos.y + EYE + bobY + this.landDip,
      this.pos.z - bobX * sin
    );
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = Math.cos(this.bobPhase) * 0.006 * this.bobAmp - s * 0.012;

    // ---- health regen ----
    if (this.health < 100 && time - this.lastDamage > 5) {
      this.health = Math.min(100, this.health + dt * 9);
    }
  }

  applyDamage(amount, time) {
    if (this.dead || this.god) return false;
    this.health -= amount;
    this.lastDamage = time;
    this.audio.hurt();
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      return true;
    }
    return false;
  }

  // capsule test for enemy bolts
  hitTest(point, radius = 0.42) {
    const p = this.pos;
    const cy = Math.max(p.y + 0.35, Math.min(p.y + HEIGHT - 0.25, point.y));
    const dx = point.x - p.x, dz = point.z - p.z, dy = point.y - cy;
    return dx * dx + dy * dy + dz * dz < radius * radius;
  }
}