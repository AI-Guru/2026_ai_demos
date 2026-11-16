# TIGER — Operation Weißer Blitz

A Comanche-style (NovaLogic Voxel Space, 1992) helicopter combat simulator for the web.
Vehicle: Eurocopter Tiger UHT of the Bundeswehr Heeresflieger. Setting: Germany.

## Architecture

- **Voxel engine** (`js/engine/voxel.js`): authentic Voxel Space heightfield raycaster.
  Per screen column a ray marches front-to-back over a 1024×1024 heightmap + colormap,
  recording per-column depth segments (segTop/segZ). Sprites (pre-rendered voxel models)
  are then composited far-to-near with a per-pixel binary-search depth test against those
  segments, so terrain occludes them correctly even through transparent sprite gaps.
  Distance haze, gradient sky, sun, camera pitch/roll.
- **Asset pipeline** (`tools/*.py`, numpy + Pillow): fractal terrain per mission biome
  (Lüneburger Heide, Bayerischer Wald, Schwäbische Alb, Allgäu at dusk) with baked
  hillshade, rivers, roads, villages, forests; voxel models (Tiger, T-80, Gepard, SA-8,
  Mi-28, buildings, trees…) rendered to multi-angle sprite sheets via a vectorized
  numpy z-buffer splatter.
- **Game** (`js/game/*`): arcade-sim flight model, weapons (30 mm cannon, 70 mm rockets,
  PARS 3 LR fire-and-forget missiles, flares), enemy AI (tanks, AAA, SAM with lock
  warnings, convoys, gunship boss), 4-mission campaign + free flight, FARP rearm/refuel,
  collateral damage tracking, radio messages, map screen, debrief with ratings.
  Controls: W/S cyclic, A/D bank, Q/E yaw, SHIFT/C collective, SPACE fire, 1/2/3 weapons,
  F flares, V view, M map, ESC pause.
- **Audio** (`js/engine/audio.js`): fully procedural WebAudio — rotor blade-pass thump,
  turbine whine, wind, weapons, explosions, lock/warning tones, title music.
- **UI** (`index.html`, `css/style.css`, `js/ui.js`): military CRT aesthetic screens
  (title / briefing+loadout / debrief / pause / controls / loading), DOM radio box.

## World conventions

- World units = meters. x east, z north, y up. Map 1024×1024 cells, CELL = 4 m → 4096 m.
- Heading 0 = north (+z), clockwise positive. Forward = (sin h, cos h) in (x, z).
- Terrain height = heightByte × meta.heightScale. Row-major: index = iz*1024 + ix.

## Asset formats

- `assets/terrain/mN_height.bin` Uint8 1024², `mN_color.bin` RGB 1024²,
  `mN_map.png` 1024² hillshaded overview, `mN_meta.json` (scale, water, spawn, farp,
  sky palette, trees, rocks, entities — single source of truth shared with missions.js).
- `assets/models/<name>.png` + `.json`: sprite sheet, cols = yaw frames (frame 0 = front
  view, nose toward camera), rows = camera elevation bands. Metadata: frameW/H, cols,
  rows, yawStep, elevations, pxPerMeter, anchorX/Y (ground-center pixel), worldH, radius.
  Tiger extras: rotorHub/tailRotor local offsets (x right, y up, z nose-forward), radii.

## Run

```
python3 tools/gen_terrain.py && python3 tools/gen_models.py   # regenerate assets
python3 tools/serve.py                                        # → http://localhost:8377
```

## QA

- `node tests/render_test.mjs` — headless engine frames → PNG (no browser needed).
- `node tools/screenshot.mjs` — puppeteer-core playthrough with console capture.
- `node tools/flowtest.mjs` — full mission-flow checks (win → debrief → next mission,
  SAM lock → missile → flare decoy, FARP service, convoy escape fail, training
  crash → respawn); drives the game through `window.__tiger` / `window.__dbg` QA hooks.