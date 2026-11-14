"""FastAPI backend for custom coordinates (M8).

    uvicorn lunarnav.api:app --port 8000

GET /health
GET /site?lat=-89.45&lon=222.84&mast=2      -> same shape as out/sites/<id>.json (one mast)
GET /horizon?lat=..&lon=..&mast=2           -> horizon only (fast)

Curated sites are static files; this endpoint exists for any user-typed point.
Terrain comes from cached clips when available (regional polar caches give ~1 s),
otherwise from remote LOLA reads (first request in a new region is slow; cached after).
"""
from __future__ import annotations

import os
import time
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .attribution import describe_blocker
from .dem import TerrainUnavailable, site_clips
from .events import grid_vectors, long_term_stats
from .horizon import compute_horizon
from .precompute import LONGTERM, TRACK_STEP_S, WINDOW, _event_list, _track, open_events

app = FastAPI(title="Lunar Landing Site Navigator engine", version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


@app.on_event("startup")
def warm():
    # pre-compute shared Sun/Earth vector grids once (~2-3 s), reused by every request
    for tgt in ("SUN", "EARTH"):
        grid_vectors(*LONGTERM, 3600.0, tgt)
        grid_vectors(*WINDOW, 600.0, tgt)
        grid_vectors(*WINDOW, TRACK_STEP_S, tgt)


def _check(lat, lon):
    if not -90 <= lat <= 90:
        raise HTTPException(422, "lat must be in [-90, 90]")
    if lat >= 60.0:
        # PGDA polar terrain products used here cover the south pole only; the north needs
        # the LOLA PDS LDEM_85N reader (STATUS.md, north-pole follow-up).
        raise HTTPException(422, "North polar region (lat >= 60) is not supported yet: "
                                 "the terrain model used here covers the south pole and latitudes 60S-60N.")
    return lat, lon % 360.0


# each entry also pins its terrain clips; Render free tier sets LUNARNAV_HORIZON_CACHE small
@lru_cache(maxsize=int(os.environ.get("LUNARNAV_HORIZON_CACHE", "256")))
def _horizon(lat: float, lon: float, mast: float):
    try:
        near, far, fk = site_clips(lat, lon, prefer_cached=True)
    except TerrainUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return compute_horizon(lat, lon, mast, near=near, far=far, far_km=fk), near, far, fk


@app.get("/health")
def health():
    return {"ok": True, "engine": __version__}


@app.get("/horizon")
def horizon(lat: float = Query(...), lon: float = Query(...), mast: float = Query(2.0, ge=0, le=50)):
    lat, lon = _check(lat, lon)
    t = time.time()
    h, near, *_ = _horizon(round(lat, 6), round(lon, 6), mast)
    return {**h.to_dict(), "degraded": getattr(near, "degraded", None), "compute_s": round(time.time() - t, 2)}


@app.get("/site")
def site(lat: float = Query(...), lon: float = Query(...), mast: float = Query(2.0, ge=0, le=50)):
    lat, lon = _check(lat, lon)
    t = time.time()
    h, near, far, fk = _horizon(round(lat, 6), round(lon, 6), mast)
    key = f"{mast:g}"
    ev = _event_list(h, *WINDOW, "SUN") + _event_list(h, *WINDOW, "EARTH")
    ev.sort(key=lambda e: e["utc"])
    return {
        "id": f"custom_{lat:.5f}_{lon:.5f}",
        "name": f"Custom point {lat:.4f}, {lon:.4f}",
        "group": "custom",
        "requested": {"lat": lat, "lon": lon},
        "snapped": {"lat": round(h.lat, 6), "lon": round(h.lon, 6), "ground_m": round(h.ground_m, 2)},
        "dem": {"near": near.source, "near_res_m": round(near.res_m, 2), "far": far.source,
                "far_res_m": round(far.res_m, 2), "far_km": fk,
                "degraded": getattr(near, "degraded", None)},
        "default_mast_m": mast,
        "horizons": {key: h.to_dict()},
        "longterm": {key: long_term_stats(h, *LONGTERM, 3600.0)},
        "window": {"start_utc": WINDOW[0], "stop_utc": WINDOW[1]},
        "events": {key: ev},
        "track": _track(h, WINDOW[0], WINDOW[1], TRACK_STEP_S),
        "open_events": open_events(h, *WINDOW),
        "sensitivity": None,
        "mission_replay": None,
        "meta": {"engine": f"lunarnav {__version__}", "compute_s": round(time.time() - t, 2)},
    }
