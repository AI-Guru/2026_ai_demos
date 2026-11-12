// ============================================================
// SECTOR 07 — main orchestrator: renderer, state machine,
// input, wave flow, camera direction, debug hooks.
// ============================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTextures } from './textures.js';
import { buildLevel } from './level.js';
import { createPost } from './post.js';
import { FX } from './fx.js';
import { AudioEngine } from './audio.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { Enemies } from './enemies.js';
import { UI } from './ui.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const QUALITY = params.get('quality') === 'low' ? 'low' : 'high';
const TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (TOUCH) document.body.classList.add('touch');

const canvas = document.getElementById('scene');
const ui = new UI();

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, stencil: false, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 120);
scene.add(camera);

// ---- state ----
let state = 'menu';            // menu | playing | paused | dead
let gameTime = 0;
let elapsed = 0;
let wave = 0, score = 0, kills = 0;
let waveCountdown = 0;
let deathTimer = 0, deathShown = false;
let difficulty = 'normal';
let lastHealthShown = -1;

const input = {
  forward: false, back: false, left: false, right: false,
  sprint: false, jump: false, fire: false, ads: false,
  mouseDX: 0, mouseDY: 0,
};

// ---- world & systems (built after first paint) ----
let tex, level, fx, audio, player, weapon, enemies, post;
const aoExclude = [];

function init() {
  tex = createTextures();
  level = buildLevel(scene, tex, renderer);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  fx = new FX(scene, tex);
  audio = new AudioEngine();
  player = new Player(camera, level, audio);

  enemies = new Enemies(scene, level, fx, audio, tex, player, {
    onKill(points) {
      kills++; score += points;
      ui.setKills(kills); ui.setScore(score);
    },
    onPlayerHit(dmg) {
      if (state !== 'playing') return;
      if (!player.god) ui.damageFlash(0.6);
      const died = player.applyDamage(dmg, gameTime);
      if (died) die();
    },
    onHeal(amount) {
      player.health = Math.min(100, player.health + amount);
      ui.message('+25 INTEGRITY', 1.1);
    },
    onWaveCleared(n) {
      score += 250;
      ui.setScore(score);
      ui.message(`WAVE ${n} CLEARED  ·  +250`, 2.4);
      waveCountdown = 4.2;
    },
  });

  weapon = new Weapon(scene, camera, level, fx, audio, tex, enemies, player, ui);
  weapon.group.visible = false;

  aoExclude.push(fx.group, weapon.group, ...level.atmoObjects);
  post = createPost(renderer, scene, camera, QUALITY, aoExclude);

  bindEvents();
  ui.ready();
  if (DEBUG) { audio.init(); startGame(); }
  requestAnimationFrame(loop);
}

// ---- flow ----
function applyDifficulty() {
  if (difficulty === 'veteran') {
    enemies.dmgScale = 1.35; enemies.speedBonus = 0.7; enemies.countBonus = 2;
  } else {
    enemies.dmgScale = 1; enemies.speedBonus = 0; enemies.countBonus = 0;
  }
}

function startGame() {
  applyDifficulty();
  player.reset();
  enemies.reset();
  weapon.reset();
  fx.reset();
  wave = 0; score = 0; kills = 0;
  gameTime = 0;
  waveCountdown = 2.6;
  deathShown = false;
  ui.setWave(1); ui.setScore(0); ui.setKills(0);
  ui.setHealth(100);
  ui.showHUD();
  ui.message('HOLD THE BAY', 2.2);
  weapon.group.visible = true;
  state = 'playing';
}

function die() {
  state = 'dead';
  deathTimer = 1.7;
  audio.death();
  audio.setDroneHum(0);
  ui.message('SIGNAL LOST', 1.6, true);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  ui.showPause();
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  ui.hidePause();
}

