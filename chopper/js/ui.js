/* ==========================================================================
   TIGER — Operation Weißer Blitz · UI shell
   --------------------------------------------------------------------------
   Pure DOM layer: screens, briefing, debrief, in-flight overlays.
   No game logic lives here — main.js wires callbacks via initUI(cb).
   Every function is defensive: missing elements are a silent no-op.
   ========================================================================== */

/* ------------------------------------------------------------------------ */
/* Internal state                                                            */
/* ------------------------------------------------------------------------ */

let cb = {};                 // callbacks registered by initUI()
let selectedLoadout = 0;     // index into the current briefing's loadouts
let previousScreen = 'title';// screen shown before 'controls' (for BACK)

// Timers for transient overlays (cleared before reuse)
let cardTimer = null, cardFadeTimer = null;
let radioTypeTimer = null, radioHideTimer = null;
let toastTimer = null, toastFadeTimer = null;

const SCREENS = ['loading', 'title', 'briefing', 'debrief', 'pause', 'controls', 'map'];

const MISSION_NAMES = [
  'Lüneburger Heide',
  'Bayerischer Wald',
  'Schwäbische Alb',
  'Allgäu',
];

const reducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Element lookup — always live, always null-safe at the call site. */
const el = (id) => document.getElementById(id);

const clamp01 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
};

/* Restart a CSS animation on an element that may already be visible. */
function replayAnimation(node) {
  if (!node) return;
  node.style.animation = 'none';
  void node.offsetWidth; // force reflow
  node.style.animation = '';
}

/* ------------------------------------------------------------------------ */
/* initUI — wire all buttons, sliders and loadout cards                      */
/* ------------------------------------------------------------------------ */

export function initUI(callbacks) {
  cb = callbacks || {};
  const call = (name, ...args) => {
    if (typeof cb[name] === 'function') cb[name](...args);
  };

  // Simple click → callback wiring. Native <button> already handles
  // Enter/Space keyboard activation, so no extra key handlers needed.
  const wiring = [
    ['btn-campaign',      () => call('onCampaign')],
    ['btn-training',      () => call('onTraining')],
    ['btn-controls',      () => call('onControls')],
    ['btn-sound',         () => call('onSoundToggle')],
    ['btn-back',          () => call('onBack')],
    ['btn-launch',        () => call('onLaunch', getLoadout())],
    ['btn-resume',        () => call('onResume')],
    ['btn-restart',       () => call('onRestart')],
    ['btn-quit',          () => call('onQuit')],
    ['btn-next',          () => call('onNext')],
    ['btn-retry',         () => call('onRetry')],
    ['btn-menu',          () => call('onMenu')],
    ['btn-controls-back', () => call('onBack')],
    ['btn-map-close',     () => call('onMapClose')],
  ];
  for (const [id, fn] of wiring) {
    const node = el(id);
    if (node) node.addEventListener('click', fn);
  }

  // Volume sliders: input event → onVolume(kind, 0..1) + live value label.
  for (const kind of ['master', 'sfx', 'music']) {
    const slider = el('vol-' + kind);
    if (!slider) continue;
    slider.addEventListener('input', () => {
      const v = Number(slider.value) || 0;
      const label = el('vol-' + kind + '-val');
      if (label) label.textContent = String(Math.round(v));
      call('onVolume', kind, v / 100);
    });
  }

  // Loadout cards: delegated click + roving arrow-key navigation.
  const row = el('loadout-row');
  if (row) {
    row.addEventListener('click', (e) => {
      const card = e.target && e.target.closest ? e.target.closest('.loadout-card') : null;
      if (card) selectLoadout(Number(card.dataset.index) || 0);
    });
    row.addEventListener('keydown', (e) => {
      const cards = Array.from(row.querySelectorAll('.loadout-card'));
      if (!cards.length) return;
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (selectedLoadout + 1) % cards.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (selectedLoadout - 1 + cards.length) % cards.length;
      if (next >= 0) {
        e.preventDefault();
        selectLoadout(next);
        cards[next].focus();
      }
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Screen management                                                         */
/* ------------------------------------------------------------------------ */

export function showScreen(name) {
  if (!SCREENS.includes(name) && name !== 'none') return;

  // Remember where we came from when entering the controls screen.
  const current = document.body ? document.body.dataset.screen : null;
  if (name === 'controls' && current && current !== 'controls') {
    previousScreen = current;
  }

  for (const s of SCREENS) {
    const node = el('screen-' + s);
    if (node) node.classList.toggle('hidden', s !== name);
  }
  if (document.body) document.body.dataset.screen = name;

  // Entering flight: drop focus so SPACE/ENTER never re-click a hidden button.
  if (name === 'none' && document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }

  // Leaving flight: stop any in-flight radio message so it never lingers
  // over the debrief / pause / menu screens.
  if (name !== 'none') {
    clearInterval(radioTypeTimer);
    clearTimeout(radioHideTimer);
    radioTypeTimer = radioHideTimer = null;
    const box = el('radio-box');
    if (box) box.classList.add('hidden');
  }

  // Move keyboard focus to the screen's principal action (never mid-flight).
  if (name !== 'none' && name !== 'loading') {
    const focusId = {
      title: 'btn-campaign',
      briefing: 'btn-launch',
      debrief: 'btn-next',
      pause: 'btn-resume',
      controls: 'btn-controls-back',
      map: 'btn-map-close',
    }[name];
    requestAnimationFrame(() => {
      let target = el(focusId);
      if (target && target.classList.contains('hidden')) target = el('btn-retry');
      if (target && typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

export function setLoading(p01, label) {
  const fill = el('load-fill');
  if (fill) fill.style.width = (clamp01(p01) * 100).toFixed(1) + '%';
  const text = el('load-label');
  if (text && typeof label === 'string') text.textContent = label;
}

/* ------------------------------------------------------------------------ */
/* Briefing                                                                  */
/* ------------------------------------------------------------------------ */

export function setBriefing(data) {
  const d = data || {};

  const kicker = el('brief-kicker');
  if (kicker && typeof d.kicker === 'string') kicker.textContent = d.kicker;

  const title = el('brief-title');
  if (title) title.textContent = d.title || '';

  const map = el('brief-map-img');
  if (map && d.mapSrc) map.src = d.mapSrc;

  // Objectives: li.primary / li.secondary (markers drawn by CSS ::before)
  const objectives = el('brief-objectives');
  if (objectives) {
    objectives.textContent = '';
    for (const o of Array.isArray(d.objectives) ? d.objectives : []) {
      const li = document.createElement('li');
      li.className = o && o.primary ? 'primary' : 'secondary';
      li.textContent = (o && o.text) || '';
      objectives.appendChild(li);
    }
  }

  // Intel paragraphs
  const intel = el('brief-intel');
  if (intel) {
    intel.textContent = '';
    for (const para of Array.isArray(d.intel) ? d.intel : []) {
      const p = document.createElement('p');
      p.textContent = para || '';
      intel.appendChild(p);
    }
  }

  // Threat tags
  const threats = el('brief-threats');
  if (threats) {
    threats.textContent = '';
    for (const t of Array.isArray(d.threats) ? d.threats : []) {
      const tag = document.createElement('span');
      tag.className = 'threat';
      tag.textContent = t || '';
      threats.appendChild(tag);
    }
  }

  // Loadout cards (role=radio buttons, built with textContent — no HTML inject)
  const row = el('loadout-row');
  if (row) {
    row.textContent = '';
    const loadouts = Array.isArray(d.loadouts) ? d.loadouts : [];
    loadouts.forEach((lo, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'loadout-card';
      card.setAttribute('role', 'radio');
      card.dataset.index = String(i);

      const name = document.createElement('span');
      name.className = 'lo-name';
      name.textContent = (lo && lo.name) || '';
      card.appendChild(name);

      const desc = document.createElement('span');
      desc.className = 'lo-desc';
      desc.textContent = (lo && lo.desc) || '';
      card.appendChild(desc);

      const stats = document.createElement('span');
      stats.className = 'lo-stats';
      for (const s of (lo && Array.isArray(lo.stats)) ? lo.stats : []) {
        const line = document.createElement('span');
        line.className = 'lo-stat';
        line.textContent = s || '';
        stats.appendChild(line);
      }
      card.appendChild(stats);
      row.appendChild(card);
    });
  }

  selectedLoadout = Number.isInteger(d.selectedLoadout) ? d.selectedLoadout : 0;
  applyLoadoutSelection();
}

function selectLoadout(i) {
  const row = el('loadout-row');
  const count = row ? row.querySelectorAll('.loadout-card').length : 0;
  if (!count) return;
  selectedLoadout = Math.min(count - 1, Math.max(0, i));
  applyLoadoutSelection();
}

function applyLoadoutSelection() {
  const row = el('loadout-row');
  if (!row) return;
  const cards = row.querySelectorAll('.loadout-card');
  cards.forEach((card, i) => {
    const on = i === selectedLoadout;
    card.classList.toggle('selected', on);
    card.setAttribute('aria-checked', on ? 'true' : 'false');
    card.tabIndex = on ? 0 : -1; // roving tabindex for the radiogroup
  });
  if (selectedLoadout >= cards.length) selectedLoadout = Math.max(0, cards.length - 1);
}

export function getLoadout() {
  return selectedLoadout;
}

/* ------------------------------------------------------------------------ */
/* Debrief                                                                   */
/* ------------------------------------------------------------------------ */

export function setDebrief(data) {
  const d = data || {};
  const success = !!d.success;

  const title = el('debrief-title');
  if (title) {
    title.textContent = d.title || '';
    title.classList.toggle('fail', !success);
  }

  const sub = el('debrief-sub');
  if (sub) sub.textContent = d.sub || '';

  const tbody = document.querySelector('#debrief-stats tbody');
  if (tbody) {
    tbody.textContent = '';
    for (const row of Array.isArray(d.stats) ? d.stats : []) {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      tdLabel.className = 'stat-label';
      tdLabel.textContent = (row && row[0]) || '';
      const tdValue = document.createElement('td');
      tdValue.className = 'stat-value';
      tdValue.textContent = (row && row[1]) || '';
      tr.appendChild(tdLabel);
      tr.appendChild(tdValue);
      tbody.appendChild(tr);
    }
  }

  const stamp = el('debrief-rating');
  if (stamp) {
    stamp.textContent = d.rating || '';
    stamp.classList.toggle('rating-good', success);
    stamp.classList.toggle('rating-bad', !success);
    replayAnimation(stamp); // re-trigger the scale-in even on repeat debriefs
  }

  const comment = el('debrief-comment');
  if (comment) comment.textContent = d.comment || '';

  const next = el('btn-next');
  if (next) next.classList.toggle('hidden', !(d.hasNext && success));
}

/* ------------------------------------------------------------------------ */
/* In-flight overlays                                                        */
/* ------------------------------------------------------------------------ */

/** Cinematic mission intro card; auto-hides after ms. */
export function missionCard(kicker, title, sub, ms = 3800) {
  const card = el('mission-card');
  if (!card) return;

  clearTimeout(cardTimer);
  clearTimeout(cardFadeTimer);

  const k = el('mc-kicker'), t = el('mc-title'), s = el('mc-sub');
  if (k) k.textContent = kicker || '';
  if (t) t.textContent = title || '';
  if (s) s.textContent = sub || '';

  card.classList.remove('hidden', 'leaving');
  replayAnimation(card);

  cardTimer = setTimeout(() => {
    if (reducedMotion()) {
      card.classList.add('hidden');
      return;
    }
    card.classList.add('leaving'); // CSS fades/slides it out…
    cardFadeTimer = setTimeout(() => card.classList.add('hidden'), 380);
  }, Math.max(0, ms));
}

/** Radio message with typewriter effect; replaces any previous message. */
export function radio(sender, text, ms = 5200) {
  const box = el('radio-box');
  const senderEl = el('radio-sender');
  const textEl = el('radio-text');
  if (!box || !textEl) return;

  clearInterval(radioTypeTimer);
  clearTimeout(radioHideTimer);

  if (senderEl) senderEl.textContent = sender || '';
  textEl.textContent = '';
  box.classList.remove('hidden');
  replayAnimation(box);

  const full = String(text == null ? '' : text);
  const hide = () => box.classList.add('hidden');

  // Reduced motion: show the full message instantly.
  if (reducedMotion() || full.length === 0) {
    textEl.textContent = full;
    textEl.classList.remove('typing');
    radioHideTimer = setTimeout(hide, Math.max(0, ms));
    return;
  }

  textEl.classList.add('typing');
  let i = 0;
  radioTypeTimer = setInterval(() => {
    i += 1;
    textEl.textContent = full.slice(0, i);
    if (i >= full.length) {
      clearInterval(radioTypeTimer);
      radioTypeTimer = null;
      textEl.classList.remove('typing');
      radioHideTimer = setTimeout(hide, Math.max(0, ms)); // ms counts from completion
    }
  }, 28);
}

/** Top-center status toast. kind: 'info' | 'warn' | 'good'. */
export function toast(text, kind = 'info', ms = 2600) {
  const node = el('toast');
  if (!node) return;

  clearTimeout(toastTimer);
  clearTimeout(toastFadeTimer);

  node.textContent = text || '';
  node.classList.remove('kind-info', 'kind-warn', 'kind-good', 'leaving');
  node.classList.add('kind-' + (['info', 'warn', 'good'].includes(kind) ? kind : 'info'));
  node.classList.remove('hidden');
  replayAnimation(node);

  toastTimer = setTimeout(() => {
    if (reducedMotion()) {
      node.classList.add('hidden');
      return;
    }
    node.classList.add('leaving');
    toastFadeTimer = setTimeout(() => node.classList.add('hidden'), 220);
  }, Math.max(0, ms));
}

/* ------------------------------------------------------------------------ */
/* Full-screen effects                                                       */
/* ------------------------------------------------------------------------ */

/** Red damage vignette, 0..1. */
export function vignette(level01) {
  const node = el('vignette');
  if (node) node.style.opacity = String(clamp01(level01));
}

/** White flash: jump to alpha instantly, then let the CSS transition fade it. */
export function flash(alpha01) {
  const node = el('flash');
  if (!node) return;
  const a = clamp01(alpha01);
  node.style.transition = 'none';
  node.style.opacity = String(a);
  void node.offsetWidth; // commit the instant jump…
  node.style.transition = ''; // …restore the stylesheet's .5s fade
  requestAnimationFrame(() => { node.style.opacity = '0'; });
}

/* ------------------------------------------------------------------------ */
/* Sound / volume                                                            */
/* ------------------------------------------------------------------------ */

export function setSound(on) {
  const btn = el('btn-sound');
  if (!btn) return;
  btn.textContent = 'SOUND: ' + (on ? 'ON' : 'OFF');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function setVolumes(vols) {
  if (!vols) return;
  for (const kind of ['master', 'sfx', 'music']) {
    const v = vols[kind];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const pct = Math.round(clamp01(v) * 100);
    const slider = el('vol-' + kind);
    if (slider) slider.value = String(pct);
    const label = el('vol-' + kind + '-val');
    if (label) label.textContent = String(pct);
  }
}

/* ------------------------------------------------------------------------ */
/* Campaign progress (title screen)                                          */
/* ------------------------------------------------------------------------ */

/** completed: boolean[4]. First uncompleted mission is highlighted. */
export function updateProgress(completed) {
  const wrap = el('progress-stars');
  if (!wrap) return;
  wrap.textContent = '';

  const flags = Array.isArray(completed) ? completed : [];
  const current = MISSION_NAMES.findIndex((_, i) => !flags[i]); // -1 when all done

  MISSION_NAMES.forEach((name, i) => {
    const done = !!flags[i];
    const slot = document.createElement('div');
    slot.className = 'prog-slot ' + (done ? 'done' : i === current ? 'current' : 'locked');
    slot.title = 'Mission ' + (i + 1) + ': ' + name + (done ? ' — completed' : i === current ? ' — unlocked' : ' — locked');

    const star = document.createElement('span');
    star.className = 'star';
    star.textContent = done ? '★' : '☆';
    star.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'prog-name';
    label.textContent = name;

    slot.appendChild(star);
    slot.appendChild(label);
    wrap.appendChild(slot);
  });
}
