"""Local sensitivity: "move N m to gain X% light".

Polar illumination changes over tens of metres (Gläser: the best-lit spots are
20-40 m wide). We evaluate every DEM pixel within a radius of the site, reusing one
set of Sun/Earth vectors, and report the gradient-like answer: where is the best pixel,
how far, which bearing, and what it gains.
"""
from __future__ import annotations

import math

import numpy as np

from .dem import Clip, site_clips
from .ephem import MOON_RADIUS_KM
from .events import disc_fraction, grid_vectors, site_of
from .ephem import azel_from_center
from .horizon import compute_horizon


def _bearing_dist(lat0, lon0, lat1, lon1):
    """Great-circle initial bearing (deg from N) and distance (m) on the lunar sphere."""
    p0, p1 = math.radians(lat0), math.radians(lat1)
    dl = math.radians(lon1 - lon0)
    x = math.sin(dl) * math.cos(p1)
    y = math.cos(p0) * math.sin(p1) - math.sin(p0) * math.cos(p1) * math.cos(dl)
    c = math.sin(p0) * math.sin(p1) + math.cos(p0) * math.cos(p1) * math.cos(dl)
    d = math.acos(max(-1.0, min(1.0, c))) * MOON_RADIUS_KM * 1000
    return math.degrees(math.atan2(x, y)) % 360.0, d


def local_scan(lat: float, lon: float, radius_px: int = 3, mast_m: float = 0.0,
               start_utc: str = "2017-01-01T00:00:00", stop_utc: str = "2037-01-01T00:00:00",
               step_s: float = 3600.0, near: Clip | None = None, far: Clip | None = None,
               far_km: float | None = None) -> dict:
    if near is None or far is None:
        near, far, far_km = site_clips(lat, lon)
    et, V = grid_vectors(start_utc, stop_utc, step_s, "SUN")
    r0, c0 = near.pixel_index(lon, lat)
    lat0, lon0, _ = near.pixel_center(r0, c0)
    cells = []
    for dr in range(-radius_px, radius_px + 1):
        for dc in range(-radius_px, radius_px + 1):
            if dr * dr + dc * dc > radius_px * radius_px + 0.5:
                continue
            la, lo, gh = near.pixel_center(r0 + dr, c0 + dc)
            h = compute_horizon(la, lo, mast_m, near=near, far=far, far_km=far_km, ground_m=gh, snap=False)
            g = azel_from_center(site_of(h), V, "SUN")
            f = disc_fraction(g["el"], h.at(g["az"]), g["ang_radius"])
            brg, dist = _bearing_dist(lat0, lon0, la, lo)
            cells.append({"dr": dr, "dc": dc, "lat": round(la, 6), "lon": round(lo, 6), "ground_m": round(gh, 2),
                          "avg_pct": float(f.mean() * 100), "vis_pct": float((f > 0).mean() * 100),
                          "bearing_deg": round(brg, 1), "dist_m": round(dist, 1)})
    centre = next(c for c in cells if c["dr"] == 0 and c["dc"] == 0)
    best = max(cells, key=lambda c: c["avg_pct"])
    return {"centre": centre, "best": best, "cells": cells, "res_m": near.res_m, "radius_px": radius_px,
            "period": [start_utc, stop_utc, step_s]}
