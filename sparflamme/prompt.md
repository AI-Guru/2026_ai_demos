# Prompt — Sparflamme (Web-Leseausgabe)

## Original request (November 12th, 2026)

> I want you to take novelle_2040, convert it to a webbased e-reading
> application and push it to https://ai-guru.github.io/2026_ai_demos/.
> Make sure the style fits the theme.
>
> After that I want you to also push fps/ to
> https://ai-guru.github.io/2026_ai_demos/
>
> Make sure to mark both that they are made with Qwen4-Max-Preview.
> If possible add the prompts too.

Built with **Qwen4-Max-Preview**.

## Source material

The novella itself (`novelle_2040/`, "Sparflamme — Eine Novelle aus dem Jahr
2040") was written in a coordinated multi-agent process: four parallel
research agents, then world bible / characters / outline / style guide, then
chapter writing by three agents against fixed continuity contracts, then
revision and merge. Its README states: *"Die Novelle kritisiert das Regime,
das sie schildert. Sie ist Literatur, keine Empfehlung."* The original
writing briefs live in the source project's `konzept/` directory; the request
above is the prompt for this web reading edition.

## What was built

A dependency-free static e-reader (HTML/CSS/vanilla JS) whose interface is
art-directed as the regime it depicts — "Amt für Verbrauchswahrheit":

- Cold sheet-metal palette with rationed amber signal light; two alternate
  themes: **Papier** (rationed paper, light) and **Garten** (the forbidden
  garden: soil night, grow-light pink, leaf green, bulb amber).
- Animated pilot flame ("Sparflamme") and the rotating Dienstsiegel
  "J. Falk, Energieprüferin" — the novella's object-symbol.
- 12 chapters + documentary coda, each chapter's motto rendered as a regime
  document card; drop caps, justified German typesetting (Newsreader).
- Reading progress reported as a **Restkontingent** in kWh (290 → 0), with the
  regime's Ampel turning from yellow to red as you read.
- Table of contents with per-chapter status, bookmarks with excerpts,
  live typesetting controls (theme, size, line height, column width, serif/sans),
  keyboard navigation, deep links (#k1…#k12, #koda), resume where you left off.
- All state in localStorage. No tracking, no cookies, no server.
