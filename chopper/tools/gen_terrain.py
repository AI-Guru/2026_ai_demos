#!/usr/bin/env python3
"""
gen_terrain.py — generate the 4 mission terrains for TIGER — Operation
Weißer Blitz from tools/terrain_config.json (the authored source of truth).

Outputs per map id N (assets/terrain/):
  mN_height.bin  raw Uint8 1024*1024, row-major (iz*1024+ix), meters = byte*heightScale
  mN_color.bin   raw RGB 3*1024*1024, hillshade + jitter baked in
  mN_map.png     1024x1024 top-down overview
  mN_meta.json   config echo + size/cell/bounds/trees/rocks/heightRange

Pure numpy (no scipy). Deterministic per-map RNG. Run: python3 tools/gen_terrain.py
"""
from __future__ import annotations

import json
import os
import time

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "terrain")
CONFIG = os.path.join(ROOT, "tools", "terrain_config.json")

N = 1024
CELL = 4.0
AX = (np.arange(N, dtype=np.float32) + 0.5) * CELL     # x east
AZ = (np.arange(N, dtype=np.float32) + 0.5) * CELL     # z north
XX, ZZ = np.meshgrid(AX, AZ)                            # row = iz

CLEAR_RADIUS = {
    "farp": 36, "bunker": 28, "fueldepot": 32, "osa": 26, "radar": 22,
    "church": 24, "house": 22, "watertower": 16, "tank": 20, "gepard": 20,
    "bmp": 18, "truck": 18, "tent": 14, "mi28": 22, "spawn": 45,
}

# clearings that keep a raw gravel pad; all others tint toward the biome
GRAVEL_CLEARINGS = {"farp", "bunker", "fueldepot", "osa"}


# --------------------------------------------------------------------------
# noise / fields
# --------------------------------------------------------------------------
def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def value_noise(rng, g):
    """Random (g+1)^2 grid bilinear-upsampled to N^2 (floor/frac gather + lerp)."""
    grid = rng.random((g + 1, g + 1)).astype(np.float32)
    u = np.arange(N, dtype=np.float32) * (g / N)
    i0 = np.floor(u).astype(np.intp)
    f = u - i0
    i1 = np.minimum(i0 + 1, g)
    a = grid[i0[:, None], i0[None, :]]
    b = grid[i0[:, None], i1[None, :]]
    c = grid[i1[:, None], i0[None, :]]
    d = grid[i1[:, None], i1[None, :]]
    fx = f[None, :]
    fz = f[:, None]
    top = a + (b - a) * fx
    bot = c + (d - c) * fx
    return top + (bot - top) * fz


def fbm(rng, octaves=(4, 8, 16, 32, 64, 128), persistence=0.5):
    total = np.zeros((N, N), np.float32)
    amp, norm = 1.0, 0.0
    for g in octaves:
        total += amp * value_noise(rng, g)
        norm += amp
        amp *= persistence
    return total / norm


def ridged_fbm(rng, octaves=(4, 8, 16, 32, 64, 128)):
    """Ridged multifractal: sharp peaks, flat-ish valleys."""
    total = np.zeros((N, N), np.float32)
    amp, norm, prev = 1.0, 0.0, np.ones((N, N), np.float32)
    for g in octaves:
        n = value_noise(rng, g)
        r = 1.0 - np.abs(2.0 * n - 1.0)
        r = r * r
        total += amp * r * (0.35 + 0.65 * prev)
        prev = r
        norm += amp
        amp *= 0.5
    return total / norm


def hash2(ix, iz, seed):
    h = (ix.astype(np.int64) * 374761393 + iz.astype(np.int64) * 668265263
         + int(seed) * 974634211)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFFFF).astype(np.float32) / 4294967295.0


def dist_polyline(pts):
    """Distance field (meters) to a polyline given in world meters."""
    d = np.full((N, N), np.inf, np.float32)
    for (ax, az), (bx, bz) in zip(pts[:-1], pts[1:]):
        abx, abz = bx - ax, bz - az
        l2 = abx * abx + abz * abz
        t = np.clip(((XX - ax) * abx + (ZZ - az) * abz) / max(l2, 1e-9), 0, 1)
        dx = XX - (ax + t * abx)
        dz = ZZ - (az + t * abz)
        np.minimum(d, np.hypot(dx, dz), out=d)
    return d