// ---- events ----
function bindEvents() {
  const deploy = () => {
    audio.init();
    startGame();
    if (!DEBUG && !TOUCH) canvas.requestPointerLock?.()?.catch?.(() => {});
  };
  document.getElementById('deploy-btn').addEventListener('click', deploy);
  document.getElementById('menu').addEventListener('click', (e) => {
    if (e.target.closest('.diff-btn')) return;
    deploy();
  });
  document.getElementById('resume-btn').addEventListener('click', () => {
    audio.init();
    if (DEBUG || TOUCH) resumeGame();
    else canvas.requestPointerLock?.()?.catch?.(() => {});
  });
  document.getElementById('pause').addEventListener('click', (e) => {
    if (e.target.id === 'pause') {
      if (DEBUG || TOUCH) resumeGame();
      else canvas.requestPointerLock?.()?.catch?.(() => {});
    }
  });
  document.getElementById('restart-btn').addEventListener('click', () => {
    audio.init();
    startGame();
    if (!DEBUG && !TOUCH) canvas.requestPointerLock?.()?.catch?.(() => {});
  });
  document.getElementById('death').addEventListener('click', (e) => {
    if (e.target.id === 'death' && deathShown) {
      audio.init();
      startGame();
      if (!DEBUG && !TOUCH) canvas.requestPointerLock?.()?.catch?.(() => {});
    }
  });
  document.getElementById('pause-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    pauseGame();
  });

  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = btn.dataset.diff;
    });
  });

  const muteBtn = document.getElementById('mute-btn');
  const toggleMute = () => {
    if (!audio.ctx) return;
    audio.setMuted(!audio.muted);
    muteBtn.textContent = audio.muted ? 'AUDIO OFF' : 'AUDIO ON';
    muteBtn.classList.toggle('muted', audio.muted);
  };
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked && state === 'paused') resumeGame();
    else if (!locked && state === 'playing' && !DEBUG && !TOUCH) pauseGame();
  });

  document.addEventListener('mousemove', (e) => {
    if (state !== 'playing') return;
    if (!DEBUG && document.pointerLockElement !== canvas) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (state !== 'playing') return;
    if (e.button === 0) input.fire = true;
    if (e.button === 2) input.ads = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) input.ads = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  const keymap = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    Space: 'jump',
  };
  document.addEventListener('keydown', (e) => {
    if (keymap[e.code] !== undefined) {
      input[keymap[e.code]] = true;
      if (e.code === 'Space') e.preventDefault();
    }
    if (e.code === 'KeyR' && state === 'playing') weapon.startReload();
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'Escape' && DEBUG) {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (keymap[e.code] !== undefined) input[keymap[e.code]] = false;
  });

  // ---- touch controls ----
  if (TOUCH) {
    const stickBase = document.getElementById('stick-base');
    const stickKnob = document.getElementById('stick-knob');
    let stickId = null, lookId = null;
    let stickOX = 0, stickOY = 0, lookLX = 0, lookLY = 0;

    const setStick = (dx, dy) => {
      const max = 44;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const nx = dx / max, ny = dy / max;
      input.left = nx < -0.3; input.right = nx > 0.3;
      input.forward = ny < -0.3; input.back = ny > 0.3;
    };
    const clearStick = () => {
      stickId = null;
      stickBase.classList.remove('on');
      input.left = input.right = input.forward = input.back = false;
      stickKnob.style.transform = 'translate(-50%, -50%)';
    };

    document.addEventListener('touchstart', (e) => {
      if (state !== 'playing') return;
      for (const t of e.changedTouches) {
        if (t.target.closest('.t-btn') || t.target.closest('#pause-btn') || t.target.closest('#mute-btn')) continue;
        if (t.clientX < window.innerWidth * 0.45 && stickId === null) {
          stickId = t.identifier;
          stickOX = t.clientX; stickOY = t.clientY;
          stickBase.style.left = t.clientX + 'px';
          stickBase.style.top = t.clientY + 'px';
          stickBase.classList.add('on');
          setStick(0, 0);
        } else if (lookId === null) {
          lookId = t.identifier;
          lookLX = t.clientX; lookLY = t.clientY;
        }
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (state !== 'playing') return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          setStick(t.clientX - stickOX, t.clientY - stickOY);
        } else if (t.identifier === lookId) {
          input.mouseDX += (t.clientX - lookLX) * 2.4;
          input.mouseDY += (t.clientY - lookLY) * 2.4;
          lookLX = t.clientX; lookLY = t.clientY;
        }
      }
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) clearStick();
        if (t.identifier === lookId) lookId = null;
      }
    };
    document.addEventListener('touchend', endTouch);
    document.addEventListener('touchcancel', endTouch);

    const hold = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); input[key] = true; el.classList.add('active'); });
      const up = () => { input[key] = false; el.classList.remove('active'); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    };
    hold('t-fire', 'fire');
    hold('t-jump', 'jump');
    const toggle = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input[key] = !input[key];
        el.classList.toggle('active', input[key]);
      });
    };
    toggle('t-ads', 'ads');
    toggle('t-sprint', 'sprint');
    document.getElementById('t-reload').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state === 'playing') weapon.startReload();
    });
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post.resize(w, h);
  });
}

