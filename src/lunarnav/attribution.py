"""Name the terrain that blocks the Sun / Earth.

Given a blocking sample (lat, lon) from the horizon ray, find the IAU feature it belongs
to (USGS Gazetteer of Planetary Nomenclature). A crater rim sample sits ~one radius from
the crater centre, so we test "within 1.15 x radius + 1 km" and prefer the smallest
enclosing feature (most specific); otherwise report the nearest named feature.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache

import numpy as np

from .ephem import MOON_RADIUS_KM, ROOT

GAZ = ROOT / "data" / "gazetteer" / "moon_features.json"

_TYPE_SHORT = {
    "Crater, craters": "crater",
    "Satellite Feature": "crater",
    "Mons, montes": "mountain",
    "Dorsum, dorsa": "ridge",
    "Rupes, rupes": "scarp",
    "Vallis, valles": "valley",
    "Promontorium, promontoria": "cape",
    "Mare, maria": "mare",
    "Rima, rimae": "rille",
    "Catena, catenae": "crater chain",
}


@lru_cache(maxsize=1)
def _table():
    # drop point-like names (statio, astronaut-named boulders) - they can't block a horizon
    rows = [r for r in json.loads(GAZ.read_text(encoding="utf-8")) if r["diam_km"] >= 1.0]
    lat = np.radians([r["lat"] for r in rows])
    lon = np.radians([r["lon"] for r in rows])
    xyz = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=1)
    diam = np.array([r["diam_km"] for r in rows])
    return rows, xyz, diam


def name_point(lat: float, lon: float) -> dict:
    rows, xyz, diam = _table()
    la, lo = math.radians(lat), math.radians(lon)
    p = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    d_km = np.arccos(np.clip(xyz @ p, -1, 1)) * MOON_RADIUS_KM
    radius = diam / 2
    inside = d_km <= 1.15 * radius + 1.0
    if inside.any():
        idx = np.flatnonzero(inside)
        i = int(idx[np.argmin(diam[idx])])
        r = rows[i]
        frac = d_km[i] / max(radius[i], 1e-6)
        kind = _TYPE_SHORT.get(r["type"], r["type"].split(",")[0].lower())
        if kind in ("crater", "crater chain"):
            rel = "rim of" if 0.7 <= frac <= 1.15 else ("floor of" if frac < 0.7 else "near")
        elif kind in ("mountain", "ridge", "cape", "scarp"):
            rel = "on"
        else:
            rel = "in"
    else:
        i = int(np.argmin(d_km - radius))
        r = rows[i]
        kind = _TYPE_SHORT.get(r["type"], r["type"].split(",")[0].lower())
        rel = "near"
    label = r["name"]
    if kind == "crater" and not label.lower().startswith(("mons", "montes")) and "crater" not in label.lower():
        label_full = f"{label} crater"
    else:
        label_full = label
    return {
        "feature": r["name"],
        "feature_type": kind,
        "relation": rel,
        "phrase": f"{rel} {label_full}",
        "feature_center_dist_km": round(float(d_km[i]), 1),
        "feature_diam_km": r["diam_km"],
    }


def describe_blocker(h, ray: int) -> dict:
    """Plain-language blocker description for horizon ray index `ray`."""
    lat, lon = float(h.block_lat[ray]), float(h.block_lon[ray])
    dist = float(h.block_dist_km[ray])
    n = name_point(lat, lon)
    if dist < 1.0:
        n["phrase"] = "local ground slope right at the site"
        n["local"] = True
    return {**n, "dist_km": round(dist, 2), "az_deg": float(h.az[ray]), "lat": round(lat, 5),
            "lon": round(lon, 5), "h_m": round(float(h.block_h_m[ray]), 1)}
