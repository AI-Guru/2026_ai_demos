// Full mission-flow playtest: win -> debrief -> next mission, SAM lock +
// flare decoy, FARP service, convoy escape fail, training crash + respawn.
// Run: node tools/flowtest.mjs   (requires python3 tools/serve.py running)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'tests', 'out');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/opt/homebrew/bin/chromium',
];
const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push('reqfail: ' + r.url()));

const shot = async (name) => { await page.screenshot({ path: path.join(out, `flow_${name}.png`) }); console.log('shot:', name); };
const waitScreen = (n, timeout = 60000) => page.waitForFunction((x) => document.body.dataset.screen === x, { timeout }, n);
const results = [];
const check = (name, ok, info = '') => { results.push([ok ? 'PASS' : 'FAIL', name, info]); console.log(ok ? 'PASS' : 'FAIL', name, info); };
const boot = async () => {
  await page.goto('http://localhost:8377', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());   // fresh campaign per scenario
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitScreen('title', 90000);
};
const launchCampaign = async () => {
  await page.click('#btn-campaign');
  await waitScreen('briefing');
  await page.click('#btn-launch');
  await waitScreen('none');
  await sleep(3500);
};

// ---------- A: mission 1 win -> debrief -> next mission ----------
await boot();
await launchCampaign();
const killed = await page.evaluate(() => {
  const g = window.__tiger;
  let n = 0;
  for (const e of g.entities.list) {
    if (e.group === 'recon' || e.group === 'convoy') { window.__dbg.kill(e); n++; }
  }
  return n;
});
check('A kills registered', killed === 8, `killed=${killed}`);
await page.waitForFunction(() => window.__tiger.completeFlag === true, { timeout: 15000 });
await waitScreen('debrief', 30000);
await sleep(900);
await shot('11_debrief_win');
const debrief = await page.evaluate(() => document.getElementById('screen-debrief').innerText.replace(/\n+/g, ' | '));
console.log('DEBRIEF:', debrief.slice(0, 400));
check('A debrief shows rating', /RATING|BEWERTUNG|SCORE/i.test(debrief));
await page.click('#btn-next');
await waitScreen('briefing');
await sleep(600);
await shot('12_briefing_m2');
await page.click('#btn-launch');
await waitScreen('none');
await sleep(3500);
const m2 = await page.evaluate(() => window.__tiger.mission.id);
check('A next mission is 2', m2 === 2, `id=${m2}`);

// ---------- B: SAM lock -> missile inbound -> flare decoy ----------
const samPos = await page.evaluate(() => {
  const g = window.__tiger;
  const osas = g.entities.list.filter((e) => e.type === 'osa' && e.alive);
  for (const o of osas.slice(1)) window.__dbg.kill(o);   // isolate one launcher
  for (const e of g.entities.list) if (e.type === 'gepard') window.__dbg.kill(e);
  const osa = osas[0];
  const f = g.flight;
  f.x = osa.x + 250; f.z = osa.z + 250;
  f.y = Math.max(g.sampler(f.x, f.z), g.terrain.waterLevel) + 260;
  f.vy = 0; f.speed = 0; f.collective = 0.5;   // hover while the SAM tracks us
  return [osa.x, osa.z];
});
console.log('teleported near osa', samPos);
let locked = false;
try {
  await page.waitForFunction(() => window.__tiger.entities._samLock > 0.12, { timeout: 20000 });
  locked = true;
} catch {}
check('B SAM radar lock', locked);
let inbound = false;
try {
  await page.waitForFunction(() => window.__tiger.entities._missileInbound === true, { timeout: 20000 });
  inbound = true;
} catch {}
check('B missile inbound', inbound);
await shot('13_sam_inbound');
const hpBefore = await page.evaluate(() => window.__tiger.flight.hp);
let decoySet = false;
for (let i = 0; i < 4 && !decoySet; i++) {
  await page.keyboard.press('KeyF');
  await sleep(450);
  decoySet = await page.evaluate(() => window.__tiger.weapons.projectiles.some((p) => p.kind === 'sam' && p.decoy));
}
check('B flare burst assigns decoy', decoySet);
let decoyed = false;
try {
  await page.waitForFunction(() => window.__tiger.entities._missileInbound === false, { timeout: 20000 });
  decoyed = true;
} catch {}
await sleep(1500);
const hpAfter = await page.evaluate(() => window.__tiger.flight.hp);
check('B flare decoys missile', decoyed && inbound && decoySet && hpAfter >= hpBefore - 0.01, `hp ${hpBefore.toFixed(2)} -> ${hpAfter.toFixed(2)}`);

