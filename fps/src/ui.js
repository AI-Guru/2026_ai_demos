// ============================================================
// DOM HUD + overlay state
// ============================================================
const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.hud = $('hud');
    this.menu = $('menu');
    this.pause = $('pause');
    this.death = $('death');
    this.healthFill = $('health-fill');
    this.healthNum = $('health-num');
    this.ammoMag = $('ammo-mag');
    this.ammoRes = $('ammo-res');
    this.reloadHint = $('reload-hint');
    this.waveNum = $('wave-num');
    this.scoreNum = $('score-num');
    this.killsNum = $('kills-num');
    this.centerMsg = $('center-msg');
    this.damageVignette = $('damage-vignette');
    this.lowHealthVignette = $('low-health-vignette');
    this.hitmarkerEl = $('hitmarker');
    this.crosshair = $('crosshair');
    this.deathStats = $('death-stats');
    this.loading = $('menu-loading');
    this._dmg = 0;
    this._msgTimer = null;
  }

  ready() { this.loading.style.display = 'none'; }

  showMenu() { this.menu.classList.remove('hidden'); this.hud.classList.add('hidden'); }
  showHUD() {
    this.menu.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.death.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }
  showPause() { this.pause.classList.remove('hidden'); }
  hidePause() { this.pause.classList.add('hidden'); }
  showDeath(stats) {
    this.deathStats.innerHTML =
      `WAVES SURVIVED <b>${stats.waves}</b><br>` +
      `HOSTILES DOWN <b>${stats.kills}</b><br>` +
      `FINAL SCORE <b>${stats.score}</b>`;
    this.death.classList.remove('hidden');
  }

  setHealth(h) {
    const v = Math.max(0, Math.round(h));
    this.healthFill.style.width = v + '%';
    this.healthNum.textContent = v;
    this.healthFill.classList.toggle('low', v <= 30);
    this.lowHealthVignette.style.opacity = v <= 30 ? String(0.4 + 0.3 * Math.sin(performance.now() / 280)) : '0';
  }

  setAmmo(mag, res) {
    this.ammoMag.textContent = mag;
    this.ammoRes.textContent = res;
  }
  setAmmoEmpty(empty) { this.ammoMag.classList.toggle('empty', empty); }
  setReloading(r) { this.reloadHint.classList.toggle('hidden', !r); }
  setADS(ads) { this.hud.classList.toggle('ads', ads); }

  setWave(n) { this.waveNum.textContent = n; }
  setScore(s) { this.scoreNum.textContent = s; }
  setKills(k) { this.killsNum.textContent = k; }

  setCrosshairSpread(px) {
    this.crosshair.style.setProperty('--spread', px.toFixed(1) + 'px');
  }

  hitmarker(kill) {
    const el = this.hitmarkerEl;
    el.classList.remove('show');
    el.classList.toggle('kill', kill);
    void el.offsetWidth; // restart animation
    el.classList.add('show');
  }

  damageFlash(amount = 0.8) { this._dmg = Math.min(1, this._dmg + amount); }

  message(text, dur = 2.2, warn = false) {
    this.centerMsg.textContent = text;
    this.centerMsg.classList.toggle('warn', warn);
    this.centerMsg.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => this.centerMsg.classList.remove('show'), dur * 1000);
  }

  update(dt) {
    if (this._dmg > 0) {
      this._dmg = Math.max(0, this._dmg - dt * 1.6);
      this.damageVignette.style.opacity = this._dmg.toFixed(3);
    }
  }
}