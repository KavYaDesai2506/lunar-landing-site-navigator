"""Parse cached JPL Horizons observer tables (QUANTITIES=4, CSV, DEG)."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np

from .ephem import ROOT

CACHE = ROOT / "data" / "horizons_cache"


def load_case(case_id: str) -> dict:
    d = json.loads((CACHE / f"{case_id}.json").read_text())
    res = d["result"]
    body = res[res.index("$$SOE") + 5 : res.index("$$EOE")]
    utc, az, el = [], [], []
    for line in body.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        t = datetime.strptime(parts[0], "%Y-%b-%d %H:%M:%S")
        utc.append(t.strftime("%Y-%m-%dT%H:%M:%S"))
        az.append(float(parts[3]))
        el.append(float(parts[4]))
    site = d["_request"]["SITE_COORD"].strip("'").split(",")
    return {
        "utc": utc,
        "az": np.array(az),
        "el": np.array(el),
        "lon": float(site[0]),
        "lat": float(site[1]),
        "alt_km": float(site[2]),
        "target": "SUN" if d["_request"]["COMMAND"].strip("'") == "10" else "EARTH",
    }


def angular_sep_deg(az1, el1, az2, el2) -> np.ndarray:
    a1, e1, a2, e2 = map(np.radians, (az1, el1, az2, el2))
    c = np.sin(e1) * np.sin(e2) + np.cos(e1) * np.cos(e2) * np.cos(a1 - a2)
    # haversine form for small angles
    h = np.sin((e2 - e1) / 2) ** 2 + np.cos(e1) * np.cos(e2) * np.sin((a2 - a1) / 2) ** 2
    return np.degrees(2 * np.arcsin(np.sqrt(np.clip(h, 0, 1))))
