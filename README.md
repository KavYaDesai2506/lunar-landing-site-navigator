# Lunar Landing Site Navigator

**When does the light end at a lunar landing site, which ridge ends it, and how sure are we?**

Built for NASA Space Apps 2026, challenge *Lunar Landing Site Navigator*, by team Purple Haze (Surat, India).

- **Live dashboard:** https://lunar-navigator-omega.vercel.app
- **Live engine API:** https://lunar-navigator-api.vercel.app (`/health`, `/horizon`, `/site`)
- **Try first:** [Connecting Ridge C2, 14 Nov 2026](https://lunar-navigator-omega.vercel.app/#/site?site=connecting_ridge_c2&t=2026-11-14T07:30Z). The ridge near Henson crater hides the Sun at 08:26 UTC; press Play to watch it go.

## What it does

Pick a site, or type any coordinates south of 60°N. For that spot the tool shows:

- the Sun and Earth above the **real terrain horizon**, from a 720-ray horizon built from NASA LOLA elevation data;
- a countdown to the next **terrain sunset** and **Earth-set**, with the time it would happen with no terrain;
- **which ridge causes it**, named from the IAU gazetteer ("near Henson crater, 8.1 km away, azimuth 236°");
- **how sure that time is:** a P10–P90 range from 100 NASA DEM error clones (Shackleton, Connecting Ridge C1);
- 18.6-year illumination and Earth-visibility statistics, side-by-side site comparison, and mast-height effects (0 / 2 / 10 m);
- **predicted vs. actual mission endings** for Chandrayaan-3, Blue Ghost 1, IM-1, IM-2 and SLIM.

## How it was validated

| Test | Against | Result |
|---|---|---|
| T1 Sun/Earth directions | JPL Horizons | max error 0.002″ |
| T3 long-term illumination | Gläser et al. 2018 (20 m) | Shackleton 80.2 / 84.7 % / 219 h vs 81.0 / 85.5 % / 221 h |
| T5 illumination map, 60 points | NASA PGDA product 69 (85°S) | Sun RMSE 2.84 pp, Earth RMSE 0.84 pp |
| T4 mast height | Gläser 2018 / 2014 | C1 73.9 → 85.6 → 92.5 % at 0 / 2 / 10 m |
| T6 mission endings | mission records | Chandrayaan-3: put to sleep 4.7 h before our predicted terrain sunset, Sun still 100 % up. A flat-horizon (no terrain) tool would put that sunset 10.4 h later still. Blue Ghost 1: died 4.6 h after our predicted sunset; its batteries lasted ~5 h into the night |
| T7 negative controls | mission records | IM-2 and IM-1 ended with sunlight left (orientation/power), so we do not claim them |
| T2 terrain sunset | LROC QuickMap | reported, not scored: same Sun/Earth geometry, different local ridge (QuickMap uses 4 h steps) |

Full numbers: `out/validation_report.json` and the **Evidence** tab of the dashboard. Run them with `pytest`.

## NASA data and tools used

- **LOLA elevation models** from NASA Goddard's PGDA (products 69, 78, 90) and **SLDEM2015** (LOLA + Kaguya), via range reads, so no full downloads.
- **NAIF SPICE** kernels (DE440, Moon ME frame) for the Sun and Earth geometry.
- **JPL Horizons:** validation truth for T1 (a NASA-listed resource for this challenge).
- **LROC QuickMap:** independent cross-check (T2) and our usability benchmark: 12–18 clicks to a terrain-aware Sun answer, versus one link here (a NASA-listed resource).
- **LROC QuickMap and NASA Moon Trek:** each site page links to the same spot in both (NASA-listed resources).
- **USGS/NASA Artemis III candidate regions:** 6 of 9 regions, each as its best-lit landable point (slope ≤ 8°).
- **NASA PGDA DEM error clones (product 78)** for the uncertainty bands.

## Run it locally

```bash
# engine (Python 3.13, uv)
uv sync
.venv/Scripts/python scripts/fetch_runtime_data.py      # SPICE kernels + regional terrain (one-off)
.venv/Scripts/python -m pytest -q                       # validation suite
.venv/Scripts/python -m uvicorn lunarnav.api:app --app-dir src --port 8765

# dashboard (Node 20+)
cd dashboard && npm install && npm run sync-data && npm run dev
```

## Limits (stated plainly)

- North polar region (lat ≥ 60°N) is not supported yet.
- Uncertainty bands exist for 2 sites; other sites show the single best estimate.
- Lander orientation and solar-panel geometry are not modelled (see IM-1/IM-2).
- If NASA's terrain server is unreachable from the host, custom polar points use the bundled 240 m terrain and say so.

## How this was built

### Use of Super Intelligence (SI) tools

We used Anthropic's Claude a lot, and we want judges to see exactly where.

| Part | SI involvement | What we did |
|---|---|---|
| Python engine (`src/`), tests (`tests/`), scripts (`scripts/`) | **Code generated with Claude Code (Opus 5.5)** under our direction | Set the method (LOLA terrain horizons, SPICE geometry, DEM-clone uncertainty), the validation targets and pass criteria; checked every result against independent sources |
| Web dashboard (`dashboard/`) | **Code and visual design generated with Claude (Fable 5.2)** | Reviewed each version, marked up screenshots with what to remove, enlarge or restructure, and chose the final layout |
| Docs (this README, `docs/`) | **Drafted with Claude** | Edited and checked against the test outputs |
| Research | Claude helped survey existing lunar illumination tools, published methods and mission records | Picked the challenge and the approach, and decided which claims to make |
| Data and numbers | **No SI-generated data.** Every number comes from the engine running on NASA LOLA terrain and NAIF SPICE geometry, checked against JPL Horizons, Gläser et al., NASA PGDA maps and mission reports | Kept failed or ambiguous cases visible (IM-1, IM-2, the C2 long-term statistics) instead of loosening thresholds |
| Images, video, audio | **No SI-generated images, video or audio.** The pole relief map is computed from NASA LOLA elevation data by `scripts/make_pole_hillshade.py` | Demo video recorded and narrated by the team |

No NASA logos, flags or mission insignia are used or generated anywhere in the project.

## Credits

Terrain: NASA LOLA / PGDA (Mazarico, Barker et al.), SLDEM2015 (Barker et al. 2016). Geometry: NAIF SPICE. Names: IAU Gazetteer of Planetary Nomenclature. Illumination reference: Gläser et al. 2014, 2018. Not an official NASA product.
