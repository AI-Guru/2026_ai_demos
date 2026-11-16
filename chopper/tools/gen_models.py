#!/usr/bin/env python3
"""
gen_models.py — build all voxel models for TIGER — Operation Weißer Blitz,
render multi-angle sprite sheets + JSON metadata into assets/models/,
write the model contact sheet and assets/manifest.json.

Run:  python3 tools/gen_models.py
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voxelib as vx
from voxelib import Palette, Model, hexc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models")
CONFIG = os.path.join(ROOT, "tools", "terrain_config.json")

VEH_ELEV = [5, 20, 40, 65]
STRUCT_ELEV = [5, 20, 40, 65]
LOW_ELEV = [10, 35, 65]
NATURE_ELEV = [15, 50]


class B:
    """Meter-based wrapper around a Model (helpers take voxel units)."""

    def __init__(self, model: Model):
        self.m = model
        self.v = model.voxel

    def box(self, x0, y0, z0, x1, y1, z1, i):
        v = self.v
        self.m.box(round(x0 / v), round(y0 / v), round(z0 / v),
                   round(x1 / v), round(y1 / v), round(z1 / v), i)

    def sphere(self, cx, cy, cz, r, i):
        v = self.v
        self.m.sphere(cx / v, cy / v, cz / v, r / v, i)

    def cyl(self, axis, center, r, length, i):
        v = self.v
        self.m.cylinder(axis, tuple(c / v for c in center), r / v, length / v, i)

    def cone(self, axis, center, r0, r1, length, i):
        v = self.v
        self.m.cone(axis, tuple(c / v for c in center), r0 / v, r1 / v, length / v, i)

    def cap(self, p0, p1, r, i):
        v = self.v
        self.m.capsule(np.array(p0) / v, np.array(p1) / v, r / v, i)

    def disc(self, center, normal, radius, i):
        v = self.v
        self.m.disc(np.array(center) / v, normal, radius / v, i)


def cross_x(b: B, x, yc, zc, arm, thick, black, white):
    """Balkenkreuz in the y-z plane at fixed x (fuselage side), meters."""
    for idx, a, t in ((white, arm + 0.12, thick + 0.24), (black, arm, thick)):
        b.box(x - 0.02, yc - a, zc - t / 2, x + 0.02, yc + a, zc + t / 2, idx)
        b.box(x - 0.02, yc - t / 2, zc - a, x + 0.02, yc + t / 2, zc + a, idx)


def cross_x_vox(m: Model, xv, yv, zv, arm, bar, black, white):
    """Balkenkreuz in exact voxel units (y-z plane at grid-side x).
    arm = half-length, bar = half-thickness of the black cross."""
    for idx, a, t in ((white, arm + 1, bar + 1), (black, arm, bar)):
        m.box(xv, yv - a, zv - t, xv, yv + a, zv + t, idx)
        m.box(xv, yv - t, zv - a, xv, yv + t, zv + a, idx)


def star_x(b: B, x, yc, zc, r, idx):
    """Small red star in y-z plane at fixed x."""
    t = 0.06
    b.box(x - 0.02, yc - r, zc - t, x + 0.02, yc + r, zc + t, idx)
    b.box(x - 0.02, yc - t, zc - r, x + 0.02, yc + t, zc + r, idx)
    for sy, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        b.box(x - 0.02, yc + sy * r * 0.45 - t, zc + sz * r * 0.45 - t,
              x + 0.02, yc + sy * r * 0.45 + t, zc + sz * r * 0.45 + t, idx)


# ==========================================================================
# VEHICLES
# ==========================================================================
def build_tiger():
    p = Palette()
    OLIVE = p("olive", hexc("5d6141"))
    BROWN = p("brown", hexc("6b5a3e"))
    DGREEN = p("dgreen", hexc("3f4a33"))
    GRAY = p("belly", hexc("7a7d78"))
    GLASS = p("glass", hexc("2a3440"))
    FRAME = p("frame", hexc("4a5560"))
    DARK = p("dark", hexc("26282a"))
    METAL = p("metal", hexc("3a3d40"))
    CAN = p("canister", hexc("6a6d55"))
    POD = p("pod", hexc("3f4a33"))
    TIRE = p("tire", hexc("1e1e1e"))
    WHITE = p("white", (235, 235, 235))
    BLACK = p("black", (18, 18, 18))
    RED = p("red", hexc("bb2222"))
    GOLD = p("gold", hexc("ddaa22"))

    m = Model("tiger", (40, 30, 80), 0.2, p, seed=11)
    b = B(m)
    # --- faceted nose + sensor turret ---
    b.box(-0.45, 0.95, 5.6, 0.45, 1.85, 6.6, OLIVE)
    b.box(-0.32, 1.00, 6.6, 0.32, 1.70, 7.1, OLIVE)
    b.sphere(0, 1.25, 7.15, 0.42, DARK)
    b.sphere(0, 1.28, 7.45, 0.17, GLASS)
    # --- forward fuselage + stepped tandem cockpit ---
    b.box(-0.60, 0.85, 3.4, 0.60, 2.00, 5.6, OLIVE)
    b.box(-0.42, 1.75, 3.9, 0.42, 2.30, 5.3, GLASS)
    b.box(-0.46, 1.70, 3.85, 0.46, 1.80, 5.35, FRAME)
    b.box(-0.60, 0.90, 1.5, 0.60, 2.35, 3.4, OLIVE)
    b.box(-0.42, 2.05, 1.8, 0.42, 2.70, 3.2, GLASS)
    b.box(-0.46, 2.00, 1.75, 0.46, 2.10, 3.25, FRAME)
    # --- mid fuselage ---
    b.box(-0.70, 0.85, -1.6, 0.70, 2.30, 1.5, OLIVE)
    # --- engine housings atop rear fuselage, sideways exhausts ---
    for s in (-1, 1):
        b.box(s * 0.45, 2.30, -2.9, s * 1.05, 3.05, 0.4, OLIVE)
        b.box(s * 0.50, 2.45, 0.40, s * 1.00, 2.90, 0.55, DARK)      # intake
        b.box(s * 1.05, 2.45, -2.6, s * 1.16, 2.85, -1.7, METAL)     # exhaust
    # --- rotor mast + hub (NO main blades) + mast-mounted sight (UHT) ---
    b.cap((0, 3.00, 0.1), (0, 3.95, 0.1), 0.16, METAL)
    b.cyl("y", (0, 3.85, 0.1), 0.30, 0.18, DARK)
    b.cyl("y", (0, 4.05, 0.1), 0.45, 0.25, DARK)
    b.cap((0, 4.15, 0.1), (0, 4.40, 0.1), 0.10, METAL)
    b.box(-0.28, 4.35, -0.15, 0.28, 5.05, 0.55, OLIVE)               # Osiris sight
    b.box(-0.20, 4.50, 0.55, 0.20, 4.90, 0.63, GLASS)
    b.cap((0.20, 5.05, 0.0), (0.20, 5.45, 0.0), 0.03, DARK)          # antenna
    # --- tapering tail boom ---
    b.box(-0.40, 1.25, -3.6, 0.40, 2.05, -1.6, OLIVE)
    b.box(-0.30, 1.35, -5.4, 0.30, 1.95, -3.6, OLIVE)
    b.box(-0.20, 1.50, -6.7, 0.20, 1.90, -5.4, OLIVE)
    # --- swept vertical fin ---
    b.box(-0.12, 1.90, -6.9, 0.12, 3.00, -6.15, OLIVE)
    b.box(-0.12, 3.00, -7.0, 0.12, 3.85, -6.4, OLIVE)
    # --- tail rotor LEFT side ---
    b.cap((-0.15, 3.20, -6.6), (-0.45, 3.20, -6.6), 0.12, METAL)
    b.box(-0.55, 2.40, -6.66, -0.48, 4.00, -6.54, DARK)
    b.box(-0.55, 3.14, -7.40, -0.48, 3.26, -5.80, DARK)
    # --- horizontal stabilizer RIGHT ---
    b.box(0.15, 2.05, -6.7, 1.70, 2.20, -5.9, OLIVE)
    b.box(1.65, 1.95, -6.65, 1.75, 2.35, -5.95, OLIVE)
    # --- stub wings (4.6 m span) ---
    b.box(-2.30, 1.45, -0.1, 2.30, 1.70, 1.1, OLIVE)
    # --- wingtip 2x2 PARS 3 LR canister blocks ---
    for s in (-1, 1):
        for ox in (2.38, 2.72):
            for oy in (1.22, 1.58):
                b.box(s * ox, oy, -0.2, s * (ox + 0.30), oy + 0.30, 1.6, CAN)
                b.box(s * ox, oy + 0.04, 1.6, s * (ox + 0.30), oy + 0.26, 1.68, DARK)
        # inboard 19-tube 70mm rocket pod
        b.cyl("z", (s * 1.5, 1.05, 0.7), 0.30, 1.7, POD)
        b.cyl("z", (s * 1.5, 1.05, 1.58), 0.30, 0.10, DARK)
    # --- gun pod under RIGHT wing root ---
    b.box(0.75, 0.80, 0.5, 1.05, 1.15, 1.7, METAL)
    b.cap((0.90, 0.95, 1.7), (0.90, 0.95, 2.5), 0.06, METAL)
    # --- wheeled tricycle gear ---
    b.box(-0.06, 0.30, 5.0, 0.06, 0.90, 5.2, METAL)
    b.cyl("x", (0, 0.28, 5.1), 0.28, 0.16, TIRE)
    for s in (-1, 1):
        b.box(s * 0.60, 0.35, -1.9, s * 0.72, 0.95, -1.7, METAL)
        b.cyl("x", (s * 0.78, 0.32, -1.8), 0.32, 0.20, TIRE)
    # --- camo + belly ---
    m.camo(OLIVE, [BROWN, DGREEN], scale=5)
    m.recolor([OLIVE, BROWN, DGREEN], GRAY, ymax=0.95 / m.voxel)
    # --- Balkenkreuz fuselage sides + tail boom, flag on fin ---
    for s in (-1, 1):
        cross_x_vox(m, s * 4, 8, -2, 2, 1, BLACK, WHITE)      # fuselage ~1 m
        cross_x_vox(m, s * 2, 8, -22, 1, 0, BLACK, WHITE)     # tail boom
        b.box(s * 0.14, 3.30, -6.95, s * 0.18, 3.48, -6.55, BLACK)
        b.box(s * 0.14, 3.48, -6.95, s * 0.18, 3.66, -6.55, RED)
        b.box(s * 0.14, 3.66, -6.95, s * 0.18, 3.84, -6.55, GOLD)
    m.extras = {
        "rotorHub": {"x": 0.0, "y": 4.05, "z": 0.1, "radius": 6.5},
        "tailRotor": {"x": -0.5, "y": 3.2, "z": -6.6, "radius": 0.8},
        "overallLength": 15.8,
    }
    return m


def build_mi28():
    p = Palette()
    BASE = p("base", hexc("4a4f45"))
    DARKP = p("darkpatch", hexc("3a3f36"))
    LIGHTP = p("lightpatch", hexc("565b4e"))
    GLASS = p("glass", hexc("22282e"))
    FRAME = p("frame", hexc("3d434a"))
    METAL = p("metal", hexc("33363a"))
    DARK = p("dark", hexc("232527"))
    POD = p("pod", hexc("3c4238"))
    TIRE = p("tire", hexc("1c1c1c"))
    RED = p("red", hexc("cc2222"))

    m = Model("mi28", (44, 26, 88), 0.2, p, seed=28)
    b = B(m)
    # nose + chin 30mm turret
    b.box(-0.50, 0.80, 6.0, 0.50, 1.70, 7.6, BASE)
    b.sphere(0, 1.20, 7.6, 0.45, BASE)
    b.sphere(0, 0.65, 7.2, 0.40, METAL)
    b.cap((0, 0.60, 7.5), (0, 0.55, 8.1), 0.07, METAL)
    # tandem cockpit
    b.box(-0.65, 0.80, 3.9, 0.65, 1.90, 6.0, BASE)
    b.box(-0.45, 1.50, 4.2, 0.45, 2.15, 5.9, GLASS)
    b.box(-0.49, 1.45, 4.15, 0.49, 1.55, 5.95, FRAME)
    b.box(-0.65, 0.90, 2.0, 0.65, 2.30, 3.9, BASE)
    b.box(-0.45, 1.95, 2.3, 0.45, 2.60, 3.7, GLASS)
    b.box(-0.49, 1.90, 2.25, 0.49, 2.00, 3.75, FRAME)
    # mid fuselage + engines
    b.box(-0.80, 0.85, -1.2, 0.80, 2.40, 2.0, BASE)
    for s in (-1, 1):
        b.box(s * 0.55, 2.40, -2.6, s * 1.15, 3.15, 0.3, BASE)
        b.box(s * 1.15, 2.55, -2.3, s * 1.26, 2.95, -1.4, DARK)
    # rotor mast + hub (no blades)
    b.cap((0, 3.15, 0.2), (0, 3.70, 0.2), 0.18, METAL)
    b.cyl("y", (0, 3.80, 0.2), 0.50, 0.25, DARK)
    # stub wings: pods inboard, ATGM rails at tips
    b.box(-2.60, 1.35, 0.0, 2.60, 1.65, 1.3, BASE)
    for s in (-1, 1):
        b.cyl("z", (s * 1.6, 0.95, 0.65), 0.32, 1.8, POD)
        b.cyl("z", (s * 1.6, 0.95, 1.58), 0.32, 0.10, DARK)
        b.box(s * 2.60, 1.30, -0.1, s * 2.95, 1.62, 1.5, METAL)
        for oy in (1.18, 1.50):
            b.cap((s * 2.78, oy, -0.15), (s * 2.78, oy, 1.65), 0.11, POD)
    # tail boom + swept fin
    b.box(-0.40, 1.40, -3.4, 0.40, 2.10, -1.2, BASE)
    b.box(-0.30, 1.50, -5.6, 0.30, 2.00, -3.4, BASE)
    b.box(-0.20, 1.60, -7.2, 0.20, 1.95, -5.6, BASE)
    b.box(-0.12, 1.95, -7.3, 0.12, 2.90, -6.4, BASE)
    b.box(-0.12, 2.90, -7.25, 0.12, 3.45, -6.65, BASE)
    # tail rotor RIGHT
    b.cap((0.15, 3.10, -6.8), (0.45, 3.10, -6.8), 0.12, METAL)
    b.box(0.48, 2.40, -6.86, 0.55, 3.80, -6.74, DARK)
    b.box(0.48, 3.04, -7.35, 0.55, 3.16, -6.25, DARK)
    # stabilizer
    b.box(-1.30, 1.90, -6.6, 1.30, 2.05, -5.9, BASE)
    # fixed tricycle gear
    b.box(-0.06, 0.30, 5.7, 0.06, 0.85, 5.9, METAL)
    b.cyl("x", (0, 0.30, 5.8), 0.30, 0.18, TIRE)
    for s in (-1, 1):
        b.box(s * 0.80, 0.35, -1.7, s * 0.92, 0.95, -1.5, METAL)
        b.cyl("x", (s * 0.95, 0.35, -1.6), 0.35, 0.22, TIRE)
    m.camo(BASE, [DARKP, LIGHTP], scale=5)
    for s in (-1, 1):
        star_x(b, s * 0.34, 1.78, -4.5, 0.28, RED)
    m.extras = {
        "rotorHub": {"x": 0.0, "y": 3.8, "z": 0.2, "radius": 8.5},
        "tailRotor": {"x": 0.5, "y": 3.1, "z": -6.8, "radius": 0.7},
        "overallLength": 17.0,
    }
    return m


def build_tank():
    p = Palette()
    OLIVE = p("olive", hexc("4f5a3a"))
    TRACK = p("track", hexc("2a2a28"))
    WHEEL = p("wheel", hexc("3a3f30"))
    ERA = p("era", hexc("5d6847"))
    GUN = p("gun", hexc("3c4232"))
    METAL = p("metal", hexc("383a36"))
    DRUM = p("drum", hexc("4a5238"))

    m = Model("tank", (24, 18, 62), 0.2, p, seed=80)
    b = B(m)
    # hull + sloped glacis
    b.box(-1.55, 0.55, -3.9, 1.55, 1.50, 3.3, OLIVE)
    b.box(-1.55, 1.10, 3.3, 1.55, 1.50, 3.7, OLIVE)
    b.box(-1.55, 0.80, 3.7, 1.55, 1.10, 4.1, OLIVE)
    b.box(-1.55, 0.55, 4.1, 1.55, 0.80, 4.5, OLIVE)
    # tracks + wheels
    for s in (-1, 1):
        b.box(s * 1.35, 0.05, -3.9, s * 1.75, 1.05, 4.1, TRACK)
        b.cyl("x", (s * 1.55, 0.55, -3.85), 0.50, 0.40, TRACK)
        b.cyl("x", (s * 1.55, 0.55, 4.05), 0.48, 0.40, TRACK)
        for z in (-2.7, -1.7, -0.7, 0.3, 1.3, 2.3):
            b.cyl("x", (s * 1.56, 0.50, z), 0.42, 0.36, WHEEL)
        b.cyl("x", (s * 1.56, 0.60, -3.5), 0.40, 0.38, WHEEL)   # drive sprocket
        b.box(s * 1.78, 0.75, -3.6, s * 1.84, 1.15, 3.7, OLIVE)  # side skirt
    # rounded-ish turret
    b.box(-1.10, 1.50, -2.0, 1.10, 2.00, 1.0, OLIVE)
    b.box(-0.95, 2.00, -1.8, 0.95, 2.35, 0.8, OLIVE)
    b.box(-0.70, 2.35, -1.5, 0.70, 2.50, 0.5, OLIVE)
    for s in (-1, 1):
        b.box(s * 0.80, 1.50, 0.6, s * 1.15, 2.00, 1.2, OLIVE)
    # Kontakt-1 ERA bricks: turret front + glacis
    for x in np.arange(-0.85, 0.9, 0.34):
        for y in np.arange(1.58, 2.3, 0.26):
            b.box(x, y, 1.0, x + 0.28, y + 0.18, 1.16, ERA)
    for x in np.arange(-1.3, 1.35, 0.36):
        b.box(x, 1.18, 3.72, x + 0.30, 1.40, 3.90, ERA)
    # 125mm gun + fume extractor + muzzle reference
    b.cap((0, 1.95, 1.0), (0, 1.95, 5.9), 0.09, GUN)
    b.cap((0, 1.95, 3.3), (0, 1.95, 3.9), 0.14, GUN)
    b.box(-0.05, 2.05, 5.75, 0.05, 2.18, 5.95, METAL)
    # IR searchlight
    b.cyl("z", (0.65, 2.10, 1.15), 0.18, 0.25, METAL)
    # cupola + AA MG
    b.cyl("y", (-0.5, 2.60, -0.8), 0.35, 0.25, OLIVE)
    b.cap((-0.5, 2.85, -0.8), (-0.5, 3.00, -0.2), 0.04, METAL)
    # rear fuel drums
    for s in (-1, 1):
        b.cyl("x", (s * 0.85, 1.35, -4.3), 0.30, 0.9, DRUM)
    m.recenter_xz()
    return m


def build_gepard():
    p = Palette()
    OLIVE = p("olive", hexc("4f5a3a"))
    TRACK = p("track", hexc("2a2a28"))
    WHEEL = p("wheel", hexc("3a3f30"))
    GUN = p("gun", hexc("3c4232"))
    METAL = p("metal", hexc("383a36"))
    RADARF = p("radarface", hexc("3a3f45"))
    RADAR = p("radar", hexc("6a6f75"))
    RADAR2 = p("radar2", hexc("565b61"))

    m = Model("gepard", (24, 24, 58), 0.2, p, seed=35)
    b = B(m)
    # Leopard-1-like hull
    b.box(-1.60, 0.60, -3.8, 1.60, 1.60, 3.6, OLIVE)
    b.box(-1.60, 1.00, 3.6, 1.60, 1.60, 4.0, OLIVE)
    b.box(-1.60, 0.60, 4.0, 1.60, 1.00, 4.3, OLIVE)
    for s in (-1, 1):
        b.box(s * 1.35, 0.05, -3.8, s * 1.72, 1.00, 4.0, TRACK)
        for z in np.arange(-3.0, 3.1, 1.0):
            b.cyl("x", (s * 1.55, 0.48, z), 0.40, 0.34, WHEEL)
        b.box(s * 1.74, 0.70, -3.5, s * 1.80, 1.10, 3.7, OLIVE)
    # turret
    b.box(-1.20, 1.60, -1.4, 1.20, 2.60, 1.2, OLIVE)
    b.box(-1.00, 2.60, -1.2, 1.00, 2.80, 1.0, OLIVE)
    # flat tracking-radar panel on turret front
    b.box(-0.70, 2.00, 1.25, 0.70, 2.75, 1.45, RADARF)
    b.box(-0.75, 1.95, 1.22, 0.75, 2.80, 1.30, METAL)
    # twin 35mm cannons elevated ~15 deg
    for s in (-1, 1):
        b.cap((s * 0.35, 2.25, 1.2), (s * 0.35, 3.15, 4.6), 0.07, GUN)
        b.cap((s * 0.35, 3.10, 4.4), (s * 0.35, 3.20, 4.75), 0.10, METAL)
    # folding search-radar dish (rectangular panel array) on turret rear
    b.box(-0.90, 2.90, -2.3, 0.90, 3.70, -2.05, RADAR)
    for x in np.arange(-0.8, 0.85, 0.24):
        b.box(x, 2.95, -2.32, x + 0.10, 3.65, -2.03, RADAR2)
    b.cap((0, 2.80, -1.4), (0, 3.10, -2.1), 0.08, METAL)
    m.recenter_xz()
    return m


def build_osa():
    p = Palette()
    OLIVE = p("olive", hexc("4a5538"))
    DARK = p("dark", hexc("2c2e2a"))
    TIRE = p("tire", hexc("1e1e1e"))
    CAN = p("canister", hexc("566044"))
    RADARF = p("radarface", hexc("3a3f45"))
    RADAR = p("radar", hexc("6a6f75"))
    GLASS = p("glass", hexc("2a3440"))
    METAL = p("metal", hexc("3a3d40"))

    m = Model("osa", (20, 26, 48), 0.25, p, seed=8)
    b = B(m)
    # 6x6 chassis
    b.box(-0.90, 0.55, -4.3, 0.90, 0.95, 4.3, DARK)
    for z in (3.3, -1.7, -3.0):
        for s in (-1, 1):
            b.cyl("x", (s * 1.15, 0.55, z), 0.55, 0.35, TIRE)
    # cab-over front
    b.box(-1.20, 1.00, 2.5, 1.20, 2.60, 4.3, OLIVE)
    b.box(-1.00, 1.90, 4.30, 1.00, 2.45, 4.38, GLASS)
    b.box(-1.20, 0.70, 4.3, 1.20, 1.00, 4.45, DARK)
    # launcher turntable + 4 canisters elevated ~30 deg
    b.cyl("y", (0, 1.10, -1.8), 1.00, 0.30, METAL)
    for s in (-1, 1):
        for oy in (1.45, 2.05):
            b.cap((s * 0.55, oy, -3.3), (s * 0.55, oy + 1.7, -0.3), 0.28, CAN)
            b.disc((s * 0.55, oy + 1.7, -0.3), (0, 0.5, 0.87), 0.28, DARK)
    # front radar dish (parabolic approx), face dark
    n = np.array([0.0, 0.42, 0.91])
    c = np.array([0.0, 2.9, 0.9])
    for i in range(9):
        s = i / 8.0 * 0.8
        r = 1.35 * np.sqrt(max(0.02, 1.0 - s / 0.8))
        b.disc(c + n * s, n, r, RADARF if i >= 2 else RADAR)
    b.cap(c + n * 0.2, c + n * 1.5, 0.06, METAL)
    b.sphere(*(c + n * 1.5), 0.12, RADARF)
    b.cap((0, 1.0, 0.9), (0, 2.6, 0.9), 0.12, METAL)
    return m


def build_bmp():
    p = Palette()
    OLIVE = p("olive", hexc("4f5a3a"))
    TRACK = p("track", hexc("2a2a28"))
    WHEEL = p("wheel", hexc("3a3f30"))
    GUN = p("gun", hexc("3c4232"))
    METAL = p("metal", hexc("383a36"))

    m = Model("bmp", (20, 16, 40), 0.2, p, seed=2)
    b = B(m)
    b.box(-1.40, 0.50, -3.2, 1.40, 1.45, 3.0, OLIVE)
    b.box(-1.40, 0.90, 3.0, 1.40, 1.45, 3.2, OLIVE)
    b.box(-1.40, 0.50, 3.2, 1.40, 0.90, 3.35, OLIVE)
    for s in (-1, 1):
        b.box(s * 1.15, 0.05, -3.3, s * 1.50, 0.85, 3.3, TRACK)
        for z in np.arange(-2.5, 2.6, 1.0):
            b.cyl("x", (s * 1.35, 0.42, z), 0.32, 0.30, WHEEL)
    # small turret + 30mm + ATGM rail
    b.cone("y", (0, 1.75, 0.1), 0.75, 0.50, 0.6, OLIVE)
    b.box(-0.45, 2.05, -0.3, 0.45, 2.15, 0.5, OLIVE)
    b.cap((0, 1.95, 0.6), (0, 2.15, 2.6), 0.05, GUN)
    b.box(-0.15, 2.15, 0.0, 0.15, 2.30, 1.0, METAL)
    return m


def build_truck():
    p = Palette()
    OLIVE = p("olive", hexc("4a5538"))
    CANVAS = p("canvas", hexc("5a5f45"))
    CANVASD = p("canvasd", hexc("4a4f3a"))
    DARK = p("dark", hexc("2c2e2a"))
    TIRE = p("tire", hexc("1e1e1e"))
    GLASS = p("glass", hexc("2a3440"))
    WOOD = p("wood", hexc("5a4a35"))

    m = Model("truck", (18, 20, 46), 0.2, p, seed=4320)
    b = B(m)
    b.box(-0.80, 0.60, -4.2, 0.80, 0.95, 4.0, DARK)
    # hood + cab
    b.box(-1.00, 1.00, 3.0, 1.00, 1.85, 4.2, OLIVE)
    b.box(-1.20, 1.00, 1.4, 1.20, 2.70, 3.0, OLIVE)
    b.box(-1.00, 1.90, 3.00, 1.00, 2.50, 3.06, GLASS)
    b.box(-1.20, 0.70, 4.2, 1.20, 1.00, 4.35, DARK)
    # canvas-covered cargo bed
    b.box(-1.30, 1.05, -4.2, 1.30, 1.30, 1.4, WOOD)
    b.box(-1.30, 1.30, -4.2, 1.30, 2.60, 1.4, CANVAS)
    b.box(-1.10, 2.60, -4.2, 1.10, 2.90, 1.4, CANVAS)
    b.box(-0.80, 2.90, -4.2, 0.80, 3.05, 1.4, CANVAS)
    for z in np.arange(-3.9, 1.3, 1.2):
        b.box(-1.32, 1.30, z, 1.32, 2.90, z + 0.08, CANVASD)
    b.box(-1.30, 1.30, -4.25, 1.30, 2.60, -4.2, CANVASD)
    # 6 wheels
    for z in (3.1, -1.9, -3.1):
        for s in (-1, 1):
            b.cyl("x", (s * 1.15, 0.55, z), 0.55, 0.35, TIRE)
    return m


# ==========================================================================
# STRUCTURES
# ==========================================================================
def build_bunker():
    p = Palette()
    CONC = p("concrete", hexc("8a8a82"))
    CONCD = p("concreted", hexc("74746c"))
    STEEL = p("steel", hexc("3a3d40"))
    TAN = p("sandbag", hexc("a89468"))
    NETG = p("netgreen", hexc("4a5a38"))
    NETB = p("netbrown", hexc("6b5a3e"))

    m = Model("bunker", (28, 22, 42), 0.4, p, seed=14)
    b = B(m)
    b.box(-4.5, 0, -7, 4.5, 4.0, 7, CONC)
    b.box(-4.8, 4.0, -7.3, 4.8, 4.6, 7.3, CONCD)
    b.box(-1.0, 0, 7.0, 1.0, 2.4, 7.25, STEEL)          # steel door
    b.box(-1.2, 2.4, 7.0, 1.2, 2.7, 7.25, CONCD)
    for s in (-1, 1):
        b.cyl("y", (s * 3.0, 5.1, -5.0), 0.30, 1.2, STEEL)  # vent pipes
        b.cyl("y", (s * 3.0, 5.75, -5.0), 0.42, 0.15, STEEL)
    # sandbag ring (front arc)
    for x in np.arange(-4.0, 4.1, 1.1):
        b.sphere(x, 0.4, 7.9, 0.55, TAN)
    for x in np.arange(-3.5, 3.6, 1.1):
        b.sphere(x, 0.95, 7.7, 0.5, TAN)
    # antenna mast
    b.cap((3.5, 4.6, -6.0), (3.5, 7.4, -6.0), 0.08, STEEL)
    b.box(3.1, 6.8, -6.05, 3.9, 6.9, -5.95, STEEL)
    b.box(3.2, 6.2, -6.05, 3.8, 6.3, -5.95, STEEL)
    # camo netting draped on roof
    b.box(-4.8, 4.6, -2.0, -1.0, 4.95, 3.0, NETG)
    b.box(1.0, 4.6, -5.0, 4.8, 4.85, 0.0, NETB)
    b.box(-4.9, 3.2, 2.0, -4.7, 4.6, 5.0, NETG)
    return m


def build_fueldepot():
    p = Palette()
    SILVER = p("silver", hexc("9aa0a4"))
    SILVD = p("silverd", hexc("7c8286"))
    CONC = p("concrete", hexc("8a8a82"))
    TAN = p("berm", hexc("a08a60"))
    STEEL = p("steel", hexc("4a4d50"))
    PUMP = p("pump", hexc("5a6248"))
    YEL = p("yellow", hexc("d8b020"))
    BLK = p("black", hexc("222222"))

    m = Model("fueldepot", (56, 16, 36), 0.4, p, seed=20)
    b = B(m)
    # earthen berm
    b.box(-10, 0, 5.4, 10, 1.4, 6.0, TAN)
    b.box(-10, 0, -6.0, 10, 1.4, -5.4, TAN)
    b.box(-10, 0, -6, -9.4, 1.4, 6, TAN)
    b.box(9.4, 0, -6, 10, 1.4, 6, TAN)
    # three horizontal tanks on cradles
    for z in (-3.2, 0.0, 3.2):
        b.cyl("x", (0, 1.75, z), 1.4, 8.0, SILVER)
        b.sphere(-4.0, 1.75, z, 1.4, SILVD)
        b.sphere(4.0, 1.75, z, 1.4, SILVD)
        for x in (-2.6, 2.6):
            b.box(x - 0.4, 0, z - 1.0, x + 0.4, 1.0, z + 1.0, CONC)
        # warning stripes on ends
        for i, yy in enumerate((1.2, 1.7, 2.2)):
            b.box(4.9, yy, z - 0.5, 5.05, yy + 0.25, z + 0.5, YEL if i % 2 == 0 else BLK)
    # connecting pipes + pumps
    b.cap((-4.6, 0.7, -3.2), (-4.6, 0.7, 3.2), 0.12, STEEL)
    for z in (-3.2, 0.0, 3.2):
        b.cap((-4.6, 0.7, z), (-4.0, 1.2, z), 0.10, STEEL)
    b.box(6.4, 0, 4.0, 7.4, 1.4, 5.0, PUMP)
    b.box(6.4, 1.4, 4.0, 7.4, 1.6, 5.0, YEL)
    b.box(7.8, 0, 4.0, 8.6, 1.1, 4.8, PUMP)
    return m


def build_radar():
    p = Palette()
    STEELG = p("steelgray", hexc("6a6f75"))
    STEELD = p("steeld", hexc("4a4f55"))
    RADARF = p("radarface", hexc("3a3f45"))
    RADAR = p("radarback", hexc("8a8f95"))
    OLIVEG = p("shed", hexc("5a6248"))
    DARK = p("dark", hexc("2c2e2a"))

    m = Model("radar", (18, 42, 18), 0.35, p, seed=3200)
    b = B(m)
    # lattice tower ~8 m
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.box(sx * 0.8 - 0.08, 0, sz * 0.8 - 0.08, sx * 0.8 + 0.08, 8.0, sz * 0.8 + 0.08, STEELG)
    for y in (2.0, 4.0, 6.0, 8.0):
        b.box(-0.8, y, -0.85, 0.8, y + 0.12, -0.73, STEELD)
        b.box(-0.8, y, 0.73, 0.8, y + 0.12, 0.85, STEELD)
        b.box(-0.85, y, -0.8, -0.73, y + 0.12, 0.8, STEELD)
        b.box(0.73, y, -0.8, 0.85, y + 0.12, 0.8, STEELD)
    for i, y in enumerate((0.0, 2.0, 4.0, 6.0)):
        s = 1 if i % 2 == 0 else -1
        b.cap((-0.8 * s, y, -0.8), (0.8 * s, y + 2.0, -0.8), 0.05, STEELD)
        b.cap((-0.8 * s, y, 0.8), (0.8 * s, y + 2.0, 0.8), 0.05, STEELD)
        b.cap((-0.8, y, -0.8 * s), (-0.8, y + 2.0, 0.8 * s), 0.05, STEELD)
        b.cap((0.8, y, -0.8 * s), (0.8, y + 2.0, 0.8 * s), 0.05, STEELD)
    b.box(-1.2, 8.0, -1.2, 1.2, 8.4, 1.2, STEELG)
    # parabolic dish ~6 m, tilted up 25 deg
    n = np.array([0.0, np.sin(np.radians(25)), np.cos(np.radians(25))])
    c = np.array([0.0, 9.8, 0.2])
    for i in range(10):
        s = i / 9.0 * 0.9
        r = 3.0 * np.sqrt(max(0.02, 1.0 - s / 0.9))
        b.disc(c + n * s, n, r, RADARF if i >= 3 else RADAR)
    b.cap(c + n * 0.3, c + n * 1.9, 0.07, STEELD)
    b.sphere(*(c + n * 1.9), 0.14, RADARF)
    b.cap((0, 8.4, 0.2), (0, 9.5, 0.2), 0.14, STEELG)
    # equipment shed at base
    b.box(1.4, 0, -1.0, 2.7, 2.0, 1.0, OLIVEG)
    b.box(1.35, 2.0, -1.1, 2.8, 2.25, 1.1, STEELD)
    b.box(2.7, 0.3, -0.3, 2.75, 1.5, 0.3, DARK)
    return m


def build_church():
    p = Palette()
    CREAM = p("cream", hexc("e8e0d0"))
    ROOF = p("roof", hexc("8a4a3a"))
    SPIRE = p("spire", hexc("6a6f75"))
    DARK = p("window", hexc("2a2e34"))
    WHITE = p("clock", (240, 240, 235))
    BLK = p("hands", (20, 20, 20))
    WOOD = p("door", hexc("4a3a28"))

    m = Model("church", (24, 52, 32), 0.35, p, seed=1515)
    b = B(m)
    # nave
    b.box(-2.5, 0, -4.0, 2.5, 4.5, 3.5, CREAM)
    for i in range(9):
        half = 2.6 * (1 - i / 9.0) + 0.15
        y = 4.5 + i * 0.30
        b.box(-half, y, -4.2, half, y + 0.33, 3.7, ROOF)
    # square tower + clock + pointed spire (~17 m total)
    b.box(-1.5, 0, 3.5, 1.5, 12.0, 6.3, CREAM)
    b.cyl("z", (0, 9.5, 6.32), 0.70, 0.10, WHITE)
    b.box(-0.05, 9.5, 6.42, 0.05, 9.95, 6.46, BLK)
    b.box(-0.05, 9.45, 6.42, 0.35, 9.55, 6.46, BLK)
    b.box(-1.6, 11.8, 3.4, 1.6, 12.2, 6.4, SPIRE)
    for i in range(10):
        half = 1.5 * (1 - i / 10.0) + 0.05
        y = 12.2 + i * 0.48
        b.box(-half, y, 4.9 - half, half, y + 0.5, 4.9 + half, SPIRE)
    # arched windows + door
    for s in (-1, 1):
        for z in (-2.5, -0.5, 1.5):
            b.box(s * 2.5, 1.3, z, s * 2.62, 2.7, z + 0.55, DARK)
            b.sphere(s * 2.56, 2.7, z + 0.27, 0.28, DARK)
    b.box(-0.6, 0, 6.3, 0.6, 2.2, 6.42, WOOD)
    b.sphere(0, 2.2, 6.36, 0.6, WOOD)
    b.box(-0.5, 6.5, 6.3, 0.5, 8.0, 6.42, DARK)
    return m


def build_house():
    p = Palette()
    CREAM = p("cream", hexc("e8e0d0"))
    ROOFB = p("roof", hexc("8a4a3a"))
    BEAM = p("timber", hexc("4a3a28"))
    DARK = p("window", hexc("2a2e34"))
    WOOD = p("door", hexc("5a4a35"))
    BRICK = p("chimney", hexc("8a5a4a"))

    m = Model("house", (32, 30, 40), 0.3, p, seed=10)
    b = B(m)
    b.box(-4.0, 0, -5.0, 4.0, 4.0, 5.0, CREAM)
    for i in range(11):
        half = 4.2 * (1 - i / 11.0) + 0.15
        y = 4.0 + i * 0.32
        b.box(-half, y, -5.2, half, y + 0.35, 5.2, ROOFB)
    # timber-frame accents
    for x in (-4.0, -2.0, 0.0, 2.0, 4.0):
        for s in (-1, 1):
            b.box(x - 0.10, 0, s * 5.0, x + 0.10, 4.0, s * 5.08, BEAM)
    for s in (-1, 1):
        b.box(-4.0, 2.0, s * 5.0, 4.0, 2.15, s * 5.08, BEAM)
        b.box(-4.0, 0.0, s * 5.0, 4.0, 0.15, s * 5.08, BEAM)
    for x in (-3.0, -1.0, 1.0, 3.0):
        b.box(x - 0.08, 2.15, 5.0, x + 0.08, 3.9, 5.08, BEAM)
    # windows + door
    for x in (-2.6, 2.6):
        b.box(x - 0.5, 1.2, 5.02, x + 0.5, 2.4, 5.12, DARK)
        b.box(x - 0.5, 2.6, 5.02, x + 0.5, 3.5, 5.12, DARK)
    b.box(-0.55, 0, 5.02, 0.55, 2.1, 5.12, WOOD)
    for s in (-1, 1):
        for z in (-3.0, 0.0, 3.0):
            b.box(s * 4.0, 1.3, z - 0.5, s * 4.08, 2.5, z + 0.5, DARK)
    b.box(2.0, 6.4, -2.0, 2.6, 8.2, -1.4, BRICK)
    return m


def build_watertower():
    p = Palette()
    BRICK = p("brick", hexc("8a5a4a"))
    BRICKD = p("brickd", hexc("744a3c"))
    ROOFD = p("roof", hexc("3a3d40"))
    DARK = p("window", hexc("2a2e34"))
    STEEL = p("ladder", hexc("4a4d50"))

    m = Model("watertower", (18, 42, 18), 0.35, p, seed=14)
    b = B(m)
    b.cyl("y", (0, 5.0, 0), 2.2, 10.0, BRICK)
    b.cyl("y", (0, 9.2, 0), 2.5, 2.2, BRICKD)          # tank band
    b.cone("y", (0, 11.5, 0), 2.6, 0.15, 2.2, ROOFD)
    b.cap((0, 12.6, 0), (0, 13.1, 0), 0.06, STEEL)
    for y in (3.0, 6.0, 9.0):
        b.box(2.15, y, -0.25, 2.3, y + 0.7, 0.25, DARK)
    # ladder
    b.box(2.25, 0, 0.6, 2.35, 10.5, 0.7, STEEL)
    b.box(2.25, 0, 1.0, 2.35, 10.5, 1.1, STEEL)
    for y in np.arange(0.4, 10.4, 0.7):
        b.box(2.25, y, 0.6, 2.35, y + 0.08, 1.1, STEEL)
    return m


def build_bridge():
    p = Palette()
    STEEL = p("steel", hexc("6a6f75"))
    STEELD = p("steeld", hexc("565b61"))
    CONC = p("concrete", hexc("8a8a82"))
    DECK = p("deck", hexc("3a3d40"))
    LINE = p("line", hexc("8a8a70"))

    m = Model("bridge", (28, 20, 106), 0.4, p, seed=40)
    b = B(m)
    # road deck (top ~0.5 m so vehicles on the causeway align)
    b.box(-4.5, 0, -20, 4.5, 0.5, 20, DECK)
    b.box(-0.15, 0.5, -19, 0.15, 0.56, 19, LINE)
    for s in (-1, 1):
        b.box(s * 4.3, 0.5, -20, s * 4.5, 0.9, 20, CONC)
    # truss X-pattern sides
    for s in (-1, 1):
        x0, x1 = s * 4.2, s * 4.5
        b.box(x0, 5.6, -20, x1, 6.0, 20, STEEL)          # top chord
        for z in np.arange(-20, 20.1, 4.0):
            b.box(x0, 0.5, z, x1, 6.0, z + 0.35, STEEL)  # verticals
        for z in np.arange(-20, 16.1, 4.0):
            b.cap((s * 4.35, 0.6, z), (s * 4.35, 5.6, z + 4.0), 0.12, STEELD)
            b.cap((s * 4.35, 5.6, z), (s * 4.35, 0.6, z + 4.0), 0.12, STEELD)
    # concrete piers at ends
    for s in (-1, 1):
        b.box(-4.8, 0, s * 19.0, 4.8, 1.2, s * 20.8, CONC)
    return m


def build_tent():
    p = Palette()
    CANVAS = p("canvas", hexc("5a5f45"))
    CANVASD = p("canvasd", hexc("4a4f3a"))
    DARK = p("entrance", hexc("26282a"))
    POLE = p("pole", hexc("3a3d40"))

    m = Model("tent", (20, 14, 26), 0.3, p, seed=7)
    b = B(m)
    b.box(-2.5, 0, -3.5, 2.5, 1.2, 3.5, CANVAS)
    for i in range(7):
        half = 2.5 * (1 - i / 7.0) + 0.08
        y = 1.2 + i * 0.29
        b.box(-half, y, -3.5, half, y + 0.31, 3.5, CANVAS)
    b.box(-0.06, 3.15, -3.6, 0.06, 3.30, 3.6, POLE)
    b.box(-0.7, 0, 3.5, 0.7, 1.8, 3.56, DARK)
    b.box(-1.1, 0, 3.5, -0.7, 1.5, 3.56, CANVASD)
    b.box(0.7, 0, 3.5, 1.1, 1.5, 3.56, CANVASD)
    return m


def build_farp():
    p = Palette()
    PAD = p("pad", hexc("7a7a72"))
    PADD = p("padd", hexc("6a6a62"))
    YEL = p("yellow", hexc("d8b020"))
    OLIVE = p("drum", hexc("4a5538"))
    RED = p("drumred", hexc("8a3a2a"))
    CANVAS = p("canvas", hexc("5a5f45"))
    STEEL = p("steel", hexc("4a4d50"))
    ORANGE = p("windsock", hexc("e06820"))
    LIGHT = p("light", hexc("d8d8c0"))

    m = Model("farp", (66, 18, 66), 0.4, p, seed=24)
    b = B(m)
    b.box(-12, 0, -12, 12, 0.4, 12, PAD)
    b.box(-12, 0.4, -12, 12, 0.48, -11.6, PADD)
    b.box(-12, 0.4, 11.6, 12, 0.48, 12, PADD)
    b.box(-12, 0.4, -12, -11.6, 0.48, 12, PADD)
    b.box(11.6, 0.4, -12, 12, 0.48, 12, PADD)
    # big yellow H
    b.box(-2.6, 0.4, -3.0, -1.4, 0.52, 3.0, YEL)
    b.box(1.4, 0.4, -3.0, 2.6, 0.52, 3.0, YEL)
    b.box(-2.6, 0.4, -0.6, 2.6, 0.52, 0.6, YEL)
    # fuel drums cluster
    for i, (dx, dz) in enumerate([(-9.5, -9.5), (-8.3, -9.5), (-9.5, -8.3),
                                  (-8.3, -8.3), (-8.9, -7.2), (-7.2, -8.9)]):
        b.cyl("y", (dx, 0.6, dz), 0.5, 1.2, OLIVE if i % 3 else RED)
    # small tent
    b.box(6.8, 0.4, -9.2, 9.8, 1.4, -6.8, CANVAS)
    for i in range(4):
        half = 1.5 * (1 - i / 4.0) + 0.05
        b.box(8.3 - half, 1.4 + i * 0.25, -9.2, 8.3 + half, 1.65 + i * 0.25, -6.8, CANVAS)
    # windsock pole
    b.cap((10, 0.4, 10), (10, 5.0, 10), 0.06, STEEL)
    b.cone("x", (10.8, 4.8, 10), 0.30, 0.12, 1.2, ORANGE)
    # floodlight mast
    b.cap((-10, 0.4, 10), (-10, 6.0, 10), 0.08, STEEL)
    b.box(-10.4, 5.8, 9.7, -9.6, 6.2, 10.3, LIGHT)
    return m


# ==========================================================================
# NATURE
# ==========================================================================
def build_tree_spruce():
    p = Palette()
    BROWN = p("trunk", hexc("5a4632"))
    G0 = p("g0", hexc("2a4a26"))
    G1 = p("g1", hexc("244222"))
    G2 = p("g2", hexc("31542c"))
    G3 = p("g3", hexc("28461f"))
    G4 = p("g4", hexc("2f4f28"))

    m = Model("tree_spruce", (20, 44, 20), 0.35, p, seed=5)
    b = B(m)
    b.cyl("y", (0, 1.5, 0), 0.25, 3.0, BROWN)
    greens = [G0, G1, G2, G3, G4]
    for i in range(5):
        base = 2.2 + i * 2.3
        r0 = 2.7 - i * 0.5
        b.cone("y", (0, base + 1.6, 0), r0, 0.10, 3.2, greens[i])
    return m


def build_tree_oak():
    p = Palette()
    BROWN = p("trunk", hexc("5a4632"))
    G0 = p("g0", hexc("3f6a30"))
    G1 = p("g1", hexc("366028"))
    G2 = p("g2", hexc("47743a"))
    G3 = p("g3", hexc("3a6430"))

    m = Model("tree_oak", (24, 32, 24), 0.35, p, seed=6)
    b = B(m)
    b.cap((0, 0, 0), (0, 3.8, 0), 0.35, BROWN)
    b.cap((0, 3.0, 0), (1.3, 5.2, 0.7), 0.18, BROWN)
    b.cap((0, 3.2, 0), (-1.2, 5.4, -0.6), 0.18, BROWN)
    b.sphere(0, 6.5, 0, 2.6, G0)
    b.sphere(1.5, 5.8, 0.8, 1.9, G1)
    b.sphere(-1.4, 6.0, -0.7, 2.0, G2)
    b.sphere(0.3, 7.8, -0.5, 1.7, G3)
    return m


def build_bush():
    p = Palette()
    G0 = p("g0", hexc("4a6a38"))
    G1 = p("g1", hexc("5a5a68"))   # purple-tinted heath
    G2 = p("g2", hexc("3f5a30"))

    m = Model("bush", (10, 8, 10), 0.3, p, seed=7)
    b = B(m)
    b.sphere(0, 0.8, 0, 0.9, G0)
    b.sphere(0.5, 0.6, 0.3, 0.6, G1)
    b.sphere(-0.4, 0.7, -0.3, 0.55, G2)
    return m


def build_rock():
    p = Palette()
    R0 = p("r0", hexc("7a7268"))
    R1 = p("r1", hexc("6a645c"))
    R2 = p("r2", hexc("8a8278"))

    m = Model("rock", (12, 8, 12), 0.4, p, seed=8)
    b = B(m)
    b.sphere(0, 0.9, 0, 1.3, R0)
    b.sphere(0.9, 0.6, 0.5, 0.8, R1)
    b.sphere(-0.8, 0.5, -0.4, 0.7, R2)
    return m


# ==========================================================================
# registry: (builder, cols, elevations, frameW, frameH, ppm)
# ==========================================================================
MODELS = [
    (build_tiger,      32, VEH_ELEV,    128, 128, 7.5),
    (build_mi28,       32, VEH_ELEV,    128, 128, 7.5),
    (build_tank,       32, VEH_ELEV,    128, 128, 10),
    (build_gepard,     32, VEH_ELEV,    128, 128, 10),
    (build_osa,        32, VEH_ELEV,    128, 128, 9),
    (build_bmp,        32, VEH_ELEV,    112, 112, 10),
    (build_truck,      32, VEH_ELEV,    112, 112, 10),
    (build_bunker,     16, STRUCT_ELEV, 160, 128, 5),
    (build_fueldepot,  16, STRUCT_ELEV, 192, 144, 5),
    (build_radar,      16, STRUCT_ELEV, 128, 144, 6),
    (build_church,     16, STRUCT_ELEV, 128, 160, 6),
    (build_house,      16, STRUCT_ELEV, 128, 112, 7),
    (build_watertower, 16, STRUCT_ELEV,  96, 144, 6),
    (build_bridge,     16, LOW_ELEV,    192, 112, 5),
    (build_tent,       16, LOW_ELEV,     96,  80, 7),
    (build_farp,       16, LOW_ELEV,    192, 128, 5),
    (build_tree_spruce, 8, [10, 35, 65],  80, 112, 7),
    (build_tree_oak,    8, [10, 35, 65],  96,  96, 7),
    (build_bush,        8, NATURE_ELEV,   64,  48, 7),
    (build_rock,        8, NATURE_ELEV,   80,  64, 7),
]


def make_contact_sheet(entries, path):
    """Labeled grid: frame (col=3, row=1) of every model, upscaled 2x."""
    cell_w = max(m["frameW"] for m, _ in entries) * 2
    cell_h = max(m["frameH"] for m, _ in entries) * 2 + 22
    ncol = 5
    nrow = (len(entries) + ncol - 1) // ncol
    sheet = Image.new("RGBA", (ncol * cell_w, nrow * cell_h), (24, 26, 30, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (meta, stats) in enumerate(entries):
        im = Image.open(os.path.join(OUT, meta["sheet"]))
        fw, fh = meta["frameW"], meta["frameH"]
        fr = im.crop((3 * fw, 1 * fh, 4 * fw, 2 * fh))
        fr = fr.resize((fw * 2, fh * 2), Image.NEAREST)
        cx = (i % ncol) * cell_w
        cy = (i // ncol) * cell_h
        sheet.paste(fr, (cx + (cell_w - fw * 2) // 2, cy + 4), fr)
        label = f"{meta['name']}  ({stats['solid']} vox)"
        draw.text((cx + 6, cy + cell_h - 18), label, fill=(220, 220, 210, 255))
    sheet.save(path)


def write_manifest(model_names):
    with open(CONFIG) as f:
        cfg = json.load(f)
    manifest = {
        "terrain": [
            {
                "id": mp["id"],
                "name": mp["name"],
                "height": f"terrain/m{mp['id']}_height.bin",
                "color": f"terrain/m{mp['id']}_color.bin",
                "map": f"terrain/m{mp['id']}_map.png",
                "meta": f"terrain/m{mp['id']}_meta.json",
            } for mp in cfg["maps"]
        ],
        "models": {name: f"models/{name}.json" for name in model_names},
    }
    with open(os.path.join(ROOT, "assets", "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    entries = []
    print(f"{'model':<14} {'solid':>7} {'surface':>8} {'sheet':>12} {'frame':>9}  file")
    for builder, cols, elev, fw, fh, ppm in MODELS:
        model = builder()
        png = os.path.join(OUT, model.name + ".png")
        meta, stats = vx.render_sheet(model, cols, elev, fw, fh, ppm, png)
        vx.save_meta(meta, os.path.join(OUT, model.name + ".json"))
        entries.append((meta, stats))
        size_kb = os.path.getsize(png) / 1024
        exp = "" if (meta["frameW"], meta["frameH"]) == (fw, fh) else \
              f"  [fit: {fw}x{fh} -> {meta['frameW']}x{meta['frameH']}]"
        print(f"{model.name:<14} {stats['solid']:>7} {stats['surface']:>8} "
              f"{stats['sheet_px'][0]:>5}x{stats['sheet_px'][1]:<5} "
              f"{meta['frameW']:>4}x{meta['frameH']:<4} {size_kb:>7.1f}K{exp}")

    # ---- sanity checks ----------------------------------------------------
    tiger_meta = next(m for m, _ in entries if m["name"] == "tiger")
    n = vx.frame_nontransparent(os.path.join(OUT, "tiger.png"), tiger_meta, 0, 0)
    assert n > 500, f"tiger front frame too empty: {n}"
    print(f"\ntiger frame(0,0) non-transparent pixels: {n} (>500 OK)")
    for meta, _ in entries:
        assert meta["anchorX"] == meta["frameW"] / 2
        assert meta["anchorY"] == meta["frameH"] / 2
    print("all model anchors centered: OK")

    make_contact_sheet(entries, os.path.join(OUT, "_contact.png"))
    write_manifest([m["name"] for m, _ in entries])
    print(f"contact sheet: assets/models/_contact.png")
    print(f"manifest:      assets/manifest.json")
    print(f"TOTAL: {len(entries)} models in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