// ---------- C: FARP refuel / rearm / repair ----------
await page.evaluate(() => {
  const g = window.__tiger, f = g.flight;
  f.fuel = 0.3; f.hp = 0.4; g.weapons.ammo.gun = 10;
  f.collective = 0.25;   // below hover: ground effect must not lift us off the pad
  const farp = g.entities.list.find((e) => e.type === 'farp');
  f.x = farp.x; f.z = farp.z;
  f.y = Math.max(g.sampler(f.x, f.z), g.terrain.waterLevel) + 0.4;
  f.vy = -0.5; f.speed = 0;
});
await sleep(1500);
const landed = await page.evaluate(() => window.__tiger.flight.landed && window.__tiger.atFarp);
check('C landed at FARP', landed);
await shot('14_farp');
await sleep(6000);
const serviced = await page.evaluate(() => {
  const g = window.__tiger;
  return { fuel: g.flight.fuel, hp: g.flight.hp, gun: g.weapons.ammo.gun };
});
check('C FARP restores fuel/hp/ammo', serviced.fuel > 0.99 && serviced.hp === 1 && serviced.gun > 10, JSON.stringify(serviced));

// ---------- D: convoy escape -> mission fail ----------
await boot();
await launchCampaign();
await page.evaluate(() => {
  const g = window.__tiger;
  let n = 0;
  for (const e of g.entities.list) {
    if (e.group === 'convoy' && n < 3) {
      const last = e.patrol[e.patrol.length - 1];
      e.wpIdx = e.patrol.length - 1;
      e.x = last[0]; e.z = last[1];
      n++;
    }
  }
});
await waitScreen('debrief', 30000);
await sleep(900);
await shot('15_debrief_fail');
const failInfo = await page.evaluate(() => ({
  msg: window.__tiger.failMessage,
  text: document.getElementById('screen-debrief').innerText.replace(/\n+/g, ' | '),
}));
check('D escape fail message', /escaped/i.test(failInfo.msg), failInfo.msg);
console.log('FAIL DEBRIEF:', failInfo.text.slice(0, 300));

// ---------- E: training crash -> respawn ----------
await boot();
await page.click('#btn-training');
const scr = await page.evaluate(() => document.body.dataset.screen);
if (scr === 'briefing') { await page.click('#btn-launch'); }
await waitScreen('none');
await sleep(3000);
await page.evaluate(() => {
  const g = window.__tiger, f = g.flight;
  f.y = g.sampler(f.x, f.z) - 4;   // drive into the ground
  f.vy = -20;
});
let crashed = false;
try {
  await page.waitForFunction(() => window.__tiger.flight.crashed === true, { timeout: 10000 });
  crashed = true;
} catch {}
check('E crash detected', crashed);
await shot('16_crash');
let respawned = false;
try {
  await page.waitForFunction(() => window.__tiger.flight.crashed === false && window.__tiger.flight.hp === 1, { timeout: 15000 });
  respawned = true;
} catch {}
check('E training respawn', respawned);
await shot('17_respawn');

console.log('\nSUMMARY:', results.filter((r) => r[0] === 'PASS').length + '/' + results.length, 'passed');
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE ERRORS');
await browser.close();
process.exit(errors.length || results.some((r) => r[0] === 'FAIL') ? 1 : 0);