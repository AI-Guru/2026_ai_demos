/** Canvas HUD: Comanche-style phosphor symbology, tapes, warnings, target boxes,
 *  cockpit frame. Drawn in a virtual 1280×720 space, scaled to the display. */

const GREEN = 'rgba(141,255,158,';
const AMBER = 'rgba(255,179,71,';
const RED = 'rgba(255,90,74,';
const DIM = 'rgba(141,255,158,0.45)';
const DEG = Math.PI / 180;

export function drawHUD(ctx, W, H, s) {
  const sc = H / 720;
  const ox = (W - 1280 * sc) / 2;
  ctx.save();
  ctx.translate(ox, 0);
  ctx.scale(sc, sc);
  ctx.lineWidth = 1.4;
  ctx.textBaseline = 'middle';

  const f = s.flight;
  const t = s.time;
  const blink = (t * 2) % 1 < 0.55;
  const fastBlink = (t * 4) % 1 < 0.5;

  if (s.view === 'cockpit') drawCockpit(ctx, t, s);

  // ---- pitch ladder + reticle ----
  const cx = 640, cy = 340;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-f.roll * 0.85);
  ctx.strokeStyle = GREEN + '0.5)';
  const pitchPx = f.pitch / DEG * 9;
  for (const p of [-10, -5, 5, 10]) {
    const y = pitchPx + p * 9;
    if (Math.abs(y) > 150) continue;
    ctx.beginPath();
    const w = p % 10 === 0 ? 70 : 44;
    ctx.moveTo(-w, y); ctx.lineTo(-18, y);
    ctx.moveTo(18, y); ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = DIM;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.abs(p)), w + 4, y);
  }
  ctx.restore();

  // gun reticle
  ctx.strokeStyle = GREEN + '0.9)';
  ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 38, cy); ctx.lineTo(cx - 24, cy);
  ctx.moveTo(cx + 24, cy); ctx.lineTo(cx + 38, cy);
  ctx.moveTo(cx, cy - 38); ctx.lineTo(cx, cy - 24);
  ctx.moveTo(cx, cy + 24); ctx.lineTo(cx, cy + 32);
  ctx.stroke();
  ctx.fillStyle = GREEN + '0.9)';
  ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);

  // PARS seeker
  const lock = s.weapons.lock;
  if (lock.progress > 0.02 && s.weapons.selected === 2) {
    ctx.strokeStyle = lock.locked ? AMBER + '0.95)' : GREEN + '0.7)';
    ctx.save();
    ctx.translate(cx, cy);
    if (!lock.locked) ctx.rotate(t * 1.6);
    ctx.setLineDash(lock.locked ? [] : [10, 8]);
    ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (!lock.locked) {
      ctx.beginPath();
      ctx.arc(0, 0, 66, -Math.PI / 2, -Math.PI / 2 + lock.progress * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = lock.locked ? AMBER + '1)' : GREEN + '0.8)';
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(lock.locked ? 'PARS 3 · LOCK' : 'SEEKING…', cx, cy + 84);
  }

  // ---- speed tape (left) ----
  tape(ctx, 150, 340, f.kmh, 20, 80, 'km/h', true);
  // ---- altitude tape (right) ----
  tape(ctx, 1130, 340, f.y, 20, 80, 'm', false);
  ctx.fillStyle = DIM;
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('AGL ' + Math.max(0, f.agl).toFixed(0), 1130, 470);

  // ---- heading tape (bottom) ----
  headingTape(ctx, 640, 622, f.heading / DEG);

  // ---- weapons panel ----
  const wp = s.weapons;
  const names = ['KANONE 30 mm', 'RAKETEN 70 mm', 'PARS 3 LR'];
  const ammos = [wp.ammo.gun, wp.ammo.rockets, wp.ammo.pars];
  ctx.textAlign = 'left';
  for (let i = 0; i < 3; i++) {
    const y = 560 + i * 26;
    const sel = wp.selected === i;
    ctx.fillStyle = sel ? AMBER + '1)' : ammos[i] > 0 ? GREEN + '0.75)' : RED + '0.6)';
    ctx.font = (sel ? 'bold ' : '') + '14px ui-monospace, Menlo, monospace';
    ctx.fillText(`[${i + 1}] ${names[i]}`, 42, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(ammos[i]), 268, y);
    ctx.textAlign = 'left';
    if (sel) {
      ctx.strokeStyle = AMBER + '0.9)';
      ctx.strokeRect(34, y - 12, 244, 24);
    }
  }
  ctx.fillStyle = GREEN + '0.7)';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.fillText('FLARES [F]  ' + wp.ammo.flares, 42, 646);

  // ---- status panel ----
  ctx.textAlign = 'right';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  bar(ctx, 1040, 566, 'TREIBSTOFF', f.fuel, f.fuel < 0.2 ? RED : GREEN);
  bar(ctx, 1040, 592, 'SCHADEN', 1 - f.hp, f.hp < 0.35 ? RED : f.hp < 0.7 ? AMBER : GREEN);
  ctx.fillStyle = GREEN + '0.8)';
  ctx.fillText('FALKE 1-1', 1238, 628);
  const mm = String((t / 60) | 0).padStart(2, '0');
  const ss = String((t % 60) | 0).padStart(2, '0');
  ctx.fillText(`T+${mm}:${ss}`, 1238, 648);

  // ---- objectives ----
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
  ctx.fillStyle = AMBER + '0.9)';
  ctx.fillText(s.missionTitle, 42, 40);
  ctx.font = '12px ui-monospace, Menlo, monospace';
  let oy = 62;
  for (const o of s.objectives) {
    const done = o.done >= o.required;
    ctx.fillStyle = done ? GREEN + '0.85)' : o.primary ? AMBER + '0.85)' : DIM;
    const mark = done ? '✓' : o.primary ? '◆' : '○';
    ctx.fillText(`${mark} ${o.short} ${Math.min(o.done, o.required)}/${o.required}`, 42, oy);
    oy += 19;
  }

  // ---- warnings ----
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px ui-monospace, Menlo, monospace';
  let wy = 96;
  if (s.missileInbound && fastBlink) { ctx.fillStyle = RED + '1)'; ctx.fillText('⚠ MISSILE INBOUND ⚠', 640, wy); wy += 26; }
  if (s.samLock > 0.12 && blink) { ctx.fillStyle = AMBER + '1)'; ctx.fillText('RADAR LOCK', 640, wy); wy += 26; }
  if (f.agl < 35 && f.vy < -6 && fastBlink) { ctx.fillStyle = RED + '1)'; ctx.fillText('PULL UP', 640, wy); wy += 26; }
  if (f.fuel < 0.2 && blink) { ctx.fillStyle = AMBER + '0.9)'; ctx.font = 'bold 14px ui-monospace, Menlo, monospace'; ctx.fillText('TREIBSTOFF NIEDRIG', 640, wy); wy += 22; }
  if (f.landed) {
    ctx.fillStyle = GREEN + '0.9)';
    ctx.font = 'bold 14px ui-monospace, Menlo, monospace';
    ctx.fillText(s.atFarp ? 'FARP · REFUEL / REARM / REPAIR' : 'LANDED · SHIFT TO LIFT OFF', 640, 520);
  }

  // ---- target boxes ----
  // Diamond on every tracked contact; text only for the lock and the nearest
  // on-screen primary, and never two labels close together (convoy declutter).
  // tb.p arrives in display space; HUD draws in virtual 1280x720 space.
  let nearest = null;
  for (const tb of s.targetBoxes) {
    if (!tb.p || !tb.primary) continue;
    const vx = (tb.p.x - ox) / sc, vy = tb.p.y / sc;
    if (vx < 10 || vx > 1120 || vy < 10 || vy > 710) continue;
    if (!nearest || tb.dist < nearest.dist) nearest = tb;
  }
  const placed = [];
  for (const tb of s.targetBoxes) {
    if (!tb.p) continue;
    const p = { x: (tb.p.x - ox) / sc, y: tb.p.y / sc };
    ctx.strokeStyle = tb.locked ? AMBER + '0.95)' : tb.primary ? RED + '0.8)' : GREEN + '0.55)';
    const r = tb.locked ? 20 : 12;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    const wantLabel = tb.locked || tb === nearest;
    const crowded = placed.some((q) => Math.abs(q.x - p.x) < 110 && Math.abs(q.y - p.y) < 26);
    if (!wantLabel || crowded) continue;
    placed.push(p);
    const lx = Math.min(p.x + r + 8, 1120);
    ctx.fillStyle = tb.locked ? AMBER + '0.95)' : GREEN + '0.75)';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${tb.name} · ${tb.dist.toFixed(0)} m`, lx, p.y - 6);
    if (tb.hp < 1) {
      ctx.fillStyle = RED + '0.8)';
      ctx.fillRect(lx, p.y + 2, 46 * tb.hp, 3);
    }
  }

  ctx.restore();
}

function tape(ctx, x, cy, value, step, range, unit, left) {
  ctx.strokeStyle = GREEN + '0.6)';
  ctx.beginPath();
  ctx.moveTo(x, cy - 110); ctx.lineTo(x, cy + 110);
  ctx.stroke();
  ctx.font = '11px ui-monospace, Menlo, monospace';
  const base = Math.round(value / step) * step;
  for (let v = base - range; v <= base + range; v += step) {
    const y = cy + (value - v) * (110 / range);
    if (y < cy - 108 || y > cy + 108) continue;
    const major = v % (step * 2) === 0;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + (left ? 8 : -8) * (major ? 1 : 0.6), y);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = DIM;
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillText(String(Math.round(v)), x + (left ? -12 : 12), y);
    }
  }
  // current value box
  ctx.fillStyle = 'rgba(8,14,8,0.75)';
  ctx.strokeStyle = GREEN + '0.95)';
  const bw = 74;
  const bx = left ? x - bw - 4 : x + 4;
  ctx.fillRect(bx, cy - 14, bw, 28);
  ctx.strokeRect(bx, cy - 14, bw, 28);
  ctx.fillStyle = GREEN + '1)';
  ctx.font = 'bold 17px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(value), bx + bw / 2, cy);
  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = DIM;
  ctx.fillText(unit, bx + bw / 2, cy + 24);
}

function headingTape(ctx, cx, y, hdg) {
  ctx.strokeStyle = GREEN + '0.6)';
  ctx.beginPath(); ctx.moveTo(cx - 160, y); ctx.lineTo(cx + 160, y); ctx.stroke();
  ctx.font = '11px ui-monospace, Menlo, monospace';
  const card = { 0: 'N', 90: 'O', 180: 'S', 270: 'W' };
  const base = Math.round(hdg / 10) * 10;
  for (let d = base - 50; d <= base + 50; d += 10) {
    const x = cx + (d - hdg) * 3.2;
    if (Math.abs(x - cx) > 158) continue;
    const dd = ((d % 360) + 360) % 360;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - (dd % 30 === 0 ? 10 : 5)); ctx.stroke();
    if (dd % 30 === 0) {
      ctx.fillStyle = card[dd] ? GREEN + '0.95)' : DIM;
      ctx.textAlign = 'center';
      ctx.fillText(card[dd] ?? String(dd / 10).padStart(2, '0'), x, y + 12);
    }
  }
  ctx.fillStyle = 'rgba(8,14,8,0.75)';
  ctx.strokeStyle = GREEN + '0.95)';
  ctx.fillRect(cx - 30, y - 34, 60, 22);
  ctx.strokeRect(cx - 30, y - 34, 60, 22);
  ctx.fillStyle = GREEN + '1)';
  ctx.font = 'bold 14px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0'), cx, y - 23);
}

function bar(ctx, xRight, y, label, v, color) {
  ctx.fillStyle = DIM;
  ctx.textAlign = 'right';
  ctx.fillText(label, xRight - 130, y);
  ctx.strokeStyle = GREEN + '0.5)';
  ctx.strokeRect(xRight - 120, y - 7, 120, 14);
  ctx.fillStyle = color + '0.85)';
  ctx.fillRect(xRight - 118, y - 5, 116 * Math.max(0, Math.min(1, v)), 10);
}

function drawCockpit(ctx, t, s) {
  // glass tint
  const g = ctx.createLinearGradient(0, 0, 0, 720);
  g.addColorStop(0, 'rgba(120,160,140,0.10)');
  g.addColorStop(0.5, 'rgba(120,160,140,0.02)');
  g.addColorStop(1, 'rgba(20,30,20,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);
  // coaming
  ctx.fillStyle = 'rgba(14,17,12,0.96)';
  ctx.beginPath();
  ctx.moveTo(0, 720);
  ctx.lineTo(0, 640);
  ctx.bezierCurveTo(300, 585, 980, 585, 1280, 640);
  ctx.lineTo(1280, 720);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,84,60,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 640);
  ctx.bezierCurveTo(300, 585, 980, 585, 1280, 640);
  ctx.stroke();
  // instrument silhouettes on coaming: four live MFD pages
  const f = s.flight, wp = s.weapons;
  ctx.textAlign = 'left';
  ctx.font = '8px ui-monospace, Menlo, monospace';
  const bezel = (ix, iw) => {
    ctx.fillStyle = 'rgba(40,48,36,0.9)';
    ctx.fillRect(ix, 636, iw, 40);
    ctx.fillStyle = 'rgba(8,14,9,0.95)';
    ctx.fillRect(ix + 6, 642, iw - 12, 28);
  };
  const mbar = (x, y, w, v, col) => {
    ctx.fillStyle = 'rgba(141,255,158,0.18)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, v)), 4);
  };
  bezel(330, 120);                                  // ENG: fuel + hull
  ctx.fillStyle = GREEN + '0.75)';
  ctx.fillText('FUEL', 340, 650);
  mbar(366, 646, 74, f.fuel, f.fuel < 0.2 ? RED + '0.9)' : GREEN + '0.8)');
  ctx.fillText('HULL', 340, 662);
  mbar(366, 658, 74, f.hp, f.hp < 0.35 ? RED + '0.9)' : GREEN + '0.8)');
  bezel(500, 100);                                  // WPN: stores + selection
  [['GUN', wp.ammo.gun], ['RKT', wp.ammo.rockets], ['PAR', wp.ammo.pars]]
    .forEach(([nm, n], i) => {
      ctx.fillStyle = wp.selected === i ? AMBER + '0.95)' : GREEN + '0.6)';
      ctx.fillText(`${nm} ${String(n).padStart(3)}`, 510, 648 + i * 9);
    });
  bezel(660, 130);                                  // FLT: speeds + heading
  ctx.fillStyle = GREEN + '0.75)';
  ctx.fillText(`SPD ${String(Math.round(f.kmh)).padStart(3)}`, 670, 650);
  ctx.fillText(`ALT ${String(Math.round(f.y)).padStart(3)}`, 670, 662);
  ctx.fillText(`HDG ${String(Math.round((((f.heading / DEG) % 360) + 360) % 360)).padStart(3, '0')}`, 730, 650);
  ctx.fillText(`AGL ${String(Math.max(0, Math.round(f.agl))).padStart(3)}`, 730, 662);
  bezel(830, 100);                                  // CAUT: flares + RWR lamps
  ctx.fillStyle = GREEN + '0.75)';
  ctx.fillText(`FLR ${String(wp.ammo.flares).padStart(2)}`, 840, 650);
  ctx.fillStyle = s.samLock > 0.12 ? AMBER + '0.95)' : GREEN + '0.3)';
  ctx.fillText('RWR', 840, 662);
  ctx.fillStyle = s.missileInbound && (t * 4) % 1 < 0.5 ? RED + '0.95)' : GREEN + '0.3)';
  ctx.fillText('MSL', 872, 662);
  // side struts
  ctx.fillStyle = 'rgba(14,17,12,0.92)';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(90, 0); ctx.lineTo(30, 620); ctx.lineTo(0, 640); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(1280, 0); ctx.lineTo(1190, 0); ctx.lineTo(1250, 620); ctx.lineTo(1280, 640); ctx.closePath(); ctx.fill();
  // top frame
  ctx.fillRect(0, 0, 1280, 26);
}

/** Tactical map overlay (drawn on #map-canvas). */
export function drawMap(canvas, terrain, entities, player, mission, objectives) {
  const size = Math.min(canvas.parentElement?.clientWidth ?? 640, window.innerHeight - 160, 760);
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const k = size / 1024;
  ctx.fillStyle = '#0a0f0a';
  ctx.fillRect(0, 0, size, size);
  if (terrain.mapImg) ctx.drawImage(terrain.mapImg, 0, 0, size, size);
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#8dff9e';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * size / 4, 0); ctx.lineTo(i * size / 4, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * size / 4); ctx.lineTo(size, i * size / 4); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const px = (x) => (x / 4) * k;
  // villages
  ctx.font = `${Math.max(10, size / 60)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  for (const v of terrain.meta.villages ?? []) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('✚ ' + v.name, px(v.x), px(v.z) - 8);
  }
  // entities
  for (const e of entities.list) {
    if (e.friendly) {
      ctx.fillStyle = '#6ab0ff';
      ctx.font = `bold ${Math.max(12, size / 44)}px ui-monospace, Menlo, monospace`;
      ctx.fillText('H', px(e.x), px(e.z) + 4);
      continue;
    }
    if (!e.alive) {
      ctx.fillStyle = 'rgba(120,120,120,0.6)';
      ctx.fillRect(px(e.x) - 2, px(e.z) - 2, 4, 4);
      continue;
    }
    const obj = objectives.find((o) => o.group === e.group);
    const primary = obj?.primary;
    ctx.fillStyle = primary ? '#ff5a4a' : '#ffb347';
    ctx.save();
    ctx.translate(px(e.x), px(e.z));
    if (primary) {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4, -4, 8, 8);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // player
  ctx.save();
  ctx.translate(px(player.x), px(player.z));
  ctx.rotate(player.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // north
  ctx.fillStyle = '#8dff9e';
  ctx.font = `bold ${Math.max(12, size / 48)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('N ↑', 10, 22);
  ctx.strokeStyle = 'rgba(141,255,158,0.5)';
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}