# Sparflamme — Web-Leseausgabe

A web-based e-reading application for the German dystopian novella
**Sparflamme — Eine Novelle aus dem Jahr 2040** (~18,000 words, 12 chapters +
documentary coda), converted from the `novelle_2040` source project.

Live: https://ai-guru.github.io/2026_ai_demos/sparflamme/

Made with **Qwen4-Max-Preview** (November 12th, 2026). See `prompt.md` for the
prompt and design notes.

## Run locally

No build step, no dependencies:

```bash
cd sparflamme
python3 -m http.server 8124
# open http://localhost:8124
```

## Files

```
index.html   app shell: cover, reader, drawers, about modal
reader.css   theme system (Blech / Papier / Garten), all styling
reader.js    reader engine: navigation, progress quota, bookmarks, settings
book.js      the novella, generated from novelle/gesamt.md (do not edit)
prompt.md    the prompt + origin notes
```

## Features

- Resume reading, per-chapter progress, deep links `#k1`…`#k12`, `#koda`
- "Restkontingent" progress meter in kWh with the regime's Ampel
- Bookmarks with excerpts, table of contents with reading status
- Live typesetting: 3 themes, font size, line height, column width, serif/sans
- Keyboard: ←/→ chapters, Esc closes panels
- localStorage only — no tracking, no cookies, no server

**Content note:** the novella is a critical dystopia. It criticizes the regime
it depicts; it is literature, not a recommendation.