// ---- loop ----
const clock = new THREE.Clock();
let timeScale = 1; // debug: simulation substeps per frame

function stepPlaying(dt) {
  gameTime += dt;

  // wave sequencing
  if (!enemies.waveActive && waveCountdown > 0) {
    waveCountdown -= dt;
    if (waveCountdown <= 0) {
      wave++;
      enemies.startWave(wave);
      ui.setWave(wave);
      audio.waveStart();
      ui.message(`WAVE ${wave}`, 1.8, true);
    }
  }

  const ldx = input.mouseDX, ldy = input.mouseDY;
  if (input.fire) weapon.fire();
  weapon.update(dt, gameTime, input, ldx, ldy);
  player.update(dt, input, gameTime);
  enemies.update(dt);
  level.update(elapsed, dt);
  fx.update(dt, camera);

  // camera FOV: sprint kick / ADS zoom
  const targetFov = weapon.adsT > 0.5 ? 50 : (player.sprinting ? 80 : 75);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 9));
    camera.updateProjectionMatrix();
  }

  // HUD sync
  const hp = Math.round(player.health);
  if (hp !== lastHealthShown) { lastHealthShown = hp; ui.setHealth(player.health); }
  const spreadPx = weapon.spread * (window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) + 4;
  ui.setCrosshairSpread(spreadPx);
  post.grade.uniforms.uDamage.value = ui._dmg;
}

function stepDead(dt) {
  player.update(dt, input, gameTime);
  enemies.update(dt);
  level.update(elapsed, dt);
  fx.update(dt, camera);
  post.grade.uniforms.uDamage.value = Math.min(1, post.grade.uniforms.uDamage.value + dt * 0.5);
  if (!deathShown) {
    deathTimer -= dt;
    if (deathTimer <= 0) {
      deathShown = true;
      ui.showDeath({ waves: Math.max(0, wave - 1), kills, score });
    }
  }
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (state === 'menu') {
    // cinematic drift over the bay
    camera.position.set(
      Math.sin(elapsed * 0.07) * 6.5,
      2.35 + Math.sin(elapsed * 0.043) * 0.5,
      Math.cos(elapsed * 0.07) * 5.5 + 1.5
    );
    camera.lookAt(0, 1.5, -2);
    level.update(elapsed, dt);
    fx.update(dt, camera);
  } else if (state === 'playing') {
    for (let i = 0; i < timeScale; i++) stepPlaying(dt);
  } else if (state === 'dead') {
    for (let i = 0; i < timeScale; i++) stepDead(dt);
  }
  // paused: freeze simulation, keep film grain alive

  if (TOUCH) {
    const show = state === 'playing';
    document.getElementById('touch-ui').classList.toggle('hidden', !show);
    document.getElementById('pause-btn').classList.toggle('hidden', !show);
  }

  ui.update(dt);
  post.update(elapsed);
  post.composer.render();
}

// ---- debug / test hooks ----
window.GAME = {
  get state() { return state; },
  get stats() { return { wave, score, kills, health: player?.health, ammo: weapon?.ammo }; },
  start: () => { if (audio) audio.init(); startGame(); },
  fire: () => weapon?.fire(),
  reload: () => weapon?.startReload(),
  damage: (n = 10) => enemies?.cb.onPlayerHit(n),
  killAll: () => { if (enemies) for (const d of [...enemies.drones]) enemies.damage(d, 999, d.group.position); },
  spawnWave: () => { wave++; enemies?.startWave(wave); ui.setWave(wave); },
  look: (dx, dy) => { input.mouseDX += dx; input.mouseDY += dy; },
  setInput: (k, v) => { input[k] = v; },
  setTimeScale: (n) => { timeScale = Math.max(1, Math.min(12, n | 0)); },
  god: (v = true) => { if (player) player.god = v; },
  aimAtDrone: () => {
    const d = enemies?.drones[0];
    if (!d || !player) return false;
    const dx = d.group.position.x - player.pos.x;
    const dz = d.group.position.z - player.pos.z;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = Math.atan2(d.group.position.y - (player.pos.y + 1.62), Math.hypot(dx, dz));
    return true;
  },
  player: () => player,
  enemies: () => enemies,
};

// let the menu paint before the heavy synchronous build
setTimeout(init, 60);