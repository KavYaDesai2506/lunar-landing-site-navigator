"""Fetch JPL Horizons topocentric az/el for validation and cache it offline.

Horizons is used ONLY as an offline validation oracle (rate limits undocumented),
so this runs once and the JSON responses are stored in data/horizons_cache/.

Usage:  python scripts/fetch_horizons.py
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "horizons_cache"
API = "https://ssd.jpl.nasa.gov/api/horizons.api"

# (case_id, lon_E, lat, alt_km, target_cmd, start, stop, step)
CASES = [
    ("shackleton_sun", 204.0, -89.78, 0.0, "10", "2026-11-10 00:00", "2026-11-24 00:00", "1 h"),
    ("shackleton_earth", 204.0, -89.78, 0.0, "399", "2026-11-10 00:00", "2026-11-24 00:00", "1 h"),
    ("apollo11_sun", 23.473, 0.674, 0.0, "10", "2026-11-10 00:00", "2026-12-10 00:00", "3 h"),
    ("apollo11_earth", 23.473, 0.674, 0.0, "399", "2026-11-10 00:00", "2026-12-10 00:00", "3 h"),
    ("change6_sun", 206.0148, -41.6385, 0.0, "10", "2026-11-10 00:00", "2026-12-10 00:00", "3 h"),
    ("change6_earth", 206.0148, -41.6385, 0.0, "399", "2026-11-10 00:00", "2026-12-10 00:00", "3 h"),
]


def fetch(case):
    cid, lon, lat, alt, cmd, start, stop, step = case
    out = CACHE / f"{cid}.json"
    if out.exists():
        print("cached", cid)
        return
    params = {
        "format": "json",
        "COMMAND": f"'{cmd}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},{alt}'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "EXTRA_PREC": "'YES'",
        "CSV_FORMAT": "'YES'",
        "TIME_DIGITS": "'SECONDS'",
    }
    r = requests.get(API, params=params, timeout=120)
    r.raise_for_status()
    data = r.json()
    data["_request"] = {k: v for k, v in params.items()}
    out.write_text(json.dumps(data, indent=1))
    print("fetched", cid)
    time.sleep(2)  # be polite


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    for c in CASES:
        fetch(c)
