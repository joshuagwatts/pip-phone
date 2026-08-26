# Ground Control

Field OS for a roofing and construction company.

Broken out of Phone Pip: **Super Chat** (multi-API radio), **WX** (NOAA hail tracker + radar), and **LENS** rebuilt as a certain-only shingle identifier.

This folder is the app. It is meant to live in its own GitHub repository: [joshuagwatts/ground-control](https://github.com/joshuagwatts/ground-control).

## What it does

- **LENS** — shingle identification from a sequence of photos. It will **not** name manufacturer, product, color, or date until the catalog match is unique and the required shots exist. If it is unsure, it asks for the next angle (granule close-up, tab/cutout, overlay/shadow, nailing strip, back stamp, bundle wrapper).
- **Discontinued** — catalog includes pulled lines (GAF Timberline HD, CertainTeed Independence / Hatteras, OC Duration COOL, Atlas GlassMaster, and more). A discontinued ID is only claimed when the match is unique; the current equivalent is listed when we have one.
- **WX** — pin-accurate hail zones from NOAA SPC + SWDI radar hail + IEM LSR, RainViewer radar, Open-Meteo. Default radius 25 km / 365 days / 0.75" hail.
- **RADIO** — Super Chat: Gemini, OpenAI, Anthropic, OpenRouter, Groq, Grok, Cerebras, DeepSeek, Mistral, COMPARE tabs, multi-photo attach.
- **JOBS** — save a LENS read (and later a hail pin) onto an inspection.

## Run

```bash
cd ground-control
npm test
npm start
```

Open http://127.0.0.1:4173

Paste a **Gemini / OpenAI / Anthropic / OpenRouter** key in KEYS, flip **LEAKY**, then use LENS.

## Certainty rules

LENS is not a guessing model with a roof prompt. A local gate throws out any product name that is not a unique row in `www/catalog.js`. One photo is never enough. Exact **date** requires a readable back stamp or bundle wrapper — weathering is era, not a date.

## New GitHub repo / Cursor workspace

1. Create empty repo: https://github.com/new?name=ground-control
2. From this folder:

```bash
cd ground-control
git init
git add .
git commit -m "Ground Control v0.1.0 — LENS, WX hail, Super Chat"
git branch -M main
git remote add origin https://github.com/joshuagwatts/ground-control.git
git push -u origin main
```

3. In Cursor: **File → Open Folder** on the clone (or start a Cloud Agent on that repo). That is the Ground Control workspace.
