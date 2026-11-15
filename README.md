# Lunar Landing Site Navigator

Terrain-aware Sun and Earth visibility for lunar landing sites. For a given site, the engine computes the terrain sunset and Earth-set times, identifies the ridge that causes each one, and estimates the timing uncertainty from NASA's DEM error clones.

NASA Space Apps 2026 · challenge *Lunar Landing Site Navigator* · team Purple Haze (Surat, India) · MIT licence

| | |
|---|---|
| Demo video (30 s) | https://youtu.be/RbIx5fHE18Y |
| Dashboard | https://lunar-navigator-omega.vercel.app |
| Engine API | https://lunar-navigator-api.vercel.app (`/health`, `/horizon`, `/site`) |
| Example | [Connecting Ridge C2, 14 Nov 2026](https://lunar-navigator-omega.vercel.app/#/site?site=connecting_ridge_c2&t=2026-11-14T07:30Z): terrain sunset 08:26 UTC behind a ridge near Henson crater |

## Architecture

```
NAIF SPICE kernels ──► ephem.py ──────────┐
                                          ├─► events.py ──► precompute.py ──► out/sites/*.json ──► dashboard (React, static)
PGDA LOLA / SLDEM2015 ──► dem.py ──► horizon.py ┘      ▲            │
   (HTTP range reads, clip cache)       │              │            └──► api.py (FastAPI, custom points) ──► dashboard
                                        ├─► attribution.py (IAU gazetteer)
PGDA DEM error clones ──► uncertainty.py┘
JPL Horizons, PGDA maps, mission records ──► tests/ ──► out/validation_report.json ──► Evidence tab
```

The engine (`src/lunarnav/`) does all the science. Results for the 23 curated sites are precomputed into static JSON, so the dashboard needs no backend to show them. Custom coordinates go to the FastAPI service, which returns the same per-site schema. The schema is defined in [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md).

## Engine pipeline

### 1. Geometry (`ephem.py`)
- SpiceyPy with `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `pck00011.tpc` and `naif0012.tls`.
- Everything is in the **`MOON_ME`** frame, the same frame as the LOLA DEMs and Horizons site coordinates. Using `MOON_PA` instead would shift sites by about 875 m.
- Positions are apparent site-to-target vectors with **`CN+S`** aberration correction, converted to azimuth (clockwise from north), elevation (relative to the sphere normal) and angular radius.
- Heights are in metres above the 1737.4 km reference sphere.
- An independent path through SPICE `azlcpo` serves as a cross-check.

### 2. Terrain access (`dem.py`)
- **Polar sites (|lat| ≥ 60°):** PGDA product 90 polar-stereographic Cloud-Optimized GeoTIFFs (10/20/30/60 m), read with rasterio/GDAL windowed range requests.
  - Near field: ±20 km at about 20 m.
  - Far field: ±200 km for |lat| ≥ 75°, otherwise ±150 km, at 240 m. This uses the 60 m product's 4× overview, which is the cheapest read.
- **Non-polar sites:** SLDEM2015 PDS float tiles (512 ppd near field, 128 ppd global far field to 100 km). Only the needed column span of each row is fetched, using parallel HTTP `Range` requests.
- Clips are cached as `.npz` files with memory-mapped sidecars, because the source servers deliver about 200 KB/s per connection.
- If PGDA refuses the host (as it did with Vercel/AWS IPs on 13 Nov), the code falls back to the finest bundled 240 m clip and flags the result as degraded. If no cached clip covers the point, it raises `TerrainUnavailable`, which the API returns as HTTP 503.

### 3. Horizon mask (`horizon.py`)
- **720 azimuth rays at 0.5° spacing.** Each ray marches along the great circle out of the site.
- The terrain is split into tiers at different resolutions, finest first. Each tier is sampled at its own resolution, and NaN holes are filled from coarser tiers.
- For every sample the code computes the exact 3D elevation angle as seen from the observer. Lunar curvature is included and no small-angle approximation is made.
- `H(az)` is the maximum along each ray. The code also stores the sample that produced it (distance, lat/lon, height), which is what makes ridge attribution possible.
- The observer snaps to the centre of the nearest near-field pixel, plus a mast height (0, 2 or 10 m).

### 4. Visibility and events (`events.py`)
- **Visible fraction:** a circular-segment area of the Sun or Earth disc above `H(az)`, treating the horizon as locally flat across the disc (≤ 2° wide):
  `f = 1 − (acos d − d·√(1−d²)) / π`, with `d = clip((el − H) / r, −1, 1)`
- **Events:** zero crossings of `g(t) = el(t) + k·r(t) − H(az(t))`.
  - `k = +1` gives first and last light (upper limb); `k = −1` gives the full disc.
  - The code scans on a 600 s grid, then refines each crossing with `scipy.optimize.brentq` (`xtol` = 0.5 s).
- **Long-term statistics** come from an hourly series over 2017–2035, one 18.6-year nodal cycle: average illumination, % of time the Sun is visible, Earth visibility, and the longest dark and lit runs. The definitions match Gläser et al. 2018 and Mazarico et al. 2011.
- **Open-horizon baseline:** the same events computed against a flat 0° horizon, which is what a tool without terrain would report. It is used to measure the terrain effect at each site.

### 5. Uncertainty (`uncertainty.py`)
- Uses 100 realisations of the LDEM error model (PGDA product 78, 5 m/px, Barker et al. 2021).
- Each clone replaces the innermost terrain tier (±2 km around the site); the 20 m and 240 m outer tiers stay the same. The code rebuilds the horizon and recomputes every event, giving **P10/P50/P90 event times** and percentiles for the long-term statistics.
- Scope: this covers only height error near the site. Error in distant ridges is not sampled.
- Uncertainty is currently computed for Shackleton rim and Connecting Ridge C1.

### 6. Attribution and local scan
- `attribution.py`: maps the blocking sample to an IAU Gazetteer feature. A sample matches a feature when it lies within 1.15 × radius + 1 km of its centre, and the smallest matching feature wins; otherwise the nearest named feature is used. Output example: "near Henson crater, 8.1 km, az 236°".
- `sensitivity.py`: re-evaluates every DEM pixel within ±3 px of the site using shared Sun vectors, and reports the best-lit nearby pixel with its distance, bearing and gain.

### 7. Precompute (`precompute.py`, `scripts/precompute.py`)
For each site and each mast height (0, 2, 10 m) the precompute step writes:
- the horizon with blocker metadata;
- the event list for 2026-11-01 → 2028-01-01;
- a 3-hourly Sun and Earth track;
- the long-term statistics;
- the open-horizon events;
- for mission sites, a 30-minute replay track.

To keep the files small, arrays are stored as integers (centi-degrees, milli-degrees, per-mille).

## API (`src/lunarnav/api.py`)

| Endpoint | Returns |
|---|---|
| `GET /health` | `{ok, engine}` liveness check (the dashboard calls it on load to pre-warm the function) |
| `GET /horizon?lat=&lon=&mast=` | horizon mask only (fast) |
| `GET /site?lat=&lon=&mast=` | full per-site payload, same schema as `out/sites/<id>.json` |

- Input checks: `lat ∈ [−90, 90]`, otherwise 422. `lat ≥ 60` (north polar) also returns 422, because it isn't supported yet. Longitude is normalised to 0–360.
- Horizons are memoised with `lru_cache(256)`.
- It is deployed as a Vercel Python function with a bundled regional 240 m clip. The build is `scripts/build_vercel_api.py`; see [`docs/DEPLOY_API.md`](docs/DEPLOY_API.md).

## Dashboard (`dashboard/`)

- Built with React 18.3, TypeScript 5.6 and Vite 5.4, and deployed as a static site on Vercel.
- `npm run sync-data` copies `out/` into `public/data/`.
- No ephemeris runs in the browser. `lib/astro.ts` interpolates the engine's 3-hourly track, takes event times from the engine's refined list, and re-evaluates the visible fraction against the horizon for the selected mast height.
- Views:
  - `SiteView`: horizon panorama, countdown, ridge attribution, P10–P90 band, timeline.
  - `CompareView`: up to four sites on one clock.
  - `MissionsView`: animated predicted-vs-actual mission replays.
  - `EvidenceView`: renders `validation_report.json`.
  - `SitesView`: polar locator.
- The pole relief map is a hillshade computed from LOLA data by `scripts/make_pole_hillshade.py`.

## Validation (`tests/`, 24 tests)

| Test | Reference | Result |
|---|---|---|
| T1 Sun/Earth directions | JPL Horizons observer tables, 1,638 epochs | max error 0.0019″ |
| T3 long-term illumination | Gläser et al. 2018 (20 m) | Shackleton 80.2 % / 84.7 % / 219 h vs 81.0 / 85.5 / 221 |
| T4 mast height | Gläser 2018 / 2014 | C1 73.9 → 85.6 → 92.5 % at 0 / 2 / 10 m |
| T5 spatial illumination, 60 points | NASA PGDA product 69 (85°S AVGVISIB) | Sun RMSE 2.84 pp (MAE 1.88), Earth RMSE 0.84 pp |
| T6 mission endings | mission records | Chandrayaan-3 put to sleep 4.7 h before predicted terrain sunset; flat horizon would be 10.4 h later still. Blue Ghost 1 dark 4.6 h after predicted sunset (≈5 h battery) |
| T7 negative controls | mission records | IM-1 and IM-2 ended with sunlight remaining (attitude/power), so they are not claimed |
| T2 terrain sunset | LROC QuickMap | reported, not scored (QuickMap uses 4 h steps and a different local ridge) |
| API | `test_api_input.py`, `test_api_fallback.py` | input validation, 422/503 paths, degraded fallback |

Results go to `out/validation_report.json`, which `report.record()` merges so that partial runs keep earlier results. The dashboard's Evidence tab reads this file.

## Run locally

```bash
# engine (Python ≥ 3.13, uv)
uv sync
.venv/Scripts/python scripts/fetch_runtime_data.py      # SPICE kernels + regional terrain clips (one-off)
.venv/Scripts/python -m pytest -q                       # validation suite
.venv/Scripts/python scripts/precompute.py              # rebuild out/sites/*.json
.venv/Scripts/python -m uvicorn lunarnav.api:app --app-dir src --port 8765

# dashboard (Node ≥ 20)
cd dashboard && npm install && npm run sync-data && npm run dev
```

Python dependencies: spiceypy, numpy, scipy, rasterio (GDAL), pyproj, requests, FastAPI, uvicorn. Dev dependencies: pytest, httpx.

## Repository layout

```
src/lunarnav/     engine: ephem, dem, horizon, events, uncertainty, attribution, sensitivity, precompute, api, report
scripts/          data fetch (kernels, clones, Horizons), gazetteer + Artemis region builders, precompute, API bundle, hillshade
tests/            validation suite T1–T8 + API tests
data/             gazetteer, Artemis III regions, cached Horizons tables (kernels + DEM clips fetched, gitignored)
out/              precomputed site JSON, uncertainty results, validation report
dashboard/        React/TypeScript front end
docs/             DATA_CONTRACT.md (engine → dashboard schema), DEPLOY_API.md
```

## Data sources

- **NASA PGDA LOLA DEMs:** product 90 (south-pole 10–60 m), product 78 (DEM error clones) and product 69 (illumination maps, used for validation).
- **SLDEM2015** (LOLA + Kaguya, Barker et al. 2016) for latitudes 60°S–60°N.
- **NAIF SPICE:** DE440 and Moon PA/ME frames.
- **JPL Horizons:** ground truth for T1.
- **LROC QuickMap and NASA Moon Trek:** cross-check (T2) and deep links from each site page.
- **USGS/NASA Artemis III candidate regions:** 6 of 9 regions, each represented by its best-lit point with slope ≤ 8°.
- **IAU Gazetteer of Planetary Nomenclature:** feature names for ridge attribution.

## Limits

- The north polar region (lat ≥ 60°N) is not supported.
- Only Shackleton rim and Connecting Ridge C1 have uncertainty bands. They cover near-site DEM error only.
- Lander attitude and solar-panel geometry are not modelled (this is why IM-1 and IM-2 are not claimed).
- If PGDA is unreachable, custom polar points use the bundled 240 m terrain, and the response is flagged as degraded.

## Use of Super Intelligence (SI) tools

We used Anthropic's Claude (Claude Code) to help write the code, the docs and the demo-video editing scripts. We chose the method and the validation tests ourselves. Every number comes from the engine running on NASA data, not from the AI.

No NASA logos, flags or mission insignia are used or generated anywhere in the project.

## Credits

Terrain: NASA LOLA / PGDA (Mazarico, Barker et al.), SLDEM2015 (Barker et al. 2016). Geometry: NAIF SPICE. Names: IAU Gazetteer of Planetary Nomenclature. Illumination reference: Gläser et al. 2014, 2018. Not an official NASA product.
