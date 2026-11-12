/* ============================================================
   SPARFLAMME — reader engine
   Vanilla JS, no dependencies. State lives in localStorage.
   ============================================================ */
(() => {
  'use strict';

  const BOOK = window.BOOK;
  const STORE_KEY = 'sparflamme.reader.v1';
  const $ = (s) => document.querySelector(s);

  const PROMPT = `I want you to take novelle_2040, convert it to a webbased e-reading application and push it to https://ai-guru.github.io/2026_ai_demos/. Make sure the style fits the theme.

After that I want you to also push fps/ to https://ai-guru.github.io/2026_ai_demos/

Make sure to mark both that they are made with Qwen4-Max-Preview. If possible add the prompts too.`;

  /* ---------- entries: 12 chapters + coda ---------- */
  const codaWords = BOOK.coda.items.reduce((a, i) => a + i.text.split(/\s+/).length, 0)
    + BOOK.coda.plain.reduce((a, p) => a + p.split(/\s+/).length, 0);
  const entries = BOOK.chapters.map((c) => ({ kind: 'chapter', n: c.n, title: c.title, words: c.words, data: c }));
  entries.push({ kind: 'coda', n: 13, title: 'Fundprotokoll', words: codaWords, data: BOOK.coda });
  const totalWords = entries.reduce((a, e) => a + e.words, 0);
  const cumWords = [];
  { let acc = 0; for (const e of entries) { cumWords.push(acc); acc += e.words; } }
  const minutes = (w) => Math.max(1, Math.round(w / 220));
  const pad = (n) => String(n).padStart(2, '0');
  const entryLabel = (i) => entries[i].kind === 'coda' ? 'KODA · Fundprotokoll' : `K ${pad(entries[i].n)} · ${entries[i].title}`;

  /* ---------- state ---------- */
  const DEFAULTS = { theme: 'blech', fs: 19, lh: 1.75, col: 66, font: 'serif' };
  let S = {
    ...DEFAULTS,
    started: false,
    chapter: 0,
    positions: {},   // entry index -> scroll fraction
    read: {},        // entry index -> true
    bookmarks: [],   // {entry, para, excerpt, ts}
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) S = { ...S, ...JSON.parse(raw) };
  } catch (e) { /* private mode etc. */ }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
    }, 250);
  }

  /* ---------- dom refs ---------- */
  const cover = $('#cover'), reader = $('#reader'), content = $('#content');
  const topChapter = $('#top-chapter'), progressBar = $('#readprogress i');
  const tocDrawer = $('#toc'), setDrawer = $('#settings'), scrim = $('#scrim');
  const aboutModal = $('#about'), toastEl = $('#toast');
  const btnBookmark = $('#btn-bookmark');

  /* ---------- helpers ---------- */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  const FLAME_PATH = 'M30 2 C34 14 47 26 47 48 C47 66 39 80 30 82 C21 80 13 66 13 48 C13 30 24 20 26 8 C27.5 13 29 10 30 2 Z';
  function flameSvg(sfx) {
    return `<svg viewBox="0 0 60 90" aria-hidden="true">
      <defs>
        <linearGradient id="fgO${sfx}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb15e"/><stop offset="1" stop-color="#e8452c"/></linearGradient>
        <linearGradient id="fgM${sfx}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98f"/><stop offset="1" stop-color="#ff9a3d"/></linearGradient>
        <linearGradient id="fgC${sfx}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6dd"/><stop offset="1" stop-color="#ffd07d"/></linearGradient>
        <radialGradient id="fgB${sfx}"><stop offset="0" stop-color="#9fdcff"/><stop offset="1" stop-color="#3f7fc4" stop-opacity="0"/></radialGradient>
      </defs>
      <path fill="url(#fgO${sfx})" d="${FLAME_PATH}"/>
      <path class="l-mid" fill="url(#fgM${sfx})" transform="translate(30 82) scale(.66) translate(-30 -82)" d="${FLAME_PATH}"/>
      <path class="l-core" fill="url(#fgC${sfx})" transform="translate(30 82) scale(.38) translate(-30 -82)" d="${FLAME_PATH}"/>
      <ellipse class="l-blue" cx="30" cy="80" rx="11" ry="5.5" fill="url(#fgB${sfx})"/>
    </svg>`;
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }

  function scrollMax() {
    return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }
  function scrollFrac() {
    return Math.min(1, Math.max(0, window.scrollY / scrollMax()));
  }

  /* ---------- settings ---------- */
  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = S.theme;
    root.style.setProperty('--fs', S.fs + 'px');
    root.style.setProperty('--lh', String(S.lh));
    root.style.setProperty('--col', String(S.col));
    root.style.setProperty('--reading-font', S.font === 'serif' ? 'var(--serif)' : 'var(--sans)');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = { blech: '#0c0f13', papier: '#e9dfc8', garten: '#0a110b' }[S.theme];
    $('#set-size').value = S.fs; $('#out-size').textContent = S.fs + ' px';
    $('#set-height').value = S.lh; $('#out-height').textContent = Number(S.lh).toFixed(2);
    $('#set-width').value = S.col; $('#out-width').textContent = S.col + ' ch';
    document.querySelectorAll('.theme-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === S.theme));
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.font === S.font));
  }

  /* ---------- rendering ---------- */
  function mottoHtml(m) {
    if (!m) return '';
    const label = m.label ? `<span class="motto-label">${inline(m.label)}:</span> ` : '';
    return `<div class="motto">${label}${inline(m.text)}</div>`;
  }

  function renderChapter(i, restoreFrac) {
    restoring = true;
    S.chapter = i;
    const e = entries[i];
    let html = '';
    if (e.kind === 'chapter') {
      const c = e.data;
      html += `<header class="chapter-head">
        <p class="chapter-kicker">KAPITEL ${pad(c.n)} · DRUCKSACHE 2040/07</p>
        <h1 class="chapter-title">${inline(c.title)}</h1>
        <div class="chapter-rule"><span>❖</span></div>
      </header>`;
      html += mottoHtml(c.motto);
      html += `<div class="chapter-body">${c.paras.map((p) => `<p>${inline(p)}</p>`).join('')}</div>`;
    } else {
      const c = e.data;
      html += `<header class="chapter-head">
        <p class="chapter-kicker">KODA · DOKUMENTARISCHER ANHANG</p>
        <h1 class="chapter-title">Fundprotokoll</h1>
        <div class="chapter-rule"><span>❖</span></div>
      </header>`;
      html += `<div class="coda-doc">
        <div class="coda-head">ARCHIV DER VERBOTENEN GÄRTEN · CONNEWITZ · ZUGANG 2049/17</div>
        <p class="coda-archiv">${inline(c.plain[0] || '')}</p>
        ${c.items.map((it) => `<div class="coda-item"><span class="coda-label">${inline(it.label)}</span>${inline(it.text)}</div>`).join('')}
        <p class="coda-close">${inline(c.plain[1] || '')}</p>
      </div>`;
      html += `<div class="endcard">
        <div class="flame-wrap" aria-hidden="true">
          <div class="flame-glow"></div>
          <div class="flame">${flameSvg(2)}</div>
          <div class="burner"></div>
        </div>
        <h2>ENDE</h2>
        <blockquote>„Für Sie. Es kostet fast nichts.“</blockquote>
        <div class="cover-actions">
          <button class="btn primary" id="btn-restart">Nochmal von vorn</button>
          <button class="btn" id="btn-end-toc">Inhaltsverzeichnis</button>
        </div>
      </div>`;
    }
    content.innerHTML = html;
    content.style.animation = 'none';
    void content.offsetWidth; // restart entrance animation
    content.style.animation = '';

    topChapter.textContent = entryLabel(i);
    document.title = `${e.title} — Sparflamme`;
    try { history.replaceState(null, '', e.kind === 'coda' ? '#koda' : '#k' + e.n); } catch (err) {}

    // chapter nav
    const prev = $('#btn-prev'), next = $('#btn-next');
    if (i === 0) {
      prev.className = 'chap-btn';
      prev.innerHTML = '<span class="nav-dir">← ZURÜCK</span><span class="nav-title">Titelseite</span>';
    } else {
      prev.className = 'chap-btn';
      prev.innerHTML = `<span class="nav-dir">← KAPITEL ${entries[i - 1].kind === 'coda' ? '' : pad(entries[i - 1].n)}</span><span class="nav-title">${inline(entries[i - 1].title)}</span>`;
    }
    if (i === entries.length - 1) {
      next.className = 'chap-btn next';
      next.innerHTML = '<span class="nav-dir">NEUSTART →</span><span class="nav-title">Nochmal von vorn</span>';
    } else {
      next.className = 'chap-btn next';
      next.innerHTML = `<span class="nav-dir">WEITER → ${entries[i + 1].kind === 'coda' ? 'KODA' : 'KAPITEL ' + pad(entries[i + 1].n)}</span><span class="nav-title">${inline(entries[i + 1].title)}</span>`;
    }

    const restart = $('#btn-restart');
    if (restart) restart.addEventListener('click', () => gotoEntry(0));
    const endToc = $('#btn-end-toc');
    if (endToc) endToc.addEventListener('click', () => openDrawer(tocDrawer));

    updateTocCurrent();
    const frac = restoreFrac != null ? restoreFrac : (S.positions[i] || 0);
    requestAnimationFrame(() => {
      window.scrollTo({ top: frac * scrollMax(), behavior: 'instant' });
      restoring = false;
      updateProgress();
    });
    save();
  }

  function gotoEntry(i, frac) {
    if (i < 0) { showCover(); return; }
    if (i >= entries.length) i = 0;
    closeDrawers();
    if (!readerVisible()) { startReading(i, frac); return; }
    if (S.chapter !== i) renderChapter(i, frac);
    else if (frac != null) window.scrollTo({ top: frac * scrollMax(), behavior: 'smooth' });
  }

  /* ---------- progress / quota ---------- */
  function overallProgress() {
    const frac = scrollFrac();
    return Math.min(1, (cumWords[S.chapter] + frac * entries[S.chapter].words) / totalWords);
  }

  function updateProgress() {
    if (!readerVisible() || restoring) return;
    const frac = scrollFrac();
    progressBar.style.width = (frac * 100).toFixed(2) + '%';
    S.positions[S.chapter] = frac;
    if (frac > 0.965 && !S.read[S.chapter]) {
      S.read[S.chapter] = true;
      updateTocStatus();
    }
    // quota meter
    const overall = overallProgress();
    const kwh = Math.max(0, Math.round(290 * (1 - overall)));
    $('#quota-kwh').textContent = String(kwh);
    $('#quota-fill').style.width = (kwh / 290 * 100).toFixed(1) + '%';
    const ampel = $('#quota-ampel');
    ampel.className = 'ampel-dot ' + (kwh > 120 ? 'gelb' : kwh > 43 ? 'orange' : 'rot');
    $('#quota-sub').textContent = overall >= 0.999
      ? 'Kontingent aufgebraucht. Die Wärme bleibt.'
      : 'Lesefortschritt, gemeldet in Kilowattstunden.';
    updateBookmarkButton();
    save();
  }

  let rafPending = false;
  let restoring = false;
  function onScroll() {
    if (rafPending || restoring) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; updateProgress(); });
  }

  /* ---------- TOC ---------- */
  function buildToc() {
    const list = $('#toc-list');
    list.innerHTML = entries.map((e, i) => `
      <li><button class="toc-item" data-entry="${i}">
        <span class="toc-n">${e.kind === 'coda' ? 'KODA' : 'K ' + pad(e.n)}</span>
        <span class="toc-t">
          <span class="toc-title">${inline(e.title)}</span>
          <span class="toc-meta">${e.words.toLocaleString('de-DE')} Wörter · ~${minutes(e.words)} Min</span>
        </span>
        <span class="toc-status" data-status="${i}"></span>
      </button></li>`).join('');
    list.querySelectorAll('.toc-item').forEach((b) => {
      b.addEventListener('click', () => gotoEntry(Number(b.dataset.entry)));
    });
    updateTocStatus();
  }
  function updateTocStatus() {
    document.querySelectorAll('[data-status]').forEach((el) => {
      const i = Number(el.dataset.status);
      if (S.read[i]) { el.textContent = '✓'; el.className = 'toc-status'; }
      else if (S.positions[i] > 0.02) { el.textContent = '●'; el.className = 'toc-status reading'; }
      else { el.textContent = ''; el.className = 'toc-status'; }
    });
  }
  function updateTocCurrent() {
    document.querySelectorAll('.toc-item').forEach((b) => {
      b.classList.toggle('current', Number(b.dataset.entry) === S.chapter);
    });
    updateTocStatus();
  }

  /* ---------- bookmarks ---------- */
  function readableEls() {
    return Array.from(content.querySelectorAll('.chapter-body p, .coda-item'));
  }
  function nearestPara() {
    const els = readableEls();
    if (!els.length) return 0;
    const y = window.scrollY + 110;
    let idx = 0;
    for (let k = 0; k < els.length; k++) {
      if (els[k].offsetTop <= y) idx = k; else break;
    }
    return idx;
  }
  function updateBookmarkButton() {
    const p = nearestPara();
    const active = S.bookmarks.some((b) => b.entry === S.chapter && b.para === p);
    btnBookmark.classList.toggle('active', active);
    btnBookmark.setAttribute('aria-label', active ? 'Lesezeichen entfernen' : 'Lesezeichen setzen');
    btnBookmark.title = active ? 'Lesezeichen entfernen' : 'Lesezeichen setzen';
  }
  function toggleBookmark() {
    const p = nearestPara();
    const existing = S.bookmarks.findIndex((b) => b.entry === S.chapter && b.para === p);
    if (existing >= 0) {
      S.bookmarks.splice(existing, 1);
      toast('Lesezeichen entfernt.');
    } else {
      const els = readableEls();
      const text = (els[p] ? els[p].textContent : '').trim();
      S.bookmarks.unshift({ entry: S.chapter, para: p, excerpt: text.slice(0, 110), ts: Date.now() });
      toast('Lesezeichen gesetzt.');
    }
    renderBookmarks();
    updateBookmarkButton();
    save();
  }
  function renderBookmarks() {
    const ul = $('#bookmark-list');
    $('#no-bookmarks').classList.toggle('hidden', S.bookmarks.length > 0);
    ul.innerHTML = S.bookmarks.map((b, i) => `
      <li>
        <button class="bm-jump" data-bm="${i}">
          <span class="bm-ch">${entryLabel(b.entry)}</span>
          <span class="bm-ex">„${esc(b.excerpt)}…“</span>
        </button>
        <button class="bm-del" data-del="${i}" aria-label="Lesezeichen löschen">×</button>
      </li>`).join('');
    ul.querySelectorAll('.bm-jump').forEach((b) => b.addEventListener('click', () => {
      const bm = S.bookmarks[Number(b.dataset.bm)];
      closeDrawers();
      if (!readerVisible()) startReading(bm.entry, 0);
      else if (S.chapter !== bm.entry) renderChapter(bm.entry, 0);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const els = readableEls();
        const el = els[Math.min(bm.para, els.length - 1)];
        if (el) window.scrollTo({ top: Math.max(0, el.offsetTop - 90), behavior: 'smooth' });
      }));
    }));
    ul.querySelectorAll('.bm-del').forEach((b) => b.addEventListener('click', () => {
      S.bookmarks.splice(Number(b.dataset.del), 1);
      renderBookmarks(); updateBookmarkButton(); save();
      toast('Lesezeichen entfernt.');
    }));
  }

  /* ---------- drawers / modal ---------- */
  function readerVisible() { return !reader.classList.contains('hidden'); }
  function openDrawer(d) {
    closeDrawers(true);
    scrim.classList.remove('hidden');
    requestAnimationFrame(() => scrim.classList.add('show'));
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
  }
  function closeDrawers(silent) {
    tocDrawer.classList.remove('open');
    setDrawer.classList.remove('open');
    tocDrawer.setAttribute('aria-hidden', 'true');
    setDrawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('show');
    if (!silent) setTimeout(() => {
      if (!tocDrawer.classList.contains('open') && !setDrawer.classList.contains('open')) scrim.classList.add('hidden');
    }, 320);
    else scrim.classList.add('hidden');
  }
  function openAbout() { $('#prompt-text').textContent = PROMPT; aboutModal.classList.remove('hidden'); }
  function closeAbout() { aboutModal.classList.add('hidden'); }

  /* ---------- cover / start ---------- */
  function showCover() {
    reader.classList.add('hidden');
    cover.classList.remove('hidden', 'leaving');
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.title = 'Sparflamme — Eine Novelle aus dem Jahr 2040';
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    updateStartButton();
  }
  function updateStartButton() {
    const btn = $('#btn-start');
    if (S.started && (S.positions[S.chapter] > 0.01 || S.chapter > 0)) {
      btn.textContent = `Weiterlesen · ${entryLabel(S.chapter)}`;
    } else {
      btn.textContent = 'Lesen beginnen';
    }
  }
  function startReading(entry, frac) {
    S.started = true;
    cover.classList.add('leaving');
    setTimeout(() => cover.classList.add('hidden'), 480);
    reader.classList.remove('hidden');
    renderChapter(entry != null ? entry : S.chapter, frac);
    save();
  }

  /* ---------- events ---------- */
  $('#btn-start').addEventListener('click', () => startReading());
  $('#btn-toc-cover').addEventListener('click', () => openDrawer(tocDrawer));
  $('#btn-toc').addEventListener('click', () => openDrawer(tocDrawer));
  $('#btn-settings').addEventListener('click', () => openDrawer(setDrawer));
  $('#btn-about').addEventListener('click', openAbout);
  $('#btn-about-cover').addEventListener('click', openAbout);
  btnBookmark.addEventListener('click', toggleBookmark);
  scrim.addEventListener('click', () => closeDrawers());
  document.querySelectorAll('.drawer-close').forEach((b) => b.addEventListener('click', () => closeDrawers()));
  document.querySelector('.modal-close').addEventListener('click', closeAbout);
  aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) closeAbout(); });

  $('#btn-prev').addEventListener('click', () => {
    if (S.chapter === 0) showCover();
    else gotoEntry(S.chapter - 1, 0);
  });
  $('#btn-next').addEventListener('click', () => {
    S.read[S.chapter] = true;
    gotoEntry(S.chapter + 1, 0);
  });

  // settings inputs — live
  $('#set-size').addEventListener('input', (e) => { S.fs = Number(e.target.value); applySettings(); save(); });
  $('#set-height').addEventListener('input', (e) => { S.lh = Number(e.target.value); applySettings(); save(); });
  $('#set-width').addEventListener('input', (e) => { S.col = Number(e.target.value); applySettings(); save(); });
  document.querySelectorAll('.theme-btn').forEach((b) => b.addEventListener('click', () => {
    S.theme = b.dataset.theme; applySettings(); save();
  }));
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    S.font = b.dataset.font; applySettings(); save();
  }));
  $('#btn-reset-settings').addEventListener('click', () => {
    Object.assign(S, DEFAULTS); applySettings(); save();
    toast('Satzspiegel zurückgesetzt.');
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!aboutModal.classList.contains('hidden')) closeAbout();
      else closeDrawers();
      return;
    }
    if (!readerVisible() || !aboutModal.classList.contains('hidden')) return;
    if (tocDrawer.classList.contains('open') || setDrawer.classList.contains('open')) return;
    if (e.key === 'ArrowRight') { S.read[S.chapter] = true; gotoEntry(S.chapter + 1, 0); }
    if (e.key === 'ArrowLeft') { if (S.chapter === 0) showCover(); else gotoEntry(S.chapter - 1, 0); }
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
  });

  /* ---------- init ---------- */
  applySettings();
  buildToc();
  renderBookmarks();
  $('#cover-meta').textContent =
    `${BOOK.place} · 12 Kapitel + Koda · ${totalWords.toLocaleString('de-DE')} Wörter · ~${minutes(totalWords)} Min`;
  updateStartButton();

  // quota meter from saved state (before the first scroll event)
  {
    const overall = Math.min(1, (cumWords[S.chapter] + (S.positions[S.chapter] || 0) * entries[S.chapter].words) / totalWords);
    const kwh = Math.max(0, Math.round(290 * (1 - overall)));
    $('#quota-kwh').textContent = String(kwh);
    $('#quota-fill').style.width = (kwh / 290 * 100).toFixed(1) + '%';
    $('#quota-ampel').className = 'ampel-dot ' + (kwh > 120 ? 'gelb' : kwh > 43 ? 'orange' : 'rot');
    if (overall >= 0.999) $('#quota-sub').textContent = 'Kontingent aufgebraucht. Die Wärme bleibt.';
  }

  // deep link: #k1 … #k12, #koda
  function entryFromHash() {
    const h = location.hash.match(/^#(k(\d{1,2})|koda)$/);
    if (!h) return null;
    return h[2] ? Math.min(12, Math.max(1, Number(h[2]))) - 1 : 12;
  }
  window.addEventListener('hashchange', () => {
    const idx = entryFromHash();
    if (idx == null) return;
    if (!readerVisible()) startReading(idx, S.positions[idx] || 0);
    else if (idx !== S.chapter) renderChapter(idx, S.positions[idx] || 0);
  });
  const initial = entryFromHash();
  if (initial != null) startReading(initial, S.positions[initial] || 0);
})();