def box_blur(a, r):
    p = np.pad(a, r, mode="edge")
    ii = np.zeros((p.shape[0] + 1, p.shape[1] + 1), np.float64)
    ii[1:, 1:] = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = ii[k:, k:] - ii[:-k, k:] - ii[k:, :-k] + ii[:-k, :-k]
    return (s / (k * k)).astype(np.float32)


def lerp3(a, b, t):
    """a,b: RGB tuples or (N,N,3); t: (N,N) float 0..1 or scalar -> (N,N,3)."""
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    t = np.asarray(t, np.float32)
    if t.ndim == 0:
        return a + (b - a) * t
    return a + (b - a) * t[..., None]


def disc_mask(cx, cz, r):
    return np.hypot(XX - cx, ZZ - cz) < r


def periodic_noise1d(rng, points=16):
    """Smooth wrap-around 1D value noise, periodic on u in [0, 1)."""
    vals = rng.random(points).astype(np.float32)

    def sample(u):
        u = np.mod(np.asarray(u, np.float32), 1.0) * points
        i0 = np.floor(u).astype(np.intp) % points
        f = u - np.floor(u)
        f = f * f * (3.0 - 2.0 * f)
        return vals[i0] + (vals[(i0 + 1) % points] - vals[i0]) * f

    return sample


def blob_radius(rng, r, lo, hi):
    """Irregular disc: r(theta) = r * (lo + (hi-lo) * n(theta)), smooth/wrapping.

    Two LOW-frequency periodic octaves (6 + 13 lobes). High lobe counts made
    shorelines read as stars/cogs; 6 broad lobes + faint detail stay organic.
    """
    na = periodic_noise1d(rng, 6)
    nb = periodic_noise1d(rng, 13)
    pa, pb = float(rng.random()), float(rng.random())

    def radius(theta):
        u = theta / (2.0 * np.pi)
        n = 0.78 * na(u + pa) + 0.22 * nb(u + pb)
        return r * (lo + (hi - lo) * n)

    return radius


def dist_polyline_s(pts):
    """Like dist_polyline, but also returns arc length s of the closest
    projection and total path length L (for along-path width variation)."""
    d = np.full((N, N), np.inf, np.float32)
    s = np.zeros((N, N), np.float32)
    acc = 0.0
    for (ax, az), (bx, bz) in zip(pts[:-1], pts[1:]):
        abx, abz = bx - ax, bz - az
        l2 = abx * abx + abz * abz
        seglen = float(np.hypot(abx, abz))
        t = np.clip(((XX - ax) * abx + (ZZ - az) * abz) / max(l2, 1e-9), 0, 1)
        dx = XX - (ax + t * abx)
        dz = ZZ - (az + t * abz)
        ds = np.hypot(dx, dz)
        upd = ds < d
        d[upd] = ds[upd]
        s[upd] = acc + t[upd] * seglen
        acc += seglen
    return d, s, acc


def paint_fields(col, cfg, rng, forest_t, water, road_dist, slope, n_hi):
    """4-8 muted crop fields per village: random non-overlapping axis-aligned
    rects (90-220 m) outside the village disc, soft edges. Heath/plateau only."""
    palette = [(200, 180, 106),   # wheat  #c8b46a
               (184, 192, 80),    # rape   #b8c050
               (138, 106, 74),    # plowed #8a6a4a
               (125, 154, 80)]    # grass  #7d9a50
    for v in cfg.get("villages", []):
        placed = []
        n_fields = int(rng.integers(4, 9))
        tries = 0
        while len(placed) < n_fields and tries < 240:
            tries += 1
            w = float(rng.uniform(90, 220))
            hh = float(rng.uniform(90, 220))
            ang = float(rng.uniform(0, 2 * np.pi))
            dist = float(rng.uniform(v["r"] * 1.35, v["r"] * 2.8))
            cx = v["x"] + np.cos(ang) * dist
            cz = v["z"] + np.sin(ang) * dist
            x0, x1 = cx - w / 2, cx + w / 2
            z0, z1 = cz - hh / 2, cz + hh / 2
            if x0 < 170 or x1 > 3926 or z0 < 170 or z1 > 3926:
                continue
            # keep clear of the village disc (closest rect point to center)
            px, pz = np.clip(v["x"], x0, x1), np.clip(v["z"], z0, z1)
            if np.hypot(px - v["x"], pz - v["z"]) < v["r"] + 12:
                continue
            if any(not (x1 < p[0] - 10 or x0 > p[1] + 10
                        or z1 < p[2] - 10 or z0 > p[3] + 10) for p in placed):
                continue
            i0, i1 = int(x0 / CELL), int(x1 / CELL)
            j0, j1 = int(z0 / CELL), int(z1 / CELL)
            if water[j0:j1 + 1, i0:i1 + 1].any():
                continue
            if forest_t[j0:j1 + 1, i0:i1 + 1].max() > 0.25:
                continue
            if road_dist[j0:j1 + 1, i0:i1 + 1].min() < 14:
                continue
            if slope[j0:j1 + 1, i0:i1 + 1].max() > 0.35:
                continue
            placed.append((x0, x1, z0, z1))
            color = np.asarray(palette[int(rng.integers(0, len(palette)))], np.float32)
            di = np.minimum(np.minimum(XX - x0, x1 - XX),
                            np.minimum(ZZ - z0, z1 - ZZ))
            t = smoothstep((di + 3.0) / 6.0)      # soft ~6 m edge
            tint = color * (0.92 + 0.16 * n_hi[..., None])
            col = lerp3(col, tint, t * 0.9)
    return col


# --------------------------------------------------------------------------
# per-map generation
# --------------------------------------------------------------------------
def gen_map(cfg):
    t0 = time.time()
    seed = cfg["seed"]
    rng = np.random.default_rng(seed)
    biome = cfg["biome"]
    wl = float(cfg["waterLevel"])
    scale = float(cfg["heightScale"])
    b0, b1 = cfg["baseRange"]
    relief = float(cfg["relief"])

    fb = fbm(rng)
    n_low = value_noise(rng, 8)
    n_med = value_noise(rng, 24)
    n_hi = value_noise(rng, 96)
    n_low2 = value_noise(rng, 6)
    n_canopy = value_noise(rng, 160)    # high-freq mottled canopy

    # ---- base height ------------------------------------------------------
    if biome == "heath":
        relief = max(relief, 46.0)      # gentle rolls, byte range preserved
        h = b0 + (b1 - b0) * fbm(rng, (4, 8, 16, 32))
        h += relief * (n_low - 0.5)     # broad ±23 m rolls
        h += relief * 0.12 * (n_hi - 0.5)
    elif biome == "forest":
        h = b0 + (b1 - b0) * fb + relief * 0.35 * (fbm(rng, (8, 16, 32, 64)) - 0.5) * 2
    elif biome == "plateau":
        wiggle = 100.0 * (n_low2 - 0.5) * 2.0
        band = smoothstep((ZZ - (1600.0 + wiggle)) / 180.0)
        h = 260.0 + 120.0 * band + relief * 0.5 * (fb - 0.5) * 2.0
        h = np.clip(h, 205.0, 430.0)
    elif biome == "alpine":
        r = ridged_fbm(rng)
        h = 340.0 + 520.0 * np.power(r, 1.15)
        # carve usable valley cirques at spawn / FARP (config puts them in
        # the valley floor; ridged noise may place peaks there)
        for cx, cz in ((cfg["spawn"]["x"], cfg["spawn"]["z"]),
                       (cfg["farp"]["x"], cfg["farp"]["z"])):
            d = np.hypot(XX - cx, ZZ - cz)
            t = 1.0 - smoothstep((d - 70.0) / 130.0)
            target = np.minimum(h, 380.0)
            h += (target - h) * t
    else:
        raise ValueError(biome)
    h = h.astype(np.float32)

    # ---- irregular forest / water shapes (shared by color, trees, bushes) ---
    forest_shapes = []
    for f in cfg.get("forests", []):
        rf = blob_radius(rng, float(f["r"]), 0.78, 1.14)
        theta = np.arctan2(ZZ - f["z"], XX - f["x"])
        forest_shapes.append((f, rf, rf(theta)))
    water_shapes = []
    for w in cfg.get("water", []):
        rf = blob_radius(rng, float(w["r"]), 0.80, 1.20)
        theta = np.arctan2(ZZ - w["z"], XX - w["x"])
        water_shapes.append((w, rf(theta)))

    # ---- water: ponds / lakes (irregular shoreline, ±25%) ------------------
    for w, reff in water_shapes:
        d = np.hypot(XX - w["x"], ZZ - w["z"])
        depth = 12.0
        inside = d < reff
        h[inside] = (wl - depth * (1.0 - (d[inside] / reff[inside]) ** 2))
        bank = (d >= reff) & (d < reff + 40)
        t = smoothstep((d[bank] - reff[bank]) / 40.0)
        h[bank] = np.minimum(h[bank], wl + np.maximum(h[bank] - wl, 2.0) * t)

    # ---- rivers ------------------------------------------------------------
    river_dist = np.full((N, N), np.inf, np.float32)
    river_hw = np.full((N, N), np.inf, np.float32)   # channel half-width at nearest path point
    gorge_dist = np.full((N, N), np.inf, np.float32)
    for rv in cfg.get("rivers", []):
        d, s, L = dist_polyline_s(rv["path"])
        # channel width varies gently along the path (2 cycles, 5 lobes each;
        # higher frequencies scalloped the gorge rim like a caterpillar)
        wnoise = periodic_noise1d(rng, 5)
        wphase = float(rng.random())
        wf = 0.75 + 0.50 * wnoise(2.0 * s / max(L, 1e-9) + wphase)
        hw = float(rv["width"]) / 2.0 * wf
        if rv.get("gorge"):
            # deep narrow V: rim wl+110 at ~45 m from the channel, 40 m wall
            # blend (a 120 m V painted the whole 360 m band as flat tan rock)
            G = 45.0 * wf
            np.minimum(gorge_dist, d, out=gorge_dist)
            core = d < G
            # flat-ish bed 12 m half-width so the gorge river stays visible
            h[core] = np.minimum(h[core], wl - 6.0 + 116.0 * smoothstep(
                (d[core] - 12.0) / np.maximum(G[core] - 12.0, 1.0)))
            wall = (d >= G) & (d < G + 40)
            t = smoothstep((d[wall] - G[wall]) / 40.0)
            rim = wl + 110.0
            h[wall] = np.minimum(h[wall], rim + (h[wall] - rim) * t)
        else:
            upd = d < river_dist
            river_dist[upd] = d[upd]
            river_hw[upd] = hw[upd]
            core = d < hw
            h[core] = np.minimum(h[core], wl - 6.0 * (1.0 - (d[core] / hw[core]) ** 2))
            # broad gentle valley: floor wl+25, walls fade back over 160 m so
            # they stay forested slopes instead of rock-painted canal cliffs
            valley = (d >= hw) & (d < 340.0)
            rise = smoothstep((d[valley] - hw[valley]) / 90.0)
            fade = 1.0 - smoothstep((d[valley] - 180.0) / 160.0)
            target = wl + 25.0 * rise
            h[valley] = np.minimum(h[valley],
                                   target + (h[valley] - target) * (1.0 - fade))

    water = h < wl - 0.05
    land = ~water

    # ---- villages: gentle flatten ------------------------------------------
    village_mask = np.zeros((N, N), bool)
    for v in cfg.get("villages", []):
        d = np.hypot(XX - v["x"], ZZ - v["z"])
        disc = d < v["r"]
        village_mask |= disc
        sel = disc & land
        mean = float(h[sel].mean())
        f = 0.75 * (1.0 - smoothstep((d - v["r"] * 0.6) / (v["r"] * 0.4)))
        h[sel] += (mean - h[sel]) * f[sel]

    # ---- entity clearings (+ spawn) -----------------------------------------
    clearing_mask = np.zeros((N, N), bool)     # full-strength core (trees rejected)
    clearing_edge = np.zeros((N, N), bool)
    dirt_blend = np.zeros((N, N), np.float32)   # military pads: raw gravel
    clear_blend = np.zeros((N, N), np.float32)  # others: 60% toward biome color
    spots = [(e["x"], e["z"], CLEAR_RADIUS.get(e["type"], 18), e["type"])
             for e in cfg["entities"] if e["type"] != "bridge"]
    spots.append((cfg["spawn"]["x"], cfg["spawn"]["z"], CLEAR_RADIUS["spawn"], "spawn"))
    for cx, cz, r, typ in spots:
        d = np.hypot(XX - cx, ZZ - cz)
        disc = d < r
        sel = disc & land
        if not sel.any():
            continue
        mean = float(h[sel].mean())
        f = 0.9 * (1.0 - smoothstep((d - r * 0.55) / (r * 0.45)))
        h[sel] += (mean - h[sel]) * f[sel]
        clearing_mask |= d < r * 0.8
        clearing_edge |= disc
        blend = dirt_blend if typ in GRAVEL_CLEARINGS else clear_blend
        np.maximum(blend, 1.0 - smoothstep((d - r * 0.5) / (r * 0.5)), out=blend)

    # ---- roads ---------------------------------------------------------------
    road_dist = np.full((N, N), np.inf, np.float32)
    h_smooth = box_blur(h, 5)
    for road in cfg.get("roads", []):
        d = dist_polyline(road)
        np.minimum(road_dist, d, out=road_dist)
        f = np.where(d < 9, 0.9, 0.9 * (1.0 - smoothstep((d - 9) / 6.0)))
        sel = land & (d < 15)          # never raise water cells
        h[sel] += (h_smooth[sel] - h[sel]) * f[sel]

    # map3 exception: causeway across the gorge at the bridge (2100, 2300).
    # Flat deck at waterLevel+6 in the middle, smooth ramps up to the plateau
    # at both ends so the tank column can actually drive across.
    causeway = np.zeros((N, N), bool)
    if cfg["id"] == 3:
        d = dist_polyline([[2100, 1500], [2100, 2900]])
        corridor = d < 6.0             # 3 cells wide (12 m)
        t = smoothstep(np.clip((np.abs(ZZ - 2300.0) - 80.0) / 720.0, 0, 1))
        prof = (wl + 6.0) + (h - (wl + 6.0)) * t
        causeway = corridor & ((h - prof > 3.0) | (prof - h > 0.5))
        h[corridor] = prof[corridor]
        road_dist = np.minimum(road_dist, d)

    water = h < wl - 0.05
    land = ~water

    # ---- slope ---------------------------------------------------------------
    gy, gx = np.gradient(h, CELL)
    slope = np.hypot(gx, gy)

    # ---- biome colors ----------------------------------------------------------
    if biome == "heath":
        # saturated heath: grass green + calluna purple dominant, sand patchy
        veg = lerp3((98, 126, 54), (126, 82, 140), smoothstep(n_low * 1.4 - 0.2))
        veg = veg * (0.88 + 0.24 * n_hi[..., None])
        sand_t = smoothstep((n_med - 0.66) / 0.22)
        col = lerp3(veg, (182, 164, 116), sand_t)
        forest_t = np.zeros((N, N), np.float32)
        for f, rf, reff in forest_shapes:
            d = np.hypot(XX - f["x"], ZZ - f["z"])
            t = 1.0 - smoothstep((d - reff + 40) / 40.0)
            forest_t = np.maximum(forest_t, t)
        canopy = (54, 80, 44) * (0.78 + 0.44 * (0.6 * n_canopy + 0.4 * n_hi)[..., None])
        col = lerp3(col, canopy, forest_t)
        # crop fields outside villages (random rects, not a grid patchwork)
        col = paint_fields(col, cfg, rng, forest_t, water, road_dist, slope, n_hi)
    elif biome == "forest":
        col = (51, 80, 43) * (0.82 + 0.36 * (0.6 * n_canopy + 0.4 * n_med)[..., None])
        clear_t = smoothstep((0.6 * n_low + 0.4 * n_med - 0.60) / 0.10) * (slope < 0.5)
        col = lerp3(col, (106, 138, 69), clear_t * 0.9)
        rock_t = smoothstep((slope - 1.8) / 0.6) * smoothstep((n_med - 0.40) / 0.25)
        col = lerp3(col, (122, 122, 114), rock_t)
        # floodplain meadow hugging the river, thin gravel shore at the waterline
        # (the old 60 m gravel band read as gray canal embankments)
        meadow_t = (1.0 - smoothstep((river_dist - 60.0) / 80.0)) * (slope < 0.35)
        col = lerp3(col, (112, 142, 74) * (0.9 + 0.2 * n_hi[..., None]), meadow_t * 0.85)
        bank = river_dist - river_hw
        gravel_t = smoothstep((bank + 2.0) / 4.0) * (1.0 - smoothstep((bank - 10.0) / 8.0))
        col = lerp3(col, (150, 140, 116), gravel_t * 0.75)
    elif biome == "plateau":
        col = (125, 154, 80) * (0.9 + 0.2 * n_med[..., None])
        forest_t = np.zeros((N, N), np.float32)
        for f, rf, reff in forest_shapes:
            d = np.hypot(XX - f["x"], ZZ - f["z"])
            forest_t = np.maximum(forest_t, 1.0 - smoothstep((d - reff + 40) / 40.0))
        canopy = (54, 80, 44) * (0.78 + 0.44 * (0.6 * n_canopy + 0.4 * n_hi)[..., None])
        col = lerp3(col, canopy, forest_t)
        # rock #9a8a70 on the escarpment face + gorge walls (slope-based)
        wiggle = 100.0 * (n_low2 - 0.5) * 2.0
        esc = (np.abs(ZZ - (1600.0 + wiggle)) < 230) & (slope > 0.4)
        col = lerp3(col, (154, 138, 112), esc * smoothstep((slope - 0.4) / 0.4))
        gw = (gorge_dist < 220) & (slope > 0.38)
        col = lerp3(col, (148, 132, 108), gw * smoothstep((slope - 0.38) / 0.30))
        col = paint_fields(col, cfg, rng, forest_t, water, road_dist, slope, n_hi)
    elif biome == "alpine":
        col = np.broadcast_to(np.array((106, 138, 69), np.float32), (N, N, 3)).copy()
        forest_t = np.zeros((N, N), np.float32)
        for f, rf, reff in forest_shapes:
            d = np.hypot(XX - f["x"], ZZ - f["z"])
            forest_t = np.maximum(forest_t, 1.0 - smoothstep((d - reff + 40) / 40.0))
        conifer = (h < 480) & ((forest_t > 0.2) | (n_med > 0.5))
        ct = np.clip(forest_t + (n_med > 0.5) * 0.55, 0, 1) * conifer
        col = lerp3(col, (51, 80, 43) * (0.82 + 0.36 * (0.6 * n_canopy + 0.4 * n_hi)[..., None]), ct)
        rock_t = np.clip(smoothstep((h - 460) / 60) + smoothstep((slope - 0.8) / 0.3), 0, 1)
        rock_t *= (h < 660)
        col = lerp3(col, (122, 114, 104), rock_t)
        snow_t = smoothstep((h - 640 + 40 * (n_hi - 0.5)) / 60)
        col = lerp3(col, (232, 236, 240), snow_t)
        for w, reff in water_shapes:
            d = np.hypot(XX - w["x"], ZZ - w["z"])
            shore = (d > reff) & (d < reff + 25) & (h < wl + 12)
            col = lerp3(col, (168, 158, 128), shore * 0.8)
    else:
        raise ValueError(biome)
    col = col.astype(np.float32)

    # village disc: packed dirt/grass blend with noise (no checker pattern)
    for v in cfg.get("villages", []):
        d = np.hypot(XX - v["x"], ZZ - v["z"])
        t = 1.0 - smoothstep((d - v["r"] * 0.7) / (v["r"] * 0.3))
        dirt_t = smoothstep((n_hi - 0.45) / 0.3)
        vcol = lerp3((122, 132, 82), (142, 132, 112), dirt_t)
        col = lerp3(col, vcol, t * 0.8)

    # roads: continuous gravel, half-width 9 m, soft 1-cell edge, dark ruts
    road_t = (1.0 - smoothstep((road_dist - 9.0) / 4.0)) * land
    col = lerp3(col, (138, 122, 96), road_t)
    rut_t = (1.0 - smoothstep(np.abs(road_dist - 2.6) / 1.4)) * road_t
    col = lerp3(col, (108, 96, 74), rut_t * 0.85)
    if causeway.any():
        col[causeway] = (148, 140, 124)

    # entity clearings: military pads stay gravel; others blend 60% toward biome
    col = lerp3(col, (138, 130, 114), dirt_blend * land)
    soft_target = lerp3((138, 130, 114), col, 0.6)
    col = lerp3(col, soft_target, clear_blend * land)

    # water: depth-shaded blue
    if water.any():
        depth = np.clip((wl - h) / 12.0, 0, 1)
        wc = lerp3((74, 122, 154), (36, 70, 106), depth)
        wc += (n_hi[..., None] - 0.5) * 8.0
        col[water] = wc[water]

    # ---- hillshade (sun az 225 SW, el 40) + jitter ----------------------------
    inv = 1.0 / np.sqrt(1.0 + gx * gx + gy * gy)
    az, el = np.radians(225.0), np.radians(40.0)
    L = (np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el))
    dot = (-gx * inv) * L[0] + inv * L[1] + (-gy * inv) * L[2]
    shade = 0.60 + 0.65 * np.clip(dot, 0.0, 1.0)
    shade *= np.where(slope > 0.45, 0.85, 1.0)   # steep faces read darker
    col *= shade[..., None]
    ix = np.arange(N)[None, :].repeat(N, 0)
    iz = np.arange(N)[:, None].repeat(N, 1)
    jitter = (hash2(ix, iz, seed) - 0.5) * (16.0 if biome == "heath" else 10.0)
    col += jitter[..., None]
    col = np.clip(col, 0, 255).astype(np.uint8)

    # ---- height bytes ----------------------------------------------------------
    hb = np.floor(h / scale)
    assert np.isfinite(h).all(), "NaN in heightfield"
    assert hb.min() >= 0 and hb.max() <= 255, f"height byte overflow: {hb.min()}..{hb.max()}"
    height_bytes = hb.astype(np.uint8)
    assert (height_bytes[water].astype(np.float32) * scale < wl).all(), "water cell >= waterLevel"

    # ---- trees -------------------------------------------------------------------
    trees = []
    for f, rf, reff in forest_shapes:
        cx, cz, r, dens = f["x"], f["z"], f["r"], f["density"]
        xs = np.arange(cx - r * 1.15, cx + r * 1.15, 13.0)
        zs = np.arange(cz - r * 1.15, cz + r * 1.15, 13.0)
        gx_, gz_ = np.meshgrid(xs, zs)
        gx_ = gx_.ravel() + rng.uniform(-5, 5, gx_.size)
        gz_ = gz_.ravel() + rng.uniform(-5, 5, gz_.size)
        dd = np.hypot(gx_ - cx, gz_ - cz)
        rr = rf(np.arctan2(gz_ - cz, gx_ - cx))   # same irregular mask as color
        keep = dd < rr
        gx_, gz_, dd, rr = gx_[keep], gz_[keep], dd[keep], rr[keep]
        ixs = np.clip((gx_ / CELL).astype(int), 0, N - 1)
        izs = np.clip((gz_ / CELL).astype(int), 0, N - 1)
        ok = (~water[izs, ixs] & (road_dist[izs, ixs] > 10)
              & ~clearing_mask[izs, ixs] & ~village_mask[izs, ixs]
              & (slope[izs, ixs] < 0.85))
        if biome == "alpine":
            ok &= h[izs, ixs] < 500.0
        ok &= rng.random(len(ok)) < dens
        gx_, gz_, dd, rr = gx_[ok], gz_[ok], dd[ok], rr[ok]
        for x, z, d_, r_ in zip(gx_, gz_, dd, rr):
            u = rng.random()
            if biome in ("forest", "alpine"):
                typ = 0 if u < 0.75 else (1 if u < 0.88 else 2)
            else:
                typ = 0 if u < 0.2 else (1 if u < 0.7 else 2)
            trees.append((d_ / r_, round(float(x), 1), round(float(z), 1),
                          typ, round(float(rng.uniform(0.8, 1.3)), 2)))
    trees.sort(key=lambda t: t[0])
    trees = [[x, z, ty, sc] for _, x, z, ty, sc in trees[:900]]

    # heath bushes outside forests
    if biome == "heath":
        added = 0
        while added < 120:
            x, z = rng.uniform(160, 3936, 2)
            i, j = int(x / CELL), int(z / CELL)
            if water[j, i] or road_dist[j, i] < 10 or clearing_mask[j, i] or village_mask[j, i]:
                continue
            if any(np.hypot(x - f["x"], z - f["z"]) < reff[j, i]
                   for f, rf, reff in forest_shapes):
                continue
            trees.append([round(float(x), 1), round(float(z), 1), 2,
                          round(float(rng.uniform(0.8, 1.3)), 2)])
            added += 1
        trees = trees[:900]

    # rocks: alpine scree above 480 m / plateau escarpment scree
    rocks = []
    if biome in ("alpine", "plateau"):
        tries = 0
        while len(rocks) < 100 and tries < 4000:
            tries += 1
            x, z = rng.uniform(160, 3936, 2)
            i, j = int(x / CELL), int(z / CELL)
            if water[j, i] or road_dist[j, i] < 10 or clearing_mask[j, i]:
                continue
            if biome == "alpine" and h[j, i] < 480:
                continue
            if biome == "plateau" and not (abs(z - 1600) < 260 and slope[j, i] > 0.4):
                continue
            rocks.append([round(float(x), 1), round(float(z), 1),
                          round(float(rng.uniform(0.7, 1.5)), 2)])

    # ---- sanity ------------------------------------------------------------------
    sx, sz = cfg["spawn"]["x"], cfg["spawn"]["z"]
    spawn_h = float(h[int(sz / CELL), int(sx / CELL)])
    assert spawn_h > wl, f"spawn underwater: {spawn_h} <= {wl}"
    assert len(trees) <= 900

    # ---- write ---------------------------------------------------------------------
    os.makedirs(OUT, exist_ok=True)
    i = cfg["id"]
    height_bytes.tofile(os.path.join(OUT, f"m{i}_height.bin"))
    col.tofile(os.path.join(OUT, f"m{i}_color.bin"))
    Image.fromarray(col, "RGB").save(os.path.join(OUT, f"m{i}_map.png"))
    meta = dict(cfg)
    meta.update({
        "size": N, "cell": CELL, "bounds": [160, 160, 3936, 3936],
        "trees": trees, "rocks": rocks,
        "heightRange": [round(float(h.min()), 1), round(float(h.max()), 1)],
    })
    with open(os.path.join(OUT, f"m{i}_meta.json"), "w") as f:
        json.dump(meta, f)

    hs = os.path.getsize(os.path.join(OUT, f"m{i}_height.bin"))
    cs = os.path.getsize(os.path.join(OUT, f"m{i}_color.bin"))
    assert hs == N * N and cs == 3 * N * N
    print(f"map {i} {cfg['name']:<20} biome={biome:<8} "
          f"h={h.min():6.1f}..{h.max():6.1f}m  water={int(water.sum()):>6} cells  "
          f"trees={len(trees):>3} rocks={len(rocks):>3}  spawn_h={spawn_h:6.1f}m  "
          f"bin={hs/1024:.0f}K/{cs/1024:.0f}K  {time.time()-t0:.1f}s")
    return meta


def make_contact_sheet(metas):
    cell = 512
    label_h = 24
    sheet = Image.new("RGB", (2 * cell, 2 * (cell + label_h)), (24, 26, 30))
    draw = ImageDraw.Draw(sheet)
    for k, meta in enumerate(metas):
        im = Image.open(os.path.join(OUT, f"m{meta['id']}_map.png")).resize((cell, cell), Image.LANCZOS)
        cx = (k % 2) * cell
        cy = (k // 2) * (cell + label_h)
        sheet.paste(im, (cx, cy))
        draw.text((cx + 8, cy + cell + 5),
                  f"m{meta['id']}  {meta['name']}  ({meta['biome']})",
                  fill=(220, 220, 210))
    sheet.save(os.path.join(OUT, "_contact.png"))


def update_manifest(metas):
    path = os.path.join(ROOT, "assets", "manifest.json")
    manifest = {}
    if os.path.exists(path):
        with open(path) as f:
            manifest = json.load(f)
    manifest["terrain"] = [
        {"id": m["id"], "name": m["name"],
         "height": f"terrain/m{m['id']}_height.bin",
         "color": f"terrain/m{m['id']}_color.bin",
         "map": f"terrain/m{m['id']}_map.png",
         "meta": f"terrain/m{m['id']}_meta.json"} for m in metas
    ]
    text = json.dumps(manifest, indent=1)
    if os.path.exists(path):
        with open(path) as f:
            if f.read() == text:
                return                      # unchanged: don't touch the file
    with open(path, "w") as f:
        f.write(text)


def main():
    t0 = time.time()
    with open(CONFIG) as f:
        cfg = json.load(f)
    metas = [gen_map(m) for m in cfg["maps"]]
    make_contact_sheet(metas)
    update_manifest(metas)
    print(f"contact sheet: assets/terrain/_contact.png")
    print(f"TOTAL: {len(metas)} maps in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
