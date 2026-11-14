"""Countdown uncertainty from NASA's LDEM error clones (PGDA product 78, Barker et al. 2021).

Each clone is a 5 m/px LDEM realisation drawn from the LDEM error covariance. We rebuild
the horizon with clone k as the innermost terrain tier (+-2 km around the site), keep the
same 20 m / 240 m outer tiers, and recompute every Sun/Earth event. The spread across the
100 clones gives P10/P50/P90 event times and long-term percentages.

Scope (state it in the UI): this captures height error within ~2 km of the site, where
LOLA gaps and slope dominate. Error in distant ridges is not sampled by the clones.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .dem import Clip, site_clips
from .ephem import ROOT, azel_from_center, et_to_utc
from .events import disc_fraction, grid_vectors, site_of
from .horizon import compute_horizon_tiers

CLONE_DIR = ROOT / "data" / "dem" / "clones"
OUT = ROOT / "out" / "uncertainty"


def load_clones(path: Path):
    z = np.load(path)
    mk = lambda a, name: Clip(a, "stere_s", float(z["x0"]), float(z["y0"]), float(z["dx"]), float(z["dy"]),
                              float(z["dx"]), name)
    base = mk(z["surf"], "PGDA78 surf 5m")
    clones = [mk(z["clones"][k], f"PGDA78 clone {k + 1}") for k in range(z["clones"].shape[0])]
    return base, clones, float(z["lat"]), float(z["lon"])


def _crossings(et, val, kind_up, kind_down):
    """Linear-interpolated zero crossings of val(et) -> list of (kind, et)."""
    s = np.sign(val)
    idx = np.flatnonzero(s[:-1] * s[1:] < 0)
    out = []
    for i in idx:
        t = et[i] + (et[i + 1] - et[i]) * val[i] / (val[i] - val[i + 1])
        out.append((kind_up if val[i + 1] > 0 else kind_down, float(t)))
    return out


def events_fast(h, start, stop, step_s=300.0):
    ev = []
    for tgt in ("SUN", "EARTH"):
        et, V = grid_vectors(start, stop, step_s, tgt)
        g = azel_from_center(site_of(h), V, tgt)
        H = h.at(g["az"])
        ev += [(tgt.lower(), k, t) for k, t in _crossings(et, g["el"] + g["ang_radius"] - H, "first_light", "last_light")]
    return ev


def run(site_id: str, clone_file: Path, mast_m: float = 2.0, inner_km: float = 2.0,
        window=("2026-11-01T00:00:00", "2028-01-01T00:00:00"),
        longterm=("2017-01-01T00:00:00", "2035-08-08T00:00:00"), match_h: float = 72.0) -> dict:
    base, clones, lat, lon = load_clones(clone_file)
    near, far, far_km = site_clips(lat, lon)
    tiers = lambda inner: [(inner, inner_km), (near, 20.0), (far, far_km)]

    et_lt, V_lt = grid_vectors(*longterm, 3600.0, "SUN")

    def one(inner):
        h = compute_horizon_tiers(lat, lon, mast_m, tiers(inner))
        g = azel_from_center(site_of(h), V_lt, "SUN")
        f = disc_fraction(g["el"], h.at(g["az"]), g["ang_radius"])
        return h, events_fast(h, *window), float(f.mean() * 100), float((f > 0).mean() * 100)

    hb, ev_b, avg_b, vis_b = one(base)
    per_clone = [one(c) for c in clones]

    events = []
    for j, (tgt, kind, t) in enumerate(ev_b):
        # Match only inside this event's own slot: halfway to the neighbouring baseline events of the
        # same target (and at most match_h). Otherwise a flicker that vanishes in a clone would be
        # "matched" to the previous/next real sunrise days away.
        same = [tt for (g, _, tt) in ev_b if g == tgt]
        k = same.index(t)
        lo = max(t - match_h * 3600, (same[k - 1] + t) / 2 if k > 0 else -np.inf)
        hi = min(t + match_h * 3600, (same[k + 1] + t) / 2 if k + 1 < len(same) else np.inf)
        offs = []
        for _, ev_c, _, _ in per_clone:
            cand = [tc for (g2, k2, tc) in ev_c if g2 == tgt and k2 == kind and lo <= tc <= hi]
            if cand:
                offs.append(min(cand, key=lambda x: abs(x - t)) - t)
        offs = np.array(offs)
        q = np.percentile(offs, [10, 50, 90]) if offs.size else [np.nan] * 3
        events.append({
            "target": tgt, "kind": kind, "utc": et_to_utc(t),
            "p10_utc": et_to_utc(t + q[0]) if offs.size else None,
            "p50_utc": et_to_utc(t + q[1]) if offs.size else None,
            "p90_utc": et_to_utc(t + q[2]) if offs.size else None,
            "spread_p10_p90_h": round(float((q[2] - q[0]) / 3600), 2) if offs.size else None,
            "n_clones_matched": int(offs.size),
            "present_frac": round(offs.size / len(clones), 2),  # < 1: event absent in some clones (fragile flicker)
        })
    avgs = np.array([p[2] for p in per_clone])
    viss = np.array([p[3] for p in per_clone])
    res = {
        "site_id": site_id, "lat": lat, "lon": lon, "mast_m": mast_m, "n_clones": len(clones),
        "inner_km": inner_km, "window": list(window),
        "method": ("PGDA product 78 LDEM clones (Barker et al. 2021, PSS 203:105119) as the innermost 5 m "
                   "terrain tier within +-2 km; outer tiers unchanged. Each clone event is matched to "
                   "the baseline event of the same kind inside that event's own slot (halfway to the neighbouring "
                   "baseline events, max 72 h); percentiles over matched clones; present_frac = share of clones "
                   "in which the event exists at all."),
        "scope_note": "Captures height error within ~2 km of the site; distant-ridge error is not sampled.",
        "events": events,
        "longterm_sun": {
            "baseline_avg_pct": round(avg_b, 2), "baseline_vis_pct": round(vis_b, 2),
            "avg_p10_p50_p90": [round(float(x), 2) for x in np.percentile(avgs, [10, 50, 90])],
            "vis_p10_p50_p90": [round(float(x), 2) for x in np.percentile(viss, [10, 50, 90])],
            "period": list(longterm),
        },
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{site_id}.json").write_text(json.dumps(res, indent=1))
    return res
