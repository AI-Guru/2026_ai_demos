// Automated playtest: boots the game in headless Chromium, clicks through the
// screens, flies, fires, and captures screenshots + console errors.
// Run: node tools/screenshot.mjs   (requires python3 tools/serve.py running)
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
if (!executablePath) throw new Error('No Chrome/Chromium found');

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
page.on('requestfailed', (r) => errors.push('reqfail: ' + r.url() + ' ' + r.failure()?.errorText));

const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `game_${name}.png`) });
  console.log('shot:', name);
};
const screen = () => page.evaluate(() => document.body.dataset.screen);
const waitScreen = async (name, timeout = 60000) => {
  await page.waitForFunction((n) => document.body.dataset.screen === n, { timeout }, name);
};

await page.goto('http://localhost:8377', { waitUntil: 'domcontentloaded' });
await waitScreen('title', 90000);
await sleep(2500);
await shot('01_title');

await page.click('#btn-campaign');
await waitScreen('briefing');
await sleep(800);
await shot('02_briefing');

await page.click('#btn-launch');
await waitScreen('none');
await sleep(4200);
await shot('03_flight_landed');

// lift off: hold Shift
await page.keyboard.down('Shift');
await sleep(2600);
await page.keyboard.up('Shift');
await sleep(600);
// fly forward
await page.keyboard.down('KeyW');
await sleep(3500);
await shot('04_flight_forward');
// bank turn
await page.keyboard.down('KeyD');
await sleep(1400);
await page.keyboard.up('KeyD');
await sleep(800);
await shot('05_flight_bank');
await page.keyboard.up('KeyW');

// guns
await page.keyboard.down('Space');
await sleep(1100);
await page.keyboard.up('Space');
await sleep(300);
await shot('06_guns');

// rockets
await page.keyboard.press('Digit2');
await page.keyboard.down('Space');
await sleep(900);
await page.keyboard.up('Space');
await sleep(500);
await shot('07_rockets');

// cockpit view
await page.keyboard.press('KeyV');
await sleep(700);
await shot('08_cockpit');
await page.keyboard.press('KeyV');
await sleep(400);

// map
await page.keyboard.press('KeyM');
await sleep(700);
await shot('09_map');
await page.keyboard.press('KeyM');
await sleep(300);

// pause
await page.keyboard.press('Escape');
await sleep(500);
await shot('10_pause');
await page.keyboard.press('Escape');
await sleep(300);

// state dump
const state = await page.evaluate(() => {
  const g = window.__tiger;
  if (!g) return null;
  return {
    state: g.state,
    pos: [g.flight?.x?.toFixed(0), g.flight?.y?.toFixed(0), g.flight?.z?.toFixed(0)],
    kmh: g.flight?.kmh?.toFixed(0),
    agl: g.flight?.agl?.toFixed(0),
    hp: g.flight?.hp,
    ammo: g.weapons?.ammo,
    entities: g.entities?.list?.length,
    projectiles: g.weapons?.projectiles?.length,
    particles: g.particles?.list?.length,
    res: [g.resLevel],
  };
});
console.log('STATE:', JSON.stringify(state, null, 1));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE ERRORS');
await browser.close();
process.exit(errors.length ? 1 : 0);