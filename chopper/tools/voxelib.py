"""
voxelib.py — voxel model building + sprite-sheet rendering for
TIGER — Operation Weißer Blitz.

Conventions
-----------
* Model space: x right, y up, z FORWARD (nose). Origin = ground point at the
  model's horizontal center. All builder helpers take VOXEL units (integers
  for box(), floats allowed for round shapes); Model.grid is indexed [x, y, z].
* World: meters, x east, z north, y up. Heading 0 = north, clockwise.
* Sprite sheets: columns = yaw frames (frame 0 = FRONT view, nose toward
  camera), rows = elevation bands top->bottom. Camera sits at +z looking
  toward -z; larger camera-space z = nearer. Anchor is always frame center.

Rendering is a fully vectorized numpy z-buffer splat: every surface voxel is
splat as a k x k pixel block, keys pack (depthQuantized << 24) | voxelIndex
and np.minimum.at keeps the nearest splat per pixel (unbuffered, correct
even with duplicate flat indices).
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
from PIL import Image

INT64_MAX = np.iinfo(np.int64).max
QMAX = (1 << 30) - 1          # depth quantization range
VOX_MASK = 0xFFFFFF           # voxel index lives in low 24 bits
LIGHT = np.array([-0.45, 0.75, 0.55], dtype=np.float64)
LIGHT /= np.linalg.norm(LIGHT)


# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
class Palette:
    """Indexed RGB palette. Index 0 is always empty."""

    def __init__(self):
        self.colors = [(0, 0, 0)]
        self.names = ["empty"]

    def __call__(self, name: str, rgb) -> int:
        self.colors.append(tuple(int(c) for c in rgb))
        self.names.append(name)
        return len(self.colors) - 1

    def array(self) -> np.ndarray:
        return np.array(self.colors, dtype=np.uint8)


def hexc(s: str):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


# --------------------------------------------------------------------------
# model
# --------------------------------------------------------------------------
class Model:
    def __init__(self, name: str, dims, voxel: float, palette: Palette, seed: int = 0):
        self.name = name
        self.dims = tuple(int(d) for d in dims)        # (nx, ny, nz)
        self.voxel = float(voxel)                      # meters per voxel
        self.palette = palette
        self.seed = int(seed)
        self.grid = np.zeros(self.dims, dtype=np.int16)
        # grid coord = model voxel coord + origin  (ground center at y=0)
        self.origin = np.array([self.dims[0] // 2, 0, self.dims[2] // 2], dtype=np.float64)
        self.extras = {}                               # extra JSON metadata

    # -- low-level ---------------------------------------------------------
    def _clip_slice(self, lo, hi, n):
        lo = max(0, int(math.floor(lo)))
        hi = min(n - 1, int(math.ceil(hi)))
        return lo, hi

    def _set_pts(self, pts, idx):
        """pts: (n,3) float voxel coords (model space)."""
        p = np.round(pts + self.origin).astype(np.int64)
        ok = ((p[:, 0] >= 0) & (p[:, 0] < self.dims[0]) &
              (p[:, 1] >= 0) & (p[:, 1] < self.dims[1]) &
              (p[:, 2] >= 0) & (p[:, 2] < self.dims[2]))
        p = p[ok]
        self.grid[p[:, 0], p[:, 1], p[:, 2]] = idx

    # -- primitives (voxel units, inclusive box coords) ---------------------
    def box(self, x0, y0, z0, x1, y1, z1, idx):
        ox, oy, oz = self.origin
        gx0, gx1 = self._clip_slice(x0 + ox, x1 + ox, self.dims[0])
        gy0, gy1 = self._clip_slice(y0 + oy, y1 + oy, self.dims[1])
        gz0, gz1 = self._clip_slice(z0 + oz, z1 + oz, self.dims[2])
        if gx1 >= gx0 and gy1 >= gy0 and gz1 >= gz0:
            self.grid[gx0:gx1 + 1, gy0:gy1 + 1, gz0:gz1 + 1] = idx

    def sphere(self, cx, cy, cz, r, idx):
        ox, oy, oz = self.origin
        x0, x1 = self._clip_slice(cx - r + ox, cx + r + ox, self.dims[0])
        y0, y1 = self._clip_slice(cy - r + oy, cy + r + oy, self.dims[1])
        z0, z1 = self._clip_slice(cz - r + oz, cz + r + oz, self.dims[2])
        if x1 < x0 or y1 < y0 or z1 < z0:
            return
        xs = np.arange(x0, x1 + 1) - ox - cx
        ys = np.arange(y0, y1 + 1) - oy - cy
        zs = np.arange(z0, z1 + 1) - oz - cz
        d2 = (xs[:, None, None] ** 2 + ys[None, :, None] ** 2 + zs[None, None, :] ** 2)
        sub = self.grid[x0:x1 + 1, y0:y1 + 1, z0:z1 + 1]
        sub[d2 <= r * r] = idx

    def cylinder(self, axis, center, r, length, idx):
        """axis: 'x'|'y'|'z'. center = (x,y,z) midpoint, length along axis."""
        cx, cy, cz = center
        n = max(1, int(round(length)))
        half = length / 2.0
        rr = int(math.ceil(r))
        ax = "xyz".index(axis)
        for i in range(n + 1):
            t = -half + length * i / n
            c = [cx, cy, cz]
            c[ax] = c[ax] + t
            self._disc_slice(c, ax, r, idx)

    def cone(self, axis, center, r0, r1, length, idx):
        """Tapered cylinder; r0 at -length/2 end, r1 at +length/2 end."""
        cx, cy, cz = center
        n = max(1, int(round(length)))
        half = length / 2.0
        ax = "xyz".index(axis)
        for i in range(n + 1):
            f = i / n
            t = -half + length * f
            c = [cx, cy, cz]
            c[ax] = c[ax] + t
            self._disc_slice(c, ax, r0 + (r1 - r0) * f, idx)

    def _disc_slice(self, c, ax, r, idx):
        """Filled circle of radius r in the plane perpendicular to axis ax."""
        ox, oy, oz = self.origin
        axes = [a for a in range(3) if a != ax]
        a0, a1 = axes
        ca, cb = c[a0], c[a1]
        lo0, hi0 = self._clip_slice(ca - r + self.origin[a0], ca + r + self.origin[a0], self.dims[a0])
        lo1, hi1 = self._clip_slice(cb - r + self.origin[a1], cb + r + self.origin[a1], self.dims[a1])
        if hi0 < lo0 or hi1 < lo1:
            return
        us = np.arange(lo0, hi0 + 1) - self.origin[a0] - ca
        vs = np.arange(lo1, hi1 + 1) - self.origin[a1] - cb
        mask = us[:, None] ** 2 + vs[None, :] ** 2 <= r * r
        gc = int(round(c[ax] + self.origin[ax]))
        if not (0 <= gc < self.dims[ax]):
            return
        sl = [slice(None)] * 3
        sl[ax] = gc
        sl[a0] = slice(lo0, hi0 + 1)
        sl[a1] = slice(lo1, hi1 + 1)
        sub = self.grid[tuple(sl)]
        sub[mask] = idx

    def capsule(self, p0, p1, r, idx):
        """Round-ended tube between two points (voxel units). Stamped spheres."""
        p0 = np.asarray(p0, dtype=np.float64)
        p1 = np.asarray(p1, dtype=np.float64)
        dist = float(np.linalg.norm(p1 - p0))
        steps = max(1, int(math.ceil(dist * 2.0)))
        for i in range(steps + 1):
            p = p0 + (p1 - p0) * (i / steps)
            self.sphere(p[0], p[1], p[2], r, idx)

    def disc(self, center, normal, radius, idx):
        """Thin filled disc (1 voxel thick) perpendicular to normal."""
        n = np.asarray(normal, dtype=np.float64)
        n = n / (np.linalg.norm(n) + 1e-12)
        tmp = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
        u = np.cross(n, tmp); u /= np.linalg.norm(u)
        v = np.cross(n, u)
        rr = int(math.ceil(radius))
        aa, bb = np.meshgrid(np.arange(-rr, rr + 1), np.arange(-rr, rr + 1), indexing="ij")
        keep = aa * aa + bb * bb <= radius * radius
        pts = (np.asarray(center)[None, None, :]
               + aa[..., None] * u + bb[..., None] * v)[keep]
        self._set_pts(pts, idx)

    # -- transforms / painting ----------------------------------------------
    def mirror_x(self, indices=None):
        """Union-mirror across x=0. Call BEFORE adding asymmetric markings.
        If indices given, only those palette indices are mirrored."""
        g = self.grid
        if indices is None:
            self.grid = np.maximum(g, g[::-1, :, :])
        else:
            mask = np.isin(g, list(indices))
            mir = mask[::-1, :, :]
            src = np.broadcast_to(g[::-1, :, :], g.shape)
            g[mir & ~mask] = src[mir & ~mask]

    def recenter_xz(self):
        """Shift grid so the solid AABB is horizontally centered (y stays on ground)."""
        solid = self.grid > 0
        if not solid.any():
            return
        xs = np.any(solid, axis=(1, 2))
        zs = np.any(solid, axis=(0, 1))
        x0, x1 = np.argmax(xs), len(xs) - 1 - np.argmax(xs[::-1])
        z0, z1 = np.argmax(zs), len(zs) - 1 - np.argmax(zs[::-1])
        cx = (x0 + x1) / 2.0 - self.origin[0]
        cz = (z0 + z1) / 2.0 - self.origin[2]
        dx, dz = -int(round(cx)), -int(round(cz))
        if dx == 0 and dz == 0:
            return
        ng = np.zeros_like(self.grid)
        nx, ny, nz = self.dims
        sx0, sx1 = max(0, -dx), min(nx, nx - dx)
        sz0, sz1 = max(0, -dz), min(nz, nz - dz)
        ng[sx0 + dx:sx1 + dx, :, sz0 + dz:sz1 + dz] = self.grid[sx0:sx1, :, sz0:sz1]
        self.grid = ng

    def recolor(self, indices, new_idx, ymin=None, ymax=None):
        """Recolor voxels of given palette indices (optionally within a y band,
        voxel units)."""
        mask = np.isin(self.grid, list(indices))
        if ymin is not None:
            mask &= (np.arange(self.dims[1])[None, :, None] >= ymin + self.origin[1])
        if ymax is not None:
            mask &= (np.arange(self.dims[1])[None, :, None] <= ymax + self.origin[1])
        self.grid[mask] = new_idx

    def camo(self, idx_from, idx_choices, scale=4.0, seed=None):
        """Deterministic patch noise: repaint voxels of idx_from with choices."""
        seed = self.seed if seed is None else seed
        coords = np.argwhere(self.grid == idx_from).astype(np.int64)
        if len(coords) == 0:
            return
        cell = np.floor(coords / scale).astype(np.int64)
        h = _hash3(cell[:, 0], cell[:, 1], cell[:, 2], seed)
        f = h.astype(np.float64) / 4294967295.0
        n = len(idx_choices)
        pick = np.clip((f * n).astype(int), 0, n - 1)
        # keep ~45% base color
        keep = f < 0.45
        pick = pick[~keep]
        cc = coords[~keep]
        for i, idx in enumerate(idx_choices):
            sel = pick == i
            self.grid[cc[sel, 0], cc[sel, 1], cc[sel, 2]] = idx

    def solid_count(self) -> int:
        return int(np.count_nonzero(self.grid))


def _hash3(x, y, z, seed):
    """Stable uint32 hash of integer coords + seed."""
    h = (x.astype(np.int64) * 73856093) ^ (y.astype(np.int64) * 19349663) \
        ^ (z.astype(np.int64) * 83492791) ^ (int(seed) * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFFFF).astype(np.uint32)


# --------------------------------------------------------------------------
# surface extraction
# --------------------------------------------------------------------------
def extract_surface(model: Model) -> dict:
    g = model.grid
    solid = g > 0
    pad = np.pad(solid, 1, mode="constant", constant_values=False)
    nx, ny, nz = g.shape
    nb = (pad[2:, 1:-1, 1:-1].astype(np.int8) + pad[:-2, 1:-1, 1:-1]
          + pad[1:-1, 2:, 1:-1] + pad[1:-1, :-2, 1:-1]
          + pad[1:-1, 1:-1, 2:] + pad[1:-1, 1:-1, :-2])
    surf = solid & (nb < 6)

    # exposed-normal sum (model space)
    nsum = np.zeros(g.shape + (3,), dtype=np.float32)
    nsum[..., 0] += solid & ~pad[2:, 1:-1, 1:-1]     # +x face
    nsum[..., 0] -= solid & ~pad[:-2, 1:-1, 1:-1]    # -x face
    nsum[..., 1] += solid & ~pad[1:-1, 2:, 1:-1]     # +y (top)
    nsum[..., 1] -= solid & ~pad[1:-1, :-2, 1:-1]
    nsum[..., 2] += solid & ~pad[1:-1, 1:-1, 2:]     # +z
    nsum[..., 2] -= solid & ~pad[1:-1, 1:-1, :-2]
    top_exposed = (solid & ~pad[1:-1, 2:, 1:-1])[surf]

    coords = np.argwhere(surf)                        # (n,3) grid coords
    nrm = nsum[surf].astype(np.float64)
    ln = np.linalg.norm(nrm, axis=1)
    bad = ln < 1e-9
    nrm[bad] = (0.0, 1.0, 0.0)
    ln[bad] = 1.0
    nrm /= ln[:, None]

    pos = (coords.astype(np.float64) - model.origin) * model.voxel
    base = model.palette.array()[g[surf]]
    h = _hash3(coords[:, 0], coords[:, 1], coords[:, 2], model.seed)
    jit = 1.0 + (h.astype(np.float64) / 4294967295.0 - 0.5) * 0.08   # +/-4%

    assert len(coords) < (1 << 24), "too many surface voxels for 24-bit key"
    return {
        "pos": pos.astype(np.float32),
        "nrm": nrm.astype(np.float32),
        "base": base,
        "top": top_exposed,
        "nb": nb[surf].astype(np.float32),
        "jit": jit.astype(np.float32),
        "coords": coords,
    }


# --------------------------------------------------------------------------
# rotation matrices
# --------------------------------------------------------------------------
def rot_y(theta_deg):
    t = math.radians(theta_deg)
    c, s = math.cos(t), math.sin(t)
    # clockwise viewed from above (heading convention): nose +z -> +x at 90
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def rot_x(phi_deg):
    p = math.radians(phi_deg)
    c, s = math.cos(p), math.sin(p)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


# --------------------------------------------------------------------------
# sprite sheet rendering
# --------------------------------------------------------------------------
def render_sheet(model: Model, cols: int, elevations, frameW: int, frameH: int,
                 ppm: float, out_png: str, auto_fit: bool = True):
    """Render cols yaw frames x len(elevations) elevation rows to a PNG sheet.

    Returns (meta dict, stats dict). Frame 0 / yaw 0 is the FRONT view.
    auto_fit expands the frame (multiples of 16) if the model would clip.
    """
    surf = extract_surface(model)
    pos, nrm, base = surf["pos"], surf["nrm"], surf["base"]
    top, nb, jit = surf["top"], surf["nb"], surf["jit"]
    n = len(pos)
    elevations = list(elevations)
    rows = len(elevations)
    yaw_step = 360.0 / cols

    k = max(2, int(math.ceil(ppm * model.voxel * 1.4)))
    off = np.arange(k) - k // 2
    dy, dx = np.meshgrid(off, off, indexing="ij")
    dy = dy.ravel(); dx = dx.ravel()
    k2 = k * k

    # ---- fit pass: required frame size over all views ---------------------
    need_w, need_h = float(frameW), float(frameH)
    views = [(r, c) for r in range(rows) for c in range(cols)]
    max_use_w = max_use_h = 0.0
    for r, c in views:
        R = rot_x(elevations[r]) @ rot_y(c * yaw_step)
        pc = pos.astype(np.float64) @ R.T
        ex = float(np.max(np.abs(pc[:, 0]))) * ppm + k
        ey = float(np.max(np.abs(pc[:, 1]))) * ppm + k
        max_use_w = max(max_use_w, ex)
        max_use_h = max(max_use_h, ey)
        need_w = max(need_w, 2 * ex)
        need_h = max(need_h, 2 * ey)
    if auto_fit:
        frameW = int(max(frameW, math.ceil(need_w / 16) * 16))
        frameH = int(max(frameH, math.ceil(need_h / 16) * 16))
    expanded = (frameW, frameH)
    cx, cy = frameW / 2.0, frameH / 2.0

    sheet = np.zeros((rows * frameH, cols * frameW, 4), dtype=np.uint8)
    idx_all = np.arange(n, dtype=np.int64)
    depth_span_log = []

    for r, phi in enumerate(elevations):
        Rx = rot_x(phi)
        for c in range(cols):
            R = Rx @ rot_y(c * yaw_step)
            pc = pos.astype(np.float64) @ R.T
            sx = np.round(cx + pc[:, 0] * ppm).astype(np.int64)
            sy = np.round(cy - pc[:, 1] * ppm).astype(np.int64)
            depth = pc[:, 2]

            # per-view shaded color LUT
            nc = nrm.astype(np.float64) @ R.T
            shade = 0.42 + 0.58 * np.clip(nc @ LIGHT, 0.0, None)
            shade += 0.05 * top
            ao = 1.0 - 0.05 * np.clip(nb - 3.0, 0.0, None)
            fac = np.clip(shade * ao * jit, 0.0, 1.6)
            lut = np.empty((n, 4), dtype=np.uint8)
            lut[:, :3] = np.clip(base.astype(np.float32) * fac[:, None], 0, 255).astype(np.uint8)
            lut[:, 3] = 255

            # depth keys: nearer (larger depth) -> SMALLER key
            dmin, dmax = float(depth.min()), float(depth.max())
            span = max(dmax - dmin, 1e-6)
            q = ((depth - dmin) / span * QMAX).astype(np.int64)
            keys = ((QMAX - q) << 24) | idx_all

            # splat flat indices (n, k2)
            flat = ((sy[:, None] + dy[None, :]) * frameW
                    + (sx[:, None] + dx[None, :]))
            yy = sy[:, None] + dy[None, :]
            xx = sx[:, None] + dx[None, :]
            valid = (xx >= 0) & (xx < frameW) & (yy >= 0) & (yy < frameH)
            kk = np.broadcast_to(keys[:, None], (n, k2))
            buf = np.full(frameW * frameH, INT64_MAX, dtype=np.int64)
            np.minimum.at(buf, flat[valid], kk[valid])

            hit = buf < INT64_MAX
            frame = np.zeros((frameH * frameW, 4), dtype=np.uint8)
            frame[hit] = lut[buf[hit] & VOX_MASK]
            frame = frame.reshape(frameH, frameW, 4)
            sheet[r * frameH:(r + 1) * frameH, c * frameW:(c + 1) * frameW] = frame

    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(out_png)

    coords = surf["coords"]
    world_h = float((coords[:, 1].max() + 1) * model.voxel)
    radius = float(np.max(np.hypot(pos[:, 0], pos[:, 2])))
    meta = {
        "name": model.name,
        "sheet": os.path.basename(out_png),
        "frameW": frameW,
        "frameH": frameH,
        "cols": cols,
        "rows": rows,
        "yawStep": yaw_step,
        "elevations": elevations,
        "pxPerMeter": ppm,
        "anchorX": frameW / 2.0,
        "anchorY": frameH / 2.0,
        "worldH": round(world_h, 3),
        "radius": round(radius, 3),
        "voxel": model.voxel,
    }
    meta.update(model.extras)
    stats = {
        "solid": model.solid_count(),
        "surface": n,
        "sheet_px": (cols * frameW, rows * frameH),
        "expanded": expanded != (frameW, frameH),
        "fit_use": (round(max_use_w, 1), round(max_use_h, 1)),
    }
    return meta, stats


def save_meta(meta: dict, out_json: str):
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    with open(out_json, "w") as f:
        json.dump(meta, f, indent=1)


def frame_nontransparent(sheet_path: str, meta: dict, col: int, row: int) -> int:
    im = np.array(Image.open(sheet_path))
    fw, fh = meta["frameW"], meta["frameH"]
    fr = im[row * fh:(row + 1) * fh, col * fw:(col + 1) * fw]
    return int(np.count_nonzero(fr[..., 3] > 0))
