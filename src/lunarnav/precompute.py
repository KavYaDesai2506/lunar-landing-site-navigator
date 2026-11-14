"""Precompute static per-site JSON for the dashboard (see docs/DATA_CONTRACT.md).

out/sites/index.json        catalogue + headline numbers
out/sites/<id>.json          full payload for one site
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import __version__
from .attribution import describe_blocker
from .dem import site_clips
from .ephem import ROOT, azel_from_center, et_to_utc, spice_version
from .events import disc_fraction, find_events, grid_vectors, long_term_stats, site_of
from .horizon import compute_horizon
from .sensitivity import local_scan
from .sites import BY_ID, CATALOGUE

OUT = ROOT / "out" / "sites"
MASTS = (0.0, 2.0, 10.0)
DEFAULT_MAST = 2.0
WINDOW = ("2026-11-01T00:00:00", "2028-01-01T00:00:00")
TRACK_STEP_S = 10800.0  # 3 h; the dashboard interpolates, exact times come from events
REPLAY_STEP_S = 1800.0  # 30 min track inside mission_replay (animation)...
REPLAY_MAX_N = 3000  # ...coarsened in 30-min multiples for long missions (SLIM: 1 h)
LONGTERM = ("2017-01-01T00:00:00", "2035-08-08T00:00:00")  # ~18.6-yr nutation cycle


def _ints(a, scale):
    return np.rint(np.asarray(a) * scale).astype(int).tolist()


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def _event_list(h, start, stop, target, blockers: bool = True):
    out = []
    for e in find_events(h, start, stop, target, step_s=600.0):
        d = e.to_dict(h)
        if blockers:
            b = describe_blocker(h, e.ray)
            d["blocker"] = {k: b[k] for k in ("phrase", "feature", "dist_km", "az_deg", "lat", "lon", "h_m")}
        else:
            d.pop("blocker")
        out.append(d)
    return out


def _track(h, start, stop, step):
    tr = {"start_utc": start, "step_s": step}
    for tgt in ("SUN", "EARTH"):
        et, V = grid_vectors(start, stop, step, tgt)
        g = azel_from_center(site_of(h), V, tgt)
        f = disc_fraction(g["el"], h.at(g["az"]), g["ang_radius"])
        tr[tgt.lower()] = {
            "az_cdeg": _ints(g["az"], 100),  # centi-degrees
            "el_mdeg": _ints(g["el"], 1000),  # milli-degrees
            "frac_pm": _ints(f, 1000),  # per-mille of disc visible
            "ang_radius_deg": round(float(np.mean(g["ang_radius"])), 4),
        }
    tr["n"] = len(tr["sun"]["az_cdeg"])
    return tr


def open_horizon(h):
    """The same site with a flat 0 deg horizon: what a tool without terrain assumes."""
    return replace(h, el=np.zeros_like(h.el))


def open_events(h, start, stop) -> list[dict]:
    """Sun/Earth events against the 0 deg open horizon (no terrain), same fields as `events`
    minus `blocker`. Lets the dashboard say "terrain ends the light X h before the open horizon"."""
    ho = open_horizon(h)
    ev = _event_list(ho, start, stop, "SUN", blockers=False) + _event_list(ho, start, stop, "EARTH", blockers=False)
    ev.sort(key=lambda e: e["utc"])
    return ev


def _first_after(ev, target, kind, t):
    return next((e for e in ev if e["target"] == target and e["kind"] == kind and e["utc"] >= t), None)


def replay_extras(m: dict, h, start: str, stop: str) -> dict:
    """Open-horizon comparison + a 30-min track for the animated mission replay."""
    oev = open_events(h, start, stop)
    o_set = _first_after(oev, "sun", "last_light", m["landed_utc"])
    return {
        "open_events": oev,
        "first_open_sunset_after_landing": o_set,
        "track": _track(h, start, stop, _replay_step(start, stop)),
    }


def _replay_step(start: str, stop: str) -> float:
    span = (datetime.fromisoformat(stop) - datetime.fromisoformat(start)).total_seconds()
    return REPLAY_STEP_S * max(1, math.ceil(span / REPLAY_STEP_S / REPLAY_MAX_N))


def _clearance(h, utc: str) -> dict:
    out = {}
    for tgt in ("SUN", "EARTH"):
        _, V = grid_vectors(utc, utc, 60.0, tgt)
        g = azel_from_center(site_of(h), V, tgt)
        out[tgt] = round(float(g["el"][0] - h.at(g["az"])[0]), 3)
    return out


def mission_replay(site: dict, h) -> dict | None:
    m = site.get("mission")
    if not m:
        return None
    landed = datetime.fromisoformat(m["landed_utc"])
    end = datetime.fromisoformat(m["end_utc"])
    start, stop = _iso(landed - timedelta(days=1)), _iso(end + timedelta(days=20))
    ev = _event_list(h, start, stop, "SUN") + _event_list(h, start, stop, "EARTH")
    ev.sort(key=lambda e: e["utc"])
    sun_last = [e for e in ev if e["target"] == "sun" and e["kind"] == "last_light"]
    sun_first = [e for e in ev if e["target"] == "sun" and e["kind"] == "first_light"]
    after_land = [e for e in sun_last if e["utc"] >= m["landed_utc"]]
    first_sunset = after_land[0] if after_land else None
    # sunlight status at the reported end of mission
    et, V = grid_vectors(m["end_utc"], m["end_utc"], 60.0, "SUN")
    g = azel_from_center(site_of(h), V, "SUN")
    frac_end = float(disc_fraction(g["el"], h.at(g["az"]), g["ang_radius"])[0])
    clear = {k: _clearance(h, m[k]) for k in ("landed_utc", "end_utc")}
    gap_h = None
    if first_sunset:
        t_sun = datetime.fromisoformat(first_sunset["utc"].rstrip("Z"))
        gap_h = round((end - t_sun).total_seconds() / 3600.0, 1)
    return {
        **m,
        "window": [start, stop],
        "events": ev,
        "first_terrain_sunset_after_landing": first_sunset,
        "sun_frac_at_end": round(frac_end, 3),
        "end_minus_sunset_h": gap_h,
        "sunrises_after_landing": [e["utc"] for e in sun_first if e["utc"] >= m["landed_utc"]],
        # Sun / Earth centre height above the terrain horizon (deg) at landing and at the end
        "sun_clearance_deg_at": {k[:-4]: v["SUN"] for k, v in clear.items()},
        "earth_clearance_deg_at": {k[:-4]: v["EARTH"] for k, v in clear.items()},
        **replay_extras(m, h, start, stop),
    }


def build_site(site: dict, scan: bool = True) -> dict:
    t0 = time.time()
    near, far, far_km = site_clips(site["lat"], site["lon"])
    hs = {m: compute_horizon(site["lat"], site["lon"], m, near=near, far=far, far_km=far_km) for m in MASTS}
    h = hs[DEFAULT_MAST]
    horizons = {}
    for m, hm in hs.items():
        d = hm.to_dict()
        if m != DEFAULT_MAST:  # blocker detail only for the default mast (size)
            for k in ("block_dist_km", "block_lat", "block_lon", "block_h_m"):
                d.pop(k)
        horizons[f"{m:g}"] = d
    longterm = {f"{m:g}": long_term_stats(hm, *LONGTERM, 3600.0) for m, hm in hs.items()}
    events = {f"{m:g}": _event_list(hm, *WINDOW, "SUN", m == DEFAULT_MAST) + _event_list(hm, *WINDOW, "EARTH", m == DEFAULT_MAST)
              for m, hm in hs.items()}
    for v in events.values():
        v.sort(key=lambda e: e["utc"])
    sens = None
    if scan and abs(site["lat"]) >= 75:
        s = local_scan(site["lat"], site["lon"], radius_px=4, mast_m=DEFAULT_MAST, near=near, far=far,
                       far_km=far_km, start_utc=LONGTERM[0], stop_utc=LONGTERM[1])
        sens = {"centre": s["centre"], "best": s["best"], "res_m": s["res_m"], "radius_px": s["radius_px"],
                "gain_pp": round(s["best"]["avg_pct"] - s["centre"]["avg_pct"], 2),
                "cells": [{k: c[k] for k in ("dr", "dc", "avg_pct", "vis_pct")} for c in s["cells"]]}
    payload = {
        "id": site["id"],
        "name": site["name"],
        "group": site["group"],
        "country": site.get("country"),
        "note": site.get("note"),
        "requested": {"lat": site["lat"], "lon": site["lon"]},
        "snapped": {"lat": round(h.lat, 6), "lon": round(h.lon, 6), "ground_m": round(h.ground_m, 2)},
        "source": site.get("source"),
        "region": site.get("region"),  # Artemis III: LGRS box + search result (else null)
        "dem": {"near": near.source, "near_res_m": round(near.res_m, 2), "far": far.source,
                "far_res_m": round(far.res_m, 2), "far_km": far_km},
        "default_mast_m": DEFAULT_MAST,
        "horizons": horizons,
        "longterm": longterm,
        "window": {"start_utc": WINDOW[0], "stop_utc": WINDOW[1]},
        "events": events,
        "track": _track(h, WINDOW[0], WINDOW[1], TRACK_STEP_S),
        "open_events": open_events(h, *WINDOW),
        "sensitivity": sens,
        "mission_replay": mission_replay(site, h),
        "meta": {"engine": f"lunarnav {__version__}", "spice": spice_version(),
                 "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "build_s": None},
    }
    payload["meta"]["build_s"] = round(time.time() - t0, 1)
    return payload


def headline(p: dict) -> dict:
    lt = p["longterm"][f"{DEFAULT_MAST:g}"]
    return {
        "id": p["id"], "name": p["name"], "group": p["group"], "country": p.get("country"),
        "lat": p["requested"]["lat"], "lon": p["requested"]["lon"],
        "sun_avg_pct": round(lt["sun"]["avg_fraction_pct"], 1),
        "sun_any_pct": round(lt["sun"]["any_visible_pct"], 1),
        "earth_any_pct": round(lt["earth"]["any_visible_pct"], 1),
        "both_pct": round(lt["both_any_pct"], 1),
        "max_dark_h": lt["sun"]["max_dark_h"],
        # far side = Earth never clears the *open* horizon (geometry); terrain-blocked is a separate state
        "far_side": max(p["track"]["earth"]["el_mdeg"]) / 1000 + p["track"]["earth"]["ang_radius_deg"] < 0,
        "earth_blocked_by_terrain": lt["earth"]["any_visible_pct"] == 0.0
        and max(p["track"]["earth"]["el_mdeg"]) / 1000 + p["track"]["earth"]["ang_radius_deg"] >= 0,
        "has_mission": p["mission_replay"] is not None,
        "has_uncertainty": p.get("uncertainty") is not None,
    }


UNC = ROOT / "out" / "uncertainty"


def attach_uncertainty(p: dict) -> dict:
    """Merge out/uncertainty/<id>.json (built by lunarnav.uncertainty.run) into a site payload."""
    f = UNC / f"{p['id']}.json"
    p["uncertainty"] = json.loads(f.read_text()) if f.exists() else None
    return p


def main(ids: list[str] | None = None, scan: bool = True, merge_only: bool = False):
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [] if merge_only else ([BY_ID[i] for i in ids] if ids else CATALOGUE)
    for s in todo:
        try:
            p = build_site(s, scan=scan)
        except Exception as e:  # keep going; report at the end
            print(f"[FAIL] {s['id']}: {e!r}")
            continue
        (OUT / f"{s['id']}.json").write_text(json.dumps(p, separators=(",", ":")))
        kb = (OUT / f"{s['id']}.json").stat().st_size / 1024
        print(f"[ok] {s['id']:22s} {kb:7.1f} KB  {p['meta']['build_s']} s")
    index = []
    for s in CATALOGUE:
        f = OUT / f"{s['id']}.json"
        if f.exists():
            p = attach_uncertainty(json.loads(f.read_text()))
            f.write_text(json.dumps(p, separators=(",", ":")))
            index.append(headline(p))
    (OUT / "index.json").write_text(json.dumps({"sites": index, "generated_utc":
                                                datetime.now(timezone.utc).isoformat(timespec="seconds")}, indent=1))
    print("index:", len(index), "sites")
