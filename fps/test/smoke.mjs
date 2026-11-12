// Headless smoke test + screenshot capture for SECTOR 07.
// Usage: node test/smoke.mjs [--url http://localhost:8123]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL_BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:8123';
const OUT = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,900',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: 1600, height: 900 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('[console] ' + msg.text());
});
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
page.on('requestfailed', (req) => {
  if (!req.url().includes('favicon')) errors.push('[netfail] ' + req.url() + ' ' + req.failure()?.errorText);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: OUT + name + '.png' });
  console.log('shot:', name);
};
const waitFor = (fn, timeout = 45000) =>
  page.waitForFunction(fn, { timeout, polling: 250 });

// ---------- menu (no debug autostart) ----------
console.log('loading menu…');
await page.goto(URL_BASE + '/', { waitUntil: 'networkidle0', timeout: 90000 });
await waitFor(() => document.getElementById('menu-loading').style.display === 'none');
await sleep(2500);
await shot('00-menu');

// ---------- gameplay ----------
await page.goto(URL_BASE + '/?debug=1', { waitUntil: 'networkidle0', timeout: 90000 });
await waitFor(() => window.GAME && GAME.state === 'playing');
await page.evaluate(() => { GAME.setTimeScale(8); GAME.god(true); });
await sleep(1200);
await page.evaluate(() => GAME.look(-220, -40));
await sleep(500);
await shot('01-gameplay');

await page.evaluate(() => GAME.spawnWave());
await waitFor(() => GAME.enemies().drones.length >= 2);
await page.evaluate(() => GAME.aimAtDrone());
await sleep(400);
await shot('02-drone');

// combat: hold trigger in bursts while tracking the nearest drone
const combat = await page.evaluate(async () => {
  const before = GAME.stats;
  for (let burst = 0; burst < 10; burst++) {
    GAME.aimAtDrone();
    GAME.setInput('fire', true);
    await new Promise(r => setTimeout(r, 350));
    GAME.setInput('fire', false);
    await new Promise(r => setTimeout(r, 120));
    if (GAME.enemies().drones.length === 0 && GAME.enemies().spawnQueue === 0) break;
  }
  return { before, after: GAME.stats };
});
console.log('combat:', JSON.stringify(combat));
await shot('03-combat');

// ADS view on a live drone
await page.evaluate(() => { GAME.aimAtDrone(); GAME.setInput('ads', true); });
await sleep(700);
await shot('04-ads');
await page.evaluate(() => GAME.setInput('ads', false));

// movement + jump
await page.evaluate(() => { GAME.setInput('forward', true); GAME.setInput('sprint', true); });
await sleep(900);
await page.evaluate(() => GAME.setInput('jump', true));
await sleep(150);
await page.evaluate(() => {
  GAME.setInput('jump', false);
  GAME.setInput('forward', false);
  GAME.setInput('sprint', false);
});
await shot('05-movement');

// damage + death + restart flow
await page.evaluate(() => GAME.god(false));
await page.evaluate(() => GAME.damage(40));
await sleep(400);
await shot('06-damaged');
await page.evaluate(() => GAME.damage(200));
await waitFor(() => GAME.state === 'dead');
await waitFor(() => !document.getElementById('death').classList.contains('hidden'));
await shot('07-death');

await page.evaluate(() => GAME.start());
await waitFor(() => GAME.state === 'playing');
await page.evaluate(() => GAME.god(true));
const restartState = await page.evaluate(() => GAME.stats);
console.log('restart:', JSON.stringify(restartState));

// kill-all → wave clear → next wave sequencing
await page.evaluate(() => GAME.spawnWave());
await waitFor(() => GAME.enemies().drones.length >= 1);
await page.evaluate(() => { GAME.enemies().spawnQueue = 0; GAME.killAll(); });
await waitFor(() => GAME.stats.wave >= 2, 60000);
console.log('wave sequencing ok:', JSON.stringify(await page.evaluate(() => GAME.stats)));
await shot('08-next-wave');

// reload flow
await page.evaluate(() => { GAME.setInput('fire', true); });
await sleep(1500);
await page.evaluate(() => { GAME.setInput('fire', false); GAME.reload(); });
await sleep(600);
await shot('09-reload');
await waitFor(() => GAME.stats.ammo === 30, 30000);
console.log('reload ok');

// resize robustness
await page.setViewport({ width: 1024, height: 640 });
await sleep(1000);
await shot('10-resized');

// pause / resume (debug ESC)
await page.evaluate(() => { GAME.god(true); if (GAME.state !== 'playing') GAME.start(); });
await sleep(400);
await page.keyboard.press('Escape');
await waitFor(() => GAME.state === 'paused');
await shot('11-pause');
await page.keyboard.press('Escape');
await waitFor(() => GAME.state === 'playing');
console.log('pause/resume ok');

// ---------- mobile / touch ----------
const mob = await browser.newPage();
mob.on('pageerror', (err) => errors.push('[mobile pageerror] ' + err.message));
mob.on('console', (m) => { if (m.type() === 'error') errors.push('[mobile console] ' + m.text()); });
await mob.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await mob.goto(URL_BASE + '/', { waitUntil: 'networkidle0', timeout: 90000 });
await mob.waitForFunction(() => document.getElementById('menu-loading').style.display === 'none', { timeout: 60000 });
await sleep(1500);
await mob.screenshot({ path: OUT + '12-mobile-menu.png' });
console.log('shot: 12-mobile-menu');
await mob.goto(URL_BASE + '/?debug=1', { waitUntil: 'networkidle0', timeout: 90000 });
await mob.waitForFunction(() => window.GAME && GAME.state === 'playing', { timeout: 60000 });
await sleep(1500);
await mob.screenshot({ path: OUT + '13-mobile-play.png' });
console.log('shot: 13-mobile-play');
// hold FIRE via touch
const fireBox = await mob.$eval('#t-fire', el => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const ammoBefore = await mob.evaluate(() => GAME.stats.ammo);
await mob.touchscreen.touchStart(fireBox.x, fireBox.y);
await sleep(900);
await mob.touchscreen.touchEnd();
const ammoAfter = await mob.evaluate(() => GAME.stats.ammo);
console.log('mobile fire:', ammoBefore, '->', ammoAfter);
if (ammoAfter >= ammoBefore) errors.push('mobile FIRE button did not consume ammo');
// look drag on right zone
await mob.touchscreen.touchStart(300, 300);
await mob.touchscreen.touchMove(240, 320);
await mob.touchscreen.touchEnd();
await sleep(400);
await mob.screenshot({ path: OUT + '14-mobile-after.png' });
console.log('shot: 14-mobile-after');
// pause via touch button
await mob.tap('#pause-btn');
await mob.waitForFunction(() => GAME.state === 'paused', { timeout: 10000 });
await mob.tap('#resume-btn');
await mob.waitForFunction(() => GAME.state === 'playing', { timeout: 10000 });
console.log('mobile pause/resume ok');
await mob.close();

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);