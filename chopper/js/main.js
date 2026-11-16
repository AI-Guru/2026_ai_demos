/** TIGER — Operation Weißer Blitz: boot, state machine, main loop. */
import { VoxelRenderer } from './engine/voxel.js';
import { Input } from './engine/input.js';
import { AudioEngine } from './engine/audio.js';
import { Assets } from './game/assets.js';
import { FlightModel } from './game/flight.js';
import { Entities, FrameCache, TYPES } from './game/entities.js';
import { Weapons } from './game/weapons.js';
import { Particles } from './game/particles.js';
import { MISSIONS, LOADOUTS, rating } from './game/missions.js';
import { makeSampler, bearingDeg, angDiffDeg, dist3, clamp, lerp } from './game/world.js';
import { drawHUD, drawMap } from './game/hud.js';
import * as UI from './ui.js';

const DEG = Math.PI / 180;
const G = {
  state: 'loading',
  missionIdx: 0,
  mission: null,
  training: false,
  loadoutIdx: 0,
  terrain: null,
  sampler: null,
  entities: null,
  weapons: null,
  particles: new Particles(),
  flight: null,
  cam: { x: 2048, y: 300, z: 500, heading: 0, pitch: -10 * DEG, roll: 0 },
  view: 'chase',
  time: 0,
  globalT: 0,
  paused: false,
  mapOpen: false,
  muted: false,
  volumes: { master: 0.8, sfx: 0.9, music: 0.6 },
  progress: [false, false, false, false],
  stats: null,
  objectives: [],
  completeFlag: false,
  endTimer: -1,
  failTimer: -1,
  failMessage: '',
  shake: 0,
  hitPulse: 0,
  prevHp: 1,
  escapeCounts: {},
  farpT: 0,
  farpToastDone: false,
  lowFuelWarned: false,
  firstKillDone: false,
  boundaryToastT: 0,
  dustAcc: 0,
  smokeAcc: 0,
  currentWarning: null,
  radioTimers: [],
  clouds: [],
  attractTiger: { x: 2048, y: 350, z: 2048, heading: 0, roll: 0.28, pitch: 0 },
  frameTimes: [],
  resLevel: 1,
  returnScreen: 'title',
};

let renderer, assets, input, audio, cache;
let displayCanvas, dctx, internalCanvas, ictx;
let dpr = 1, cssW = 1280, cssH = 720;
let lastTs = 0;

const RES_LEVELS = [640, 768, 896, 1024, 1152, 1280];

// ---------------------------------------------------------------- boot
async function boot() {
  UI.initUI({
    onCampaign: () => { audio.uiClick(); openBriefing(firstUncompleted()); },
    onTraining: () => { audio.uiClick(); startTraining(); },
    onControls: () => { audio.uiClick(); G.returnScreen = G.state === 'flight' ? 'pause' : (document.body.dataset.screen || 'title'); UI.showScreen('controls'); },
    onBack: () => { audio.uiClick(); UI.showScreen(G.returnScreen); },
    onLaunch: (li) => { audio.uiClick(); startMission(G.missionIdx, li); },
    onResume: () => { audio.uiClick(); setPaused(false); },
    onRestart: () => { audio.uiClick(); G.training ? startTraining() : startMission(G.missionIdx, G.loadoutIdx); },
    onQuit: () => { audio.uiClick(); toTitle(); },
    onNext: () => { audio.uiClick(); if (G.missionIdx < 3) openBriefing(G.missionIdx + 1); else toTitle(); },
    onRetry: () => { audio.uiClick(); startMission(G.missionIdx, G.loadoutIdx); },
    onMenu: () => { audio.uiClick(); toTitle(); },
    onMapClose: () => { toggleMap(false); },
    onVolume: (kind, v) => {
      G.volumes[kind] = v;
      applyVolumes();
      localStorage.setItem('tiger vols', JSON.stringify(G.volumes));
    },
    onSoundToggle: () => { G.muted = !G.muted; UI.setSound(!G.muted); applyVolumes(); },
  });
  UI.showScreen('loading');
  UI.setLoading(0.02, 'Initializing Voxel Space engine…');

  displayCanvas = document.getElementById('game-canvas');
  dctx = displayCanvas.getContext('2d');
  internalCanvas = document.createElement('canvas');
  ictx = internalCanvas.getContext('2d');
  renderer = new VoxelRenderer(RES_LEVELS[G.resLevel], Math.round(RES_LEVELS[G.resLevel] * 9 / 16));
  internalCanvas.width = renderer.w; internalCanvas.height = renderer.h;

  input = new Input();
  audio = new AudioEngine();
  assets = new Assets();
  cache = new FrameCache(assets);

  try {
    const v = JSON.parse(localStorage.getItem('tiger vols') ?? 'null');
    if (v) G.volumes = v;
    const p = JSON.parse(localStorage.getItem('tiger progress') ?? 'null');
    if (p) G.progress = p;
  } catch { /* ignore */ }
  UI.setVolumes(G.volumes);
  UI.updateProgress(G.progress);

  await assets.loadManifest();
  UI.setLoading(0.1, 'Loading terrain: Lüneburger Heide…');
  await setTerrain(1);

  // warm hero frames
  const tiger = await assets.loadModel('tiger');
  const mi28 = await assets.loadModel('mi28');
  let n = 0;
  const total = tiger.cols * tiger.rows + mi28.cols * mi28.rows;
  for (let yi = 0; yi < tiger.cols; yi++)
    for (let ei = 0; ei < tiger.rows; ei++) {
      await cache.warm('tiger', yi, ei);
      if (++n % 16 === 0) UI.setLoading(0.1 + 0.75 * (n / total), 'Rendering Tiger UHT voxel frames…');
    }
  for (let yi = 0; yi < mi28.cols; yi++)
    for (let ei = 0; ei < mi28.rows; ei++) {
      await cache.warm('mi28', yi, ei);
      if (++n % 16 === 0) UI.setLoading(0.1 + 0.75 * (n / total), 'Rendering Mi-28 voxel frames…');
    }
  await warmNature();
  UI.setLoading(1, 'Ready.');

  // attract-mode entities for the title backdrop
  G.entities = new Entities(G.terrain.meta.entities, G.sampler, G.terrain);
  await warmEntityFrames(G.entities);
  makeClouds();

  const unlock = () => {
    audio.unlock();
    applyVolumes();
    if (G.state === 'title') audio.startMusic('title');
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  input.onKey = onKey;

  window.addEventListener('resize', resize);
  resize();
  toTitle(true);
  requestAnimationFrame(loop);
}

async function warmNature() {
  for (const [name, meta] of [['tree_spruce', null], ['tree_oak', null], ['bush', null], ['rock', null]]) {
    const m = await assets.loadModel(name);
    for (let yi = 0; yi < m.cols; yi++)
      for (let ei = 0; ei < m.rows; ei++) await cache.warm(name, yi, ei);
  }
}

async function warmEntityFrames(entities) {
  for (const e of entities.list) {
    const m = await assets.loadModel(e.t.model);
    const rel = angDiffDeg(bearingDeg(e.x, e.z, G.cam.x, G.cam.z), e.heading / DEG);
    const elev = 20;
    const { yi, ei } = assets.pickFrame(m, rel, elev);
    await cache.warm(e.t.model, yi, ei);
    await cache.warm(e.t.model, yi, Math.min(ei + 1, m.rows - 1));
  }
}

function makeClouds() {
  const rnd = mulberry(G.terrain.meta.seed ?? 1);
  G.clouds = [];
  for (let i = 0; i < 9; i++) {
    G.clouds.push({
      x: 300 + rnd() * 3500, z: 300 + rnd() * 3500,
      y: 640 + rnd() * 280, v: (rnd() - 0.5) * 3,
      variant: (rnd() * 6) | 0,
    });
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function setTerrain(id) {
  G.terrain = await assets.loadTerrain(id);
  G.sampler = makeSampler(G.terrain);
  renderer.setTerrain(G.terrain);
}

function resize() {
  dpr = Math.min(window.devicePixelRatio ?? 1, 1.5);
  cssW = window.innerWidth;
  cssH = window.innerHeight;
  displayCanvas.width = Math.round(cssW * dpr);
  displayCanvas.height = Math.round(cssH * dpr);
  displayCanvas.style.width = cssW + 'px';
  displayCanvas.style.height = cssH + 'px';
  applyInternalRes();
}

function applyInternalRes() {
  const w = RES_LEVELS[G.resLevel];
  const h = Math.max(360, Math.round(w * cssH / cssW));
  if (renderer.w !== w || renderer.h !== h) {
    renderer.resize(w, h);
    internalCanvas.width = w;
    internalCanvas.height = h;
  }
}

function applyVolumes() {
  audio.setMasterVolume(G.muted ? 0 : G.volumes.master);
  audio.setSfxVolume(G.volumes.sfx);
  audio.setMusicVolume(G.volumes.music);
}

// ---------------------------------------------------------------- state transitions
function firstUncompleted() {
  const i = G.progress.findIndex((p) => !p);
  return i < 0 ? 0 : i;
}

function toTitle(initial = false) {
  G.state = 'title';
  G.paused = false;
  G.mapOpen = false;
  audio.stopFlight();
  audio.stopWarning();
  audio.stopLock();
  audio.startMusic('title');
  UI.showScreen('title');
  UI.updateProgress(G.progress);
  if (!initial && G.terrain.meta.id !== 1) {
    setTerrain(1).then(() => {
      G.entities = new Entities(G.terrain.meta.entities, G.sampler, G.terrain);
      makeClouds();
    });
  }
}

async function openBriefing(idx) {
  G.missionIdx = idx;
  const m = MISSIONS[idx];
  G.state = 'briefing';
  audio.stopFlight();
  if (G.terrain.meta.id !== m.mapId) {
    UI.showScreen('loading');
    UI.setLoading(0.3, 'Loading terrain: ' + m.subtitle.split('·')[1]?.trim() + '…');
    await setTerrain(m.mapId);
    G.entities = new Entities(G.terrain.meta.entities, G.sampler, G.terrain);
    await warmEntityFrames(G.entities);
    makeClouds();
  }
  UI.setBriefing({
    kicker: `EINSATZBEFEHL · MISSION ${idx + 1}/4`,
    title: `${m.title} — ${m.subtitle}`,
    mapSrc: `assets/terrain/m${m.mapId}_map.png`,
    objectives: m.objectives.map((o) => ({ text: o.text, primary: o.primary })),
    intel: m.intel,
    threats: m.threats,
    loadouts: LOADOUTS.map((l) => ({ name: l.name, desc: l.desc, stats: l.stats })),
    selectedLoadout: G.loadoutIdx,
  });
  UI.showScreen('briefing');
}

async function startMission(idx, loadoutIdx) {
  const m = MISSIONS[idx];
  G.missionIdx = idx;
  G.loadoutIdx = loadoutIdx;
  G.training = false;
  G.mission = m;
  UI.showScreen('loading');
  UI.setLoading(0.4, 'Preparing mission…');
  if (G.terrain.meta.id !== m.mapId) {
    await setTerrain(m.mapId);
    makeClouds();
  }
  await initFlight(loadoutIdx);
  UI.setLoading(1, 'Takeoff!');
  G.state = 'flight';
  UI.showScreen('none');
  UI.missionCard(`MISSION ${idx + 1} · ${G.terrain.meta.name.toUpperCase()}`, m.title, m.subtitle);
  audio.stopMusic();
  audio.startFlight();
  scheduleRadio(m.radio.start, 1.2);
}

async function startTraining() {
  G.training = true;
  G.mission = {
    id: 0, title: 'FREIER FLUG', subtitle: 'Free Flight · Lüneburger Heide',
    objectives: [], radio: { start: [['ADLER', 'Free flight, FALKE. The heath is yours. Targets of opportunity are live — no objectives, no pressure. ESC to abort.']] },
    par: 1e9, escapeFail: null,
  };
  UI.showScreen('loading');
  UI.setLoading(0.4, 'Preparing free flight…');
  if (G.terrain.meta.id !== 1) { await setTerrain(1); makeClouds(); }
  await initFlight(0);
  G.state = 'flight';
  UI.showScreen('none');
  UI.missionCard('TRAINING', 'FREIER FLUG', 'Lüneburger Heide · weapons free');
  audio.stopMusic();
  audio.startFlight();
  scheduleRadio(G.mission.radio.start, 1.5);
}

async function initFlight(loadoutIdx) {
  const meta = G.terrain.meta;
  G.entities = new Entities(meta.entities, G.sampler, G.terrain);
  await warmEntityFrames(G.entities);
  G.flight = new FlightModel(meta.spawn, G.sampler, G.terrain.waterLevel);
  G.flight.weight = LOADOUTS[loadoutIdx].weight;
  G.weapons = new Weapons(LOADOUTS[loadoutIdx]);
  G.particles = new Particles();
  G.time = 0;
  G.completeFlag = false;
  G.endTimer = -1;
  G.failTimer = -1;
  G.stats = { kills: 0, collateral: 0, damageTaken: 0, score: 0 };
  G.escapeCounts = {};
  G.farpT = 0; G.farpToastDone = false;
  G.lowFuelWarned = false; G.firstKillDone = false;
  G.prevHp = 1; G.hitPulse = 0; G.shake = 0;
  G.paused = false; G.mapOpen = false;
  G.currentWarning = null;
  clearRadio();
  // camera snap behind heli
  const f = G.flight.forward;
  G.cam.x = G.flight.x - f.x * 26;
  G.cam.z = G.flight.z - f.z * 26;
  G.cam.y = G.flight.y + 9.5;
  G.cam.heading = G.flight.heading;
  G.cam.pitch = -7 * DEG;
  G.cam.roll = 0;
  G.objectives = (G.mission.objectives ?? []).map((o) => ({ ...o, done: 0, short: shortLabel(o.text) }));
}

function shortLabel(text) {
  let s = text.replace(/^(Destroy|Stop|Down|Burn|Silence|Neutralize|Knock out)\s+(both\s+|all\s+(three\s+)?|the\s+)?/i, '');
  return s.length > 30 ? s.slice(0, 29) + '…' : s;
}

function scheduleRadio(lines, delay) {
  if (!lines) return;
  let t = delay;
  for (const [sender, text] of lines) {
    const timer = setTimeout(() => {
      if (G.state !== 'flight') return;
      audio.radioClick();
      UI.radio(sender, text, 5600);
    }, t * 1000);
    G.radioTimers.push(timer);
    t += Math.max(4.5, text.length * 0.045);
  }
}
function clearRadio() {
  for (const t of G.radioTimers) clearTimeout(t);
  G.radioTimers = [];
}

function setPaused(p) {
  G.paused = p;
  audio.setPaused(p);
  UI.showScreen(p ? 'pause' : 'none');
  UI.setVolumes(G.volumes);
}

function toggleMap(force) {
  G.mapOpen = force ?? !G.mapOpen;
  audio.uiClick();
  UI.showScreen(G.mapOpen ? 'map' : 'none');
}

// ---------------------------------------------------------------- events
function gameEvent(type, e) {
  const m = G.mission;
  switch (type) {
    case 'kill':
      G.stats.kills++;
      G.stats.score += e.t.score;
      if (!G.firstKillDone) { G.firstKillDone = true; scheduleRadio(m.radio.firstKill, 0.4); }
      checkObjectives();
      break;
    case 'collateral':
      G.stats.collateral++;
      G.stats.score += e.t.score;
      scheduleRadio(m.radio.collateral, 0.3);
      UI.toast('KOLLATERALSCHADEN — civilian structure destroyed', 'warn', 3500);
      checkObjectives();
      break;
    case 'playerHit':
      G.hitPulse = Math.min(1, G.hitPulse + 0.45);
      G.shake = Math.min(1, G.shake + 0.3);
      if (Math.random() < 0.3) scheduleRadio(m.radio.playerHit, 0.2);
      break;
    case 'samLaunch':
      scheduleRadio(m.radio.samLaunch, 0.1);
      break;
    case 'parsLaunch':
      break;
    case 'escape':
      G.escapeCounts[e.group] = (G.escapeCounts[e.group] ?? 0) + 1;
      if (m.escapeFail && e.group === m.escapeFail.group && G.escapeCounts[e.group] >= m.escapeFail.count) {
        missionFail(m.escapeFail.message);
      }
      break;
  }
}

function checkObjectives() {
  for (const o of G.objectives) {
    const before = o.done;
    o.done = G.entities.byGroup(o.group).filter((e) => !e.alive).length;
    if (before < o.required && o.done >= o.required) {
      const key = o.id + 'Complete';
      if (G.mission.radio[key]) scheduleRadio(G.mission.radio[key], 0.6);
      UI.toast((o.primary ? 'PRIMARY' : 'SECONDARY') + ' OBJECTIVE COMPLETE', 'good', 2800);
    }
  }
  if (!G.training && !G.completeFlag && G.objectives.filter((o) => o.primary).every((o) => o.done >= o.required)) {
    G.completeFlag = true;
    G.endTimer = 7;
    scheduleRadio(G.mission.radio.win, 0.8);
    UI.toast('MISSION COMPLETE — well done, FALKE', 'good', 5000);
  }
}

function missionFail(msg) {
  if (G.failTimer >= 0 || G.completeFlag) return;
  G.failTimer = 2.6;
  G.failMessage = msg;
  scheduleRadio(G.mission.radio.fail, 0.3);
}

function endMission(success) {
  clearRadio();
  audio.stopFlight();
  audio.stopWarning();
  audio.stopLock();
  G.currentWarning = null;
  const primary = G.objectives.filter((o) => o.primary);
  const secondary = G.objectives.filter((o) => !o.primary);
  const acc = G.weapons.stats.shots > 0 ? G.weapons.stats.hits / G.weapons.stats.shots : 0;
  const stats = {
    success,
    kills: G.stats.kills,
    collateral: G.stats.collateral,
    damageTaken: Math.round(G.stats.damageTaken),
    time: G.time,
    primaryDone: primary.filter((o) => o.done >= o.required).length,
    primaryTotal: primary.length,
    secondaryDone: secondary.filter((o) => o.done >= o.required).length,
    secondaryTotal: secondary.length,
  };
  const r = rating(stats, G.mission);
  if (success && !G.training) {
    G.progress[G.missionIdx] = true;
    localStorage.setItem('tiger progress', JSON.stringify(G.progress));
  }
  const mm = String((G.time / 60) | 0).padStart(2, '0');
  const ss = String((G.time % 60) | 0).padStart(2, '0');
  UI.setDebrief({
    success,
    title: success ? 'MISSION COMPLETE' : 'MISSION FAILED',
    sub: G.training ? 'Free flight ended' : `${G.mission.title} · ${G.mission.subtitle}` + (success ? '' : ' — ' + G.failMessage),
    stats: [
      ['Primary objectives', `${stats.primaryDone} / ${stats.primaryTotal}`],
      ['Secondary objectives', `${stats.secondaryDone} / ${stats.secondaryTotal}`],
      ['Targets destroyed', String(stats.kills)],
      ['Weapon accuracy', `${Math.round(acc * 100)} %`],
      ['Mission time', `${mm}:${ss}`],
      ['Damage taken', `${stats.damageTaken} %`],
      ['Collateral damage', String(stats.collateral)],
      ['Score', String(Math.max(0, G.stats.score))],
    ],
    rating: `${r.label} · ${r.en}`,
    comment: success
      ? (stats.collateral === 0 ? 'Flawless discipline. The Heeresflieger is proud of you, FALKE.' : 'Objectives achieved — but mind the civilians next time.')
      : 'Regroup, rearm, and try again. The Tiger waits on the pad.',
    hasNext: success && !G.training && G.missionIdx < 3,
  });
  G.state = 'debrief';
  UI.showScreen('debrief');
}

// ---------------------------------------------------------------- input
function onKey(e) {
  if (G.state !== 'flight') return;
  switch (e.code) {
    case 'Escape':
      if (G.mapOpen) toggleMap(false);
      else setPaused(!G.paused);
      break;
    case 'KeyM':
      if (!G.paused) toggleMap();
      break;
    case 'KeyV':
      G.view = G.view === 'chase' ? 'cockpit' : 'chase';
      UI.toast(G.view === 'cockpit' ? 'COCKPIT VIEW' : 'CHASE VIEW', 'info', 1400);
      break;
    case 'Digit1': G.weapons.select(0); audio.uiClick(); break;
    case 'Digit2': G.weapons.select(1); audio.uiClick(); break;
    case 'Digit3': G.weapons.select(2); audio.uiClick(); break;
    case 'KeyN':
      G.muted = !G.muted; UI.setSound(!G.muted); applyVolumes();
      break;
    case 'Enter':
      if (G.completeFlag) endMission(true);
      break;
  }
}

// ---------------------------------------------------------------- simulation
function simUpdate(dt) {
  const f = G.flight;
  G.time += dt;

  const ctx = {
    input, player: f, cam: G.cam, entities: G.entities, weapons: G.weapons,
    particles: G.particles, audio, sampler: G.sampler, terrain: G.terrain,
    onEvent: gameEvent, time: G.time,
    playerLockTarget: G.weapons.lock.locked ? G.weapons.lock.target : null,
    samLock: 0, missileInbound: false,
  };

  G.weapons.update(dt, ctx);
  G.entities.update(dt, ctx);
  f.update(dt, input.axes(), G.sampler);
  G.particles.update(dt);

  // damage accounting
  if (f.hp < G.prevHp) G.stats.damageTaken += (G.prevHp - f.hp) * 100;
  G.prevHp = f.hp;

  // crash handling
  if (f.crashed && G.failTimer < 0 && !G.completeFlag) {
    if (f.justCrashed || G.failTimer === -1) {
      G.particles.explosion(f.x, f.y, f.z, 2.0, G.sampler(f.x, f.z));
      audio.crash();
      G.shake = 1;
      UI.flash(0.7);
      missionFail(G.training ? '' : 'Helicopter destroyed.');
      if (G.training) { G.failTimer = 2.2; G.failMessage = ''; }
    }
  }
  if (G.training && G.failTimer >= 0) {
    G.failTimer -= dt;
    if (G.failTimer <= 0) {
      // respawn
      const meta = G.terrain.meta;
      G.flight = new FlightModel(meta.spawn, G.sampler, G.terrain.waterLevel);
      G.flight.weight = LOADOUTS[G.loadoutIdx].weight;
      G.weapons = new Weapons(LOADOUTS[G.loadoutIdx]);
      G.failTimer = -1;
      G.prevHp = 1;
      UI.toast('AIRFRAME REPLACED — back on the pad', 'info', 3000);
    }
  } else if (!G.training && G.failTimer >= 0) {
    G.failTimer -= dt;
    if (G.failTimer <= 0) { endMission(false); return; }
  }
  if (G.completeFlag && G.endTimer >= 0) {
    G.endTimer -= dt;
    if (G.endTimer <= 0) { endMission(true); return; }
  }

  // FARP service
  const farp = G.entities.list.find((e) => e.type === 'farp');
  G.atFarp = false;
  if (farp && f.landed && dist3(f.x, f.y, f.z, farp.x, farp.y, farp.z) < 30) {
    G.atFarp = true;
    G.farpT += dt;
    if (!G.farpToastDone) { G.farpToastDone = true; UI.toast('FARP: refuel / rearm / repair in progress…', 'info', 4000); }
    if (G.farpT > 5) {
      f.fuel = 1; f.hp = 1; G.prevHp = 1;
      const l = LOADOUTS[G.loadoutIdx];
      G.weapons.ammo = { gun: l.gun, rockets: l.rockets, pars: l.pars, flares: l.flares };
      G.farpT = 0;
      G.farpToastDone = false;
      UI.toast('FARP complete: fuel, ammo, airframe restored', 'good', 3000);
      audio.landing();
    }
  } else {
    G.farpT = 0;
    G.farpToastDone = false;
  }

  // warnings & audio
  if (!G.lowFuelWarned && f.fuel < 0.2) { G.lowFuelWarned = true; scheduleRadio(G.mission.radio.lowFuel, 0.2); }
  let warn = null;
  if (ctx.missileInbound) warn = 'missile';
  else if (ctx.samLock > 0.12) warn = 'radar';
  else if (f.agl < 35 && f.vy < -6 && !f.landed) warn = 'pullup';
  if (warn !== G.currentWarning) {
    audio.stopWarning();
    if (warn) audio.warning(warn);
    G.currentWarning = warn;
  }
  audio.updateFlight({ speed: Math.abs(f.speed), collective: f.collective, rpm: f.rpm, agl: f.agl, damaged: f.hp < 0.35 });

  if (f.justLanded) audio.landing();
  if (f.boundary && G.time - G.boundaryToastT > 6) {
    G.boundaryToastT = G.time;
    UI.toast('MISSION AREA BOUNDARY — turn back', 'warn', 2200);
  }

  // rotor downwash dust
  if (!f.landed && f.agl < 14 && !f.crashed) {
    G.dustAcc += dt;
    if (G.dustAcc > 0.07) {
      G.dustAcc = 0;
      const g = Math.max(G.sampler(f.x, f.z), G.terrain.waterLevel);
      const a = Math.random() * Math.PI * 2;
      G.particles.spawn('dust', f.x + Math.cos(a) * 4, g + 0.6, f.z + Math.sin(a) * 4, {
        vx: Math.cos(a) * 10, vz: Math.sin(a) * 10, vy: 1.2,
        ttl: 1.1, s0: 2.5, s1: 7, a0: 0.5, drag: 1.2,
      });
    }
  }
  // damage smoke
  if (f.hp < 0.35 && !f.crashed) {
    G.smokeAcc += dt;
    if (G.smokeAcc > 0.1) {
      G.smokeAcc = 0;
      G.particles.spawn('darksmoke', f.x - f.forward.x * 3, f.y + 1.5, f.z - f.forward.z * 3, {
        vy: 2, ttl: 1.6, s0: 1.5, s1: 5, a0: 0.7,
      });
    }
  }

  updateCamera(dt);
  G.hitPulse = Math.max(0, G.hitPulse - dt * 1.4);
  G.shake = Math.max(0, G.shake - dt * 2.2);
  UI.vignette(clamp((1 - f.hp) * 0.45 + G.hitPulse * 0.5, 0, 0.85));
}

function updateCamera(dt) {
  const f = G.flight;
  const cam = G.cam;
  if (f.crashed) {
    const a = G.globalT * 0.35;
    cam.x = lerp(cam.x, f.x + Math.sin(a) * 42, 1 - Math.exp(-2 * dt));
    cam.z = lerp(cam.z, f.z + Math.cos(a) * 42, 1 - Math.exp(-2 * dt));
    cam.y = lerp(cam.y, f.y + 20, 1 - Math.exp(-2 * dt));
    cam.heading = Math.atan2(f.x - cam.x, f.z - cam.z);
    cam.pitch = lerp(cam.pitch, -14 * DEG, 1 - Math.exp(-2 * dt));
    cam.roll = lerp(cam.roll, 0, 1 - Math.exp(-2 * dt));
    return;
  }
  const fw = f.forward;
  if (G.view === 'chase') {
    const tx = f.x - fw.x * 26, tz = f.z - fw.z * 26, ty = f.y + 9.5;
    const k = 1 - Math.exp(-5 * dt);
    cam.x = lerp(cam.x, tx, k);
    cam.z = lerp(cam.z, tz, k);
    cam.y = lerp(cam.y, ty, k);
    let dh = f.heading - cam.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    cam.heading += dh * (1 - Math.exp(-3.6 * dt));
    cam.pitch = lerp(cam.pitch, -7 * DEG + f.pitch * 0.25, 1 - Math.exp(-4 * dt));
    cam.roll = lerp(cam.roll, f.roll * 0.5, 1 - Math.exp(-4 * dt));
  } else {
    cam.x = f.x + fw.x * 3.5;
    cam.z = f.z + fw.z * 3.5;
    cam.y = f.y + 2.8;
    cam.heading = f.heading;
    cam.pitch = f.pitch * 0.6 - 2 * DEG;
    cam.roll = f.roll * 0.9;
  }
  const g = G.sampler(cam.x, cam.z);
  if (cam.y < g + 2.5) cam.y = g + 2.5;
}

function attractUpdate(dt) {
  G.attractT += dt;
  const t = G.attractT * 0.055;
  const cx = 2048, cz = 2100;
  const r = 780;
  G.cam.x = cx + Math.sin(t) * r;
  G.cam.z = cz + Math.cos(t) * r;
  G.cam.y = 200 + Math.sin(G.attractT * 0.11) * 40;
  G.cam.heading = Math.atan2(cx - G.cam.x, cz - G.cam.z);
  G.cam.pitch = -13 * DEG;
  G.cam.roll = 0;
  // circling Tiger for the title backdrop
  const at = G.attractT * 0.16;
  const tr = 480;
  const tiger = G.attractTiger;
  tiger.x = cx + Math.sin(at) * tr;
  tiger.z = cz + Math.cos(at) * tr;
  tiger.y = 260 + Math.sin(G.attractT * 0.3) * 20;
  tiger.heading = at + Math.PI / 2; // tangent to the orbit, nose forward
  tiger.roll = 0.3;
  for (const c of G.clouds) c.x += c.v * dt;
}

// ---------------------------------------------------------------- rendering
function buildSprites() {
  const out = [];
  const cam = G.cam;
  const dd = renderer.drawDist;
  const dusk = G.terrain.meta.sky === 'dusk';

  G.entities.buildSprites(assets, cache, cam, out, dd, G.globalT, dusk);

  // trees & rocks
  const meta = G.terrain.meta;
  for (const tr of meta.trees ?? []) {
    const dx = tr[0] - cam.x, dz = tr[1] - cam.z;
    if (dx * dx + dz * dz > dd * dd) continue;
    const name = tr[2] === 0 ? 'tree_spruce' : tr[2] === 1 ? 'tree_oak' : 'bush';
    pushNature(out, name, tr[0], tr[1], tr[3], cam);
  }
  for (const rk of meta.rocks ?? []) {
    const dx = rk[0] - cam.x, dz = rk[1] - cam.z;
    if (dx * dx + dz * dz > dd * dd) continue;
    pushNature(out, 'rock', rk[0], rk[1], rk[2], cam);
  }

  G.weapons?.buildSprites(assets, cam, out, dd);
  G.particles.buildSprites(assets, cam, out, dd);

  // clouds
  const cloudSet = dusk ? assets.sprites.cloudsDusk : assets.sprites.clouds;
  for (const c of G.clouds) {
    const s = cloudSet[c.variant];
    out.push({ pixels: s.pixels, pw: s.pw, ph: s.ph, ax: s.ax, ay: s.ay, ppm: s.ppm, x: c.x, y: c.y, z: c.z, alpha: 0.85 });
  }

  // player / attract Tiger (hidden in cockpit view — you sit inside it)
  const f = G.state === 'flight' ? G.flight : G.attractTiger;
  const cockpitOwn = G.state === 'flight' && G.view === 'cockpit';
  if (f && !cockpitOwn && (G.state === 'flight' || G.state === 'title' || G.state === 'briefing')) {
    const crashed = G.state === 'flight' && f.crashed;
    const gy = crashed ? f.y : f.y - 2.0;
    const m = assets.modelMeta.get('tiger');
    if (m) {
      const rel = angDiffDeg(bearingDeg(f.x, f.z, cam.x, cam.z), (f.heading ?? 0) / DEG);
      const hd = Math.hypot(cam.x - f.x, cam.z - f.z);
      const elev = (Math.atan2(cam.y - f.y, hd) * 180) / Math.PI;
      const { yi, ei } = assets.pickFrame(m, rel, elev);
      const spr = cache.get('tiger', yi, ei, crashed);
      if (spr) out.push({ pixels: spr.pixels, pw: spr.pw, ph: spr.ph, ax: spr.ax, ay: spr.ay, ppm: spr.ppm, x: f.x, y: gy, z: f.z });
      if (!crashed) {
        const rh = m.rotorHub ?? { y: 4.6, z: -0.4 };
        const tr = m.tailRotor ?? { y: 3.3, z: -8.2 };
        G.entities._rotorSprites(assets, cam, f.x, gy, f.z, f.heading ?? 0, G.globalT, out, rh.y, rh.z, tr.z, tr.y);
        // shadow
        const band = elev < 12 ? 0 : elev < 30 ? 1 : elev < 52 ? 2 : 3;
        const sh = assets.sprites.shadow[band];
        const g = Math.max(G.sampler(f.x, f.z), G.terrain.waterLevel);
        out.push({ pixels: sh.pixels, pw: sh.pw, ph: sh.ph, ax: sh.ax, ay: sh.ay, ppm: 32 / 7.5, x: f.x, y: g + 0.25, z: f.z, alpha: dusk ? 0.4 : 0.7 });
      }
    }
  }
  return out;
}

function pushNature(out, name, x, z, scale, cam) {
  const m = assets.modelMeta.get(name);
  if (!m) { assets.loadModel(name); return; }
  const y = Math.max(G.sampler(x, z), G.terrain.waterLevel);
  const hd = Math.hypot(cam.x - x, cam.z - z);
  const rel = bearingDeg(x, z, cam.x, cam.z);
  const elev = (Math.atan2(cam.y - y, hd) * 180) / Math.PI;
  const { yi, ei } = assets.pickFrame(m, rel, elev);
  const spr = cache.get(name, yi, ei);
  if (!spr) return;
  out.push({
    pixels: spr.pixels, pw: spr.pw, ph: spr.ph, ax: spr.ax, ay: spr.ay,
    ppm: spr.ppm / scale, x, y, z,
  });
}

function renderFrame() {
  const sprites = buildSprites();
  const t0 = performance.now();
  renderer.render(G.cam, sprites);
  const renderMs = performance.now() - t0;

  // adaptive resolution
  G.frameTimes.push(renderMs);
  if (G.frameTimes.length > 40) G.frameTimes.shift();
  if (G.frameTimes.length === 40) {
    const avg = G.frameTimes.reduce((a, b) => a + b, 0) / 40;
    if (avg > 15 && G.resLevel > 0) { G.resLevel--; G.frameTimes.length = 0; applyInternalRes(); }
    else if (avg < 7 && G.resLevel < RES_LEVELS.length - 1) { G.resLevel++; G.frameTimes.length = 0; applyInternalRes(); }
  }

  ictx.putImageData(renderer.getImage(), 0, 0);

  // blit with roll + shake
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dctx.imageSmoothingEnabled = false;
  dctx.fillStyle = '#000';
  dctx.fillRect(0, 0, cssW, cssH);
  const roll = G.cam.roll * (G.view === 'cockpit' && G.state === 'flight' ? 1 : 0.6);
  const cover = 1.03 + Math.abs(roll) * 0.9;
  const shx = (Math.random() - 0.5) * G.shake * 18;
  const shy = (Math.random() - 0.5) * G.shake * 18;
  dctx.save();
  dctx.translate(cssW / 2 + shx, cssH / 2 + shy);
  dctx.rotate(roll);
  dctx.scale(cover, cover);
  dctx.drawImage(internalCanvas, -cssW / 2, -cssH / 2, cssW, cssH);
  dctx.restore();

  // HUD
  if (G.state === 'flight') {
    const boxes = [];
    const lockT = G.weapons.lock.target;
    for (const e of G.entities.list) {
      if (!e.alive || e.friendly) continue;
      const isLock = e === lockT && G.weapons.lock.progress > 0.02;
      const obj = G.objectives.find((o) => o.group === e.group);
      if (!isLock && !obj?.primary) continue;
      const d = dist3(e.x, e.y, e.z, G.cam.x, G.cam.y, G.cam.z);
      if (d > 3200) continue;
      const p = renderer.project(e.x, e.y + e.t.radius * 0.5, e.z, G.cam);
      if (!p || p.x < -40 || p.x > renderer.w + 40 || p.y < -40 || p.y > renderer.h + 40) continue;
      // transform internal → display (same roll/scale as blit)
      const ix = (p.x - renderer.w / 2) * (cssW / renderer.w);
      const iy = (p.y - renderer.h / 2) * (cssH / renderer.h);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      boxes.push({
        p: { x: cssW / 2 + (ix * cr - iy * sr) * cover, y: cssH / 2 + (ix * sr + iy * cr) * cover },
        name: TYPES[e.type] ? e.type.toUpperCase() : e.type,
        dist: d, locked: isLock && G.weapons.lock.locked,
        primary: obj?.primary, hp: e.hp / e.maxHp,
      });
    }
    drawHUD(dctx, cssW, cssH, {
      flight: G.flight, weapons: G.weapons, time: G.time, view: G.view,
      missionTitle: G.mission.title,
      objectives: G.objectives,
      samLock: G.entities._samLock ?? 0,
      missileInbound: G.entities._missileInbound ?? false,
      targetBoxes: boxes,
      atFarp: G.atFarp,
    });
    if (G.mapOpen) {
      drawMap(document.getElementById('map-canvas'), G.terrain, G.entities, G.flight, G.mission, G.objectives);
    }
  }
}

// ---------------------------------------------------------------- loop
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = clamp((ts - lastTs) / 1000, 0.001, 0.05);
  lastTs = ts;
  G.globalT += dt;

  if (G.state === 'flight' && !G.paused && !G.mapOpen) {
    simUpdate(dt);
  } else if (G.state === 'title' || G.state === 'briefing' || G.state === 'debrief') {
    attractUpdate(dt);
    if (G.state === 'flight') { /* unreachable */ }
  } else if (G.state === 'flight' && (G.paused || G.mapOpen)) {
    // frozen sim, gentle camera drift for life
    audio.updateFlight({ speed: 0, collective: G.flight.collective, rpm: G.flight.rpm, agl: G.flight.agl, damaged: false });
  }
  if (G.state !== 'loading') renderFrame();
  input.endFrame();
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('load-label');
  if (el) el.textContent = 'BOOT ERROR: ' + err.message;
});

// debug/QA hook (used by tools/screenshot.mjs)
window.__tiger = G;
window.__dbg = {
  get assets() { return assets; }, get renderer() { return renderer; }, get cache() { return cache; },
  // QA helper: destroy an entity through the real damage/event path
  kill: (e) => G.entities.damage(e, 1e6, { particles: G.particles, audio, player: G.flight, onEvent: gameEvent }),
};