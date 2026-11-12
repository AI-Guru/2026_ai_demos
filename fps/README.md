# SECTOR 07 — Sublevel Maintenance Bay

Live: **https://ai-guru.github.io/2026_ai_demos/fps/** — built end-to-end with
**Qwen4-Max-Preview** (November 12th, 2026). The original prompt is in
[`prompt.md`](prompt.md).

A complete, tiny-scope first-person shooter that runs in the browser with a
AAA-style rendering pipeline. One dense room, escalating waves of sentinel
drones, a full weapon/gameplay loop — no external art assets: every texture,
model, and sound is generated procedurally at load time.

## Run

```bash
cd fps
npm start          # serves on http://localhost:8123
# or: python3 -m http.server 8123
```

Open **http://localhost:8123** in a WebGL2-capable browser (Chrome, Edge,
Firefox, Safari 16+). Click **CLICK TO DEPLOY**. Headphones recommended.

No build step. Three.js r169 is loaded from CDN via an import map.

## Controls

| Input | Action |
|---|---|
| W A S D / arrows | move |
| Mouse | look |
| LMB | fire (full auto) |
| RMB | aim down sights |
| Shift | sprint |
| Space | jump |
| R | reload |
| Esc | pause |
| M | mute |

Touch devices get a virtual stick (left thumb), drag-to-look (right), and
FIRE / AIM / RUN / JUMP / RLD buttons plus a pause button.

## The loop

Hold the bay against escalating waves of sentinels. Drones strafe, telegraph
with a charging eye-glow, and fire plasma bursts. Kills score points; wave
clears pay a bonus; downed drones sometimes drop integrity orbs. Health
regenerates after 5 s without damage. Death → stats → redeploy. Two threat
levels (Normal / Veteran) scale drone count, speed, and damage.

## Rendering pipeline

- **Procedural PBR** — seamless albedo / normal / roughness-metalness maps
  baked at load (concrete with formwork seams & tie holes, worn tile floor,
  brushed steel with rust creep, stenciled munitions crates, hazard stripes).
- **Lighting** — three shadow-casting ceiling slit spots with animated
  volumetric shafts, cool RectAreaLight strips, warm maintenance lamps,
  pulsing door beacon, PMREM environment for reflections, wet-floor puddles.
- **Post** — GTAO (sprites/volumes excluded from the g-buffer), Unreal bloom,
  custom film grade (split-tone, S-curve, vignette, animated grain, radial
  chromatic aberration, damage pulse), ACES tonemapping, SMAA.
- **Feel** — head-bob, landing dip, sprint FOV kick, ADS zoom, recoil springs,
  weapon sway, muzzle flash + light, ejecting brass, tracers, bullet decals,
  sparks/smoke/shockwaves, drifting dust motes, exponential fog.
- **Audio** — fully synthesized WebAudio: gunshots, steps, reload, drone hum
  that tracks proximity, plasma, explosions, UI ticks, and a generated
  convolution reverb tuned to the concrete bay.

## Layout

```
index.html          shell, HUD, menu/pause/death overlays, touch controls
styles.css          HUD + overlay + touch styling
src/main.js         renderer, state machine, input, wave flow, debug hooks
src/level.js        the bay: geometry, lights, shafts, puddles, colliders
src/textures.js     procedural PBR + sprite texture factory
src/player.js       pointer-lock controller, AABB physics, health/regen
src/weapon.js       viewmodel, ADS, recoil, hitscan, brass, reload
src/enemies.js      drone AI, bolts, drops, wave manager
src/fx.js           pooled particles, decals, tracers, rings, impact light
src/audio.js        synthesized SFX + ambience + convolution reverb
src/post.js         composer: GTAO → bloom → grade → ACES → SMAA
src/ui.js           DOM HUD state
test/smoke.mjs      headless end-to-end test + screenshot capture
```

## Flags & testing

- `?quality=low` — disables GTAO/SMAA and caps pixel ratio for weak GPUs.
- `?debug=1` — autostarts without pointer lock and exposes `window.GAME`
  (`start`, `fire`, `spawnWave`, `killAll`, `damage`, `god`, `setTimeScale`,
  `aimAtDrone`, `stats`, …) for automation.

```bash
npm install        # puppeteer-core (test only)
npm test           # headless Chrome: menu → combat → ADS → death → restart
                   # → wave sequencing → reload → resize → pause → mobile touch
```

The suite writes verification screenshots to `test/shots/` and fails on any
console/page/network error.