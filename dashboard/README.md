# Lunar Landing Site Navigator: dashboard

Static web front end for the `lunarnav` science engine. It reads the engine's precomputed JSON and shows, for any catalogued landing site, when the terrain takes the Sun or Earth away, which ridge does it, and how certain that time is.

React 18 + TypeScript + Vite. No other runtime dependencies, no map tiles, no web fonts, no keys. Charts are hand-written SVG.

## Quick start

```bash
cd dashboard
npm install          # exact versions pinned in package.json
npm run sync-data    # copy ../out/sites/*.json and ../out/validation_report.json into public/data/
npm run dev          # http://localhost:5173
```

## Commands

| Command | What it does |
|---|---|
| `npm run sync-data` | Copies the engine output into `public/data/` (minified). Re-run after every engine precompute or test run. Also builds `features_south.json` (crater outlines for the polar map) from the engine's IAU gazetteer if it is present. |
| `npm run sync-data -- <engine-folder>` | Same, when the engine is not the parent folder (or set `LUNARNAV_ENGINE_DIR`). |
| `npm run dev` | Dev server with hot reload. |
| `npm run build` | Type-check, then build static files into `dist/`. |
| `npm run preview` | Serve `dist/` on http://localhost:4173 to check the production build. |

`public/data/` is committed on purpose: the built site needs nothing but those files. Refresh after an engine rerun with `npm run sync-data && npm run build`.

## Deploying

`dist/` is plain static files with relative paths (`base: "./"`), so it works at a domain root or under a sub-path (GitHub Pages, Vercel, Netlify, Cloudflare Pages). Routing uses the URL hash, so no server rewrite rules are needed.

## Custom coordinates and the engine API

Curated sites are fully static. Custom coordinates call the optional FastAPI engine:

```bash
# from the engine folder
.venv/Scripts/python -m uvicorn lunarnav.api:app --app-dir src --port 8765
```

The API address is resolved in this order:

1. `?api=https://your-host` in the page URL (before the `#`)
2. the address saved on the "All sites + custom" page (browser local storage)
3. `VITE_API_BASE` at build time (see `.env.example`; put it in `.env.local`)
4. `http://127.0.0.1:8765`

If the API is unreachable, the custom-point page says so, shows the start command, and offers a curated site. Nothing else depends on it.

## Views

- **Site** (default). A one-sentence answer, four status tiles (Sun elevation above the terrain horizon, countdown to terrain sunset or sunrise with its cause, Earth, Sun and Earth together), then:
  - **Horizon panorama**: 360° terrain silhouette, Sun and Earth paths for the coming lunar day (solid where visible, dotted where hidden), event dots, named ridges, hover for the blocking terrain in any direction. Toggle "No terrain (ideal sphere)" to see what a tool without terrain assumes.
  - **Time**: lanes for Sun, Earth and both; drag or use the keyboard; step, jump to events, play (slows near sunrise and sunset); a live clock that can be pinned.
  - **Mission replay** on mission sites: predicted light against the published record.
  - **Plan a stay / slip the schedule**: stay length, +1 week to +1 year slips, a before/after table and a chart of every possible landing date.
  - **Long-term light by mast height** (0 / 2 / 10 m), **where the horizon comes from** (distance to the horizon-setting terrain in every direction), **a few metres matter** (sensitivity grid), **how sure are these times** (P10 to P90 from NASA's DEM error clones, including fragile events that some terrain versions do not have).
  - **Event table** with the terrain that causes each event, and CSV export.
- **Compare**. Two to four sites on one time cursor: lanes, a scorecard with BEST tags (never blended into one score), and the same moment on each horizon. CSV export.
- **Missions**. Predicted terrain sunset against the real ending for Chandrayaan-3, Blue Ghost 1, IM-2, IM-1 and SLIM, with sources. IM-1 and IM-2 are honesty rows: light did not end them.
- **Evidence**. Generated from `validation_report.json`: every test with its numbers, criterion and source, including the ones that miss, and a list of what the tool does not know.
- **All sites + custom**. South-polar locator map, custom-coordinate form, API settings, sortable catalogue.

## Other features

- Every piece of state is in the URL (site, time, mast, stay, slip, compared sites, language), so any view is a shareable link, e.g. `#/site?site=connecting_ridge_c2&t=2026-11-14T07:30Z`.
- Light theme by default (readable on a projector), dark theme as a toggle.
- Colour-blind-safe state colours (Okabe-Ito based, checked with a CVD validator), always paired with a label, shape or hatch pattern.
- Keyboard-operable time cursor (arrows = 1 hour, Shift+arrows = 1 day, Page Up/Down = 1 lunar day), a throttled ARIA live region for the answer sentence, `prefers-reduced-motion` respected.
- English only. The plain-language strings (answer sentence, tiles, explainer) live in `src/lib/i18n.ts`; Hindi and Gujarati were dropped on 12 Nov 2026 by team decision.
- Works at phone width.

## How the numbers are derived

The dashboard does not compute ephemerides. Event times, blockers, long-term statistics and uncertainty come straight from the engine files. From those it derives:

- positions between the engine's 3-hourly track samples, by linear interpolation;
- the visible disc fraction for the chosen mast, from the track and that mast's horizon;
- "without terrain" rise and set times, from where the track's upper limb crosses 0° (good to a few minutes);
- stay-window totals, from the event list.

Field reference: `../docs/DATA_CONTRACT.md`. All derivations are in `src/lib/astro.ts`.

## Layout

```
scripts/sync-data.mjs   engine output -> public/data
public/data/            synced JSON (committed)
src/lib/                types, data loading, URL state, derivations, formatting, i18n
src/components/         Panorama, Timeline, NowPanel, StayPlanner, SiteDetails, Mission
src/views/              Site, Compare, Missions, Evidence, Sites
src/styles.css          theme tokens and all styling
```
