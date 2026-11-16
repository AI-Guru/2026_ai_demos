/**
 * Tiger UHT flight model — arcade-sim, Comanche-style.
 * Cyclic controls attitude/speed, collective controls lift, bank turns are
 * coordinated. Hover assist, ground effect, skid landings, crash detection,
 * fuel, damage-degraded handling.
 */
const DEG = Math.PI / 180;

export class FlightModel {
  constructor(spawn, terrainH, waterLevel) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.groundH = terrainH(spawn.x, spawn.z);
    this.y = this.groundH + 2.0;
    this.heading = (spawn.heading ?? 0) * DEG;
    this.speed = 0;
    this.vy = 0;
    this.pitch = 0;
    this.roll = 0;
    this.collective = 0.5;
    this.rpm = 340;
    this.fuel = 1;
    this.hp = 1;
    this.landed = true;
    this.crashed = false;
    this.agl = 2;
    this.waterLevel = waterLevel;
    this.weight = 1;
    this.t = 0;
    this.boundary = false;
    this.justLanded = false;
    this.justCrashed = false;
  }

  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }
  get vel() {
    const f = this.forward;
    return { x: f.x * this.speed, y: this.vy, z: f.z * this.speed };
  }
  get kmh() { return Math.abs(this.speed) * 3.6; }

  damage(amount) {
    if (this.crashed) return;
    this.hp = Math.max(0, this.hp - amount / 100);
    if (this.hp <= 0) this.crashed = true;
  }

  update(dt, axes, terrainH) {
    this.t += dt;
    this.justLanded = false;
    this.justCrashed = false;
    if (this.crashed) {
      // ballistic fall
      this.vy -= 9.81 * dt;
      this.speed *= 1 - 0.4 * dt;
      this.roll += 1.4 * dt;
      this.pitch -= 0.5 * dt;
      this.x += Math.sin(this.heading) * this.speed * dt;
      this.z += Math.cos(this.heading) * this.speed * dt;
      this.y += this.vy * dt;
      const g = Math.max(terrainH(this.x, this.z), this.waterLevel);
      if (this.y <= g + 1) { this.y = g + 1; this.justCrashed = true; }
      return;
    }

    const degraded = this.hp < 0.35;
    const wobble = degraded ? Math.sin(this.t * 7.3) * 0.05 + Math.sin(this.t * 3.1) * 0.04 : 0;
    const authority = degraded ? 0.72 : 1;

    // attitude targets
    const targetPitch = -axes.cyclic * 14 * DEG + wobble * 0.5;
    const targetRoll = axes.roll * 34 * DEG + wobble;
    this.pitch += clamp(targetPitch - this.pitch, -2.6 * dt, 2.6 * dt);
    this.roll += clamp(targetRoll - this.roll, -3.4 * dt, 3.4 * dt);

    // collective
    this.collective = clamp(this.collective + axes.coll * 0.55 * dt, 0.04, 1);

    // heading: coordinated bank turn + pedal yaw
    const bankTurn = Math.tan(this.roll) * 9.81 / Math.max(Math.abs(this.speed), 14) * 1.3;
    const pedal = axes.yaw * (0.9 - Math.min(Math.abs(this.speed) / 85, 1) * 0.55);
    this.heading += (bankTurn + pedal) * authority * dt;
    if (this.heading > Math.PI) this.heading -= 2 * Math.PI;
    if (this.heading < -Math.PI) this.heading += 2 * Math.PI;

    // longitudinal: nose-down accelerates, quadratic drag limits ~300 km/h
    const thrust = -Math.sin(this.pitch) * 26 / this.weight;
    const drag = this.speed * Math.abs(this.speed) * 0.00092;
    this.speed += (thrust - drag) * dt;
    if (this.landed) this.speed *= 1 - 2.8 * dt;
    this.speed = clamp(this.speed, -12, 88);

    // vertical
    let lift = this.collective * 19.6;
    if (this.y > 1300) lift *= Math.max(0.25, 1 - (this.y - 1300) / 700);
    this.vy += (lift - 9.81 - this.vy * 0.55) * dt;
    if (this.agl < 12) this.vy += ((12 - this.agl) / 12) * 2.2 * this.collective * dt; // ground effect
    if (axes.coll === 0 && Math.abs(this.speed) < 10 && !this.landed) {
      this.vy *= 1 - 1.3 * dt; // hover assist
    }
    this.vy = clamp(this.vy, -22, 16);

    // integrate
    const f = this.forward;
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;
    this.y += this.vy * dt;

    // bounds
    this.boundary = false;
    if (this.x < 90) { this.x = 90; this.boundary = true; }
    if (this.x > 4006) { this.x = 4006; this.boundary = true; }
    if (this.z < 90) { this.z = 90; this.boundary = true; }
    if (this.z > 4006) { this.z = 4006; this.boundary = true; }

    // ground contact
    const terr = terrainH(this.x, this.z);
    const isWater = terr < this.waterLevel;
    const surface = isWater ? this.waterLevel : terr;
    this.agl = this.y - surface;
    this.groundH = terr;
    if (this.agl <= 2.0) {
      const hard = this.vy < -4.2 || Math.abs(this.speed) > 17 || isWater;
      if (hard) {
        this.crashed = true;
        this.justCrashed = true;
        this.y = surface + 1;
      } else {
        if (!this.landed) this.justLanded = true;
        this.landed = true;
        this.y = surface + 2.0;
        this.vy = 0;
        this.pitch *= 1 - 4 * dt;
        this.roll *= 1 - 4 * dt;
        if (this.collective > 0.62) this.landed = false;
      }
    } else {
      this.landed = false;
    }

    // rotor / fuel
    this.rpm = 336 + this.collective * 16 + Math.abs(this.speed) * 0.02;
    this.fuel = Math.max(0, this.fuel - dt * (0.00045 + this.collective * 0.0009 + Math.abs(this.speed) * 0.0000035));
    if (this.fuel <= 0) {
      // engine failure: autorotation-ish descent
      this.collective = Math.max(0.12, this.collective - 0.3 * dt);
    }
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }