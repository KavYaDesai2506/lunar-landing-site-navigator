"""Illumination / Earth-visibility time series, events and long-term statistics.

Definitions (match Gläser et al. 2018 / Mazarico et al. 2011):
* visible fraction f(t): fraction of the target's disc above the terrain horizon,
  treating the horizon as locally flat across the disc (disc <= 2 deg wide).
* average illumination  = mean f(t)                      (Sun)
* solar visibility      = % of time f(t) > 0             (any part of the Sun)
* max shadow            = longest continuous run with f == 0, hours
Events are zero crossings of g(t) = el(t) + k*r(t) - H(az(t)), k = +1 for first/last
light (upper limb), -1 for full disc, refined with Brent's method to ~1 s.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import brentq

from .ephem import Site, azel, azel_from_center, center_vectors, et_range, et_to_utc
from .horizon import Horizon


def disc_fraction(el, H, r) -> np.ndarray:
    """Area fraction of a disc of angular radius r (deg) centred at elevation el above a
    horizontal line at elevation H."""
    d = np.clip((np.asarray(el) - np.asarray(H)) / np.asarray(r), -1.0, 1.0)
    return 1.0 - (np.arccos(d) - d * np.sqrt(1.0 - d * d)) / np.pi


def site_of(h: Horizon) -> Site:
    # observer position for ephemeris: DEM ground + mast (parallax of a few km is << 1")
    return Site(h.lat, h.lon, h.ground_m + h.mast_m)


_VCACHE: dict = {}


def grid_vectors(start_utc: str, stop_utc: str, step_s: float, target: str):
    """(et, centre->target vectors) for a time grid, memoised (shared by all sites)."""
    key = (start_utc, stop_utc, float(step_s), target.upper())
    if key not in _VCACHE:
        et = et_range(start_utc, stop_utc, step_s)
        _VCACHE[key] = (et, center_vectors(et, target))
    return _VCACHE[key]


def series(h: Horizon, et: np.ndarray, target: str = "SUN", V: np.ndarray | None = None) -> dict:
    g = azel(site_of(h), et, target) if V is None else azel_from_center(site_of(h), V, target)
    Hz = h.at(g["az"])
    f = disc_fraction(g["el"], Hz, g["ang_radius"])
    return {**g, "horizon": Hz, "frac": f, "et": np.asarray(et)}


def _longest_run(mask: np.ndarray) -> int:
    if not mask.any():
        return 0
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    return int((ends - starts).max())


def long_term_stats(h: Horizon, start_utc: str, stop_utc: str, step_s: float = 3600.0,
                    targets=("SUN", "EARTH")) -> dict:
    out = {"start_utc": start_utc, "stop_utc": stop_utc, "step_s": step_s}
    fr = {}
    for t in targets:
        et, V = grid_vectors(start_utc, stop_utc, step_s, t)
        out["n"] = int(et.size)
        f = fr[t] = series(h, et, t, V)["frac"]
        key = t.lower()
        out[key] = {
            "avg_fraction_pct": float(f.mean() * 100),
            "any_visible_pct": float((f > 0).mean() * 100),
            "full_disc_pct": float((f >= 0.999999).mean() * 100),
            "max_dark_h": _longest_run(f <= 0) * step_s / 3600.0,
            "max_lit_h": _longest_run(f > 0) * step_s / 3600.0,
        }
    out["both_any_pct"] = None
    if set(targets) >= {"SUN", "EARTH"}:
        out["both_any_pct"] = float(((fr["SUN"] > 0) & (fr["EARTH"] > 0)).mean() * 100)
    return out


@dataclass
class Event:
    target: str
    kind: str  # "first_light" | "full_disc" | "partial_after_full" | "last_light"
    et: float
    az: float
    el: float  # geometric apparent elevation of disc centre
    horizon_el: float
    ray: int  # nearest horizon ray index (for attribution)

    def to_dict(self, h: Horizon) -> dict:
        return {
            "target": self.target.lower(),
            "kind": self.kind,
            "utc": et_to_utc(self.et),
            "az_deg": round(self.az, 3),
            "el_deg": round(self.el, 4),
            "horizon_el_deg": round(self.horizon_el, 4),
            "blocker": {
                "dist_km": round(float(h.block_dist_km[self.ray]), 2),
                "lat": round(float(h.block_lat[self.ray]), 5),
                "lon": round(float(h.block_lon[self.ray]), 5),
                "h_m": round(float(h.block_h_m[self.ray]), 1),
            },
        }


def find_events(h: Horizon, start_utc: str, stop_utc: str, target: str = "SUN",
                step_s: float = 600.0) -> list[Event]:
    """All rise/set events of the upper limb (first/last light) and lower limb (full disc
    gained/lost) of the target over the terrain horizon in [start, stop]."""
    site = site_of(h)
    et, V = grid_vectors(start_utc, stop_utc, step_s, target)  # coarse scan: cached vectors
    g = azel_from_center(site, V, target)
    Hz = h.at(g["az"])
    events: list[Event] = []
    for k, (up_kind, down_kind) in ((+1, ("first_light", "last_light")), (-1, ("full_disc", "partial"))):
        val = g["el"] + k * g["ang_radius"] - Hz
        s = np.sign(val)
        idx = np.flatnonzero(s[:-1] * s[1:] < 0)

        def geom(t):  # same model as the coarse scan, so bracket signs are consistent
            return azel_from_center(site, center_vectors(np.array([t]), target), target)

        def fn(t, k=k):
            r = geom(t)
            return float(r["el"][0] + k * r["ang_radius"][0] - h.at(r["az"][0]))

        for i in idx:
            t0 = brentq(fn, et[i], et[i + 1], xtol=0.5)
            r = geom(t0)
            kind = up_kind if val[i + 1] > 0 else down_kind
            events.append(Event(target, kind, t0, float(r["az"][0]), float(r["el"][0]),
                                float(h.at(r["az"][0])), int(h.nearest_ray(r["az"][0]))))
    events.sort(key=lambda e: e.et)
    return events
