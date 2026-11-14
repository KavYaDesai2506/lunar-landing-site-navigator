"""Validation tests 6 and 7: predicted vs actual mission endings.

Reads the precomputed site files (out/sites/<id>.json, built by scripts/precompute.py)
so the dashboard and the evidence page show exactly the same numbers.

T6  Missions that ended at/near sunset: the predicted terrain sunset should fall within
    hours of the reported end (Chandrayaan-3: sleep commanded *before* sunset;
    Blue Ghost 1: sunset reported 16 Mar, end ~5 h later).
    SLIM: survived several nights -> list predicted sunrises (wake dates still to be sourced).
T7  Tilt-limited control IM-1: Odysseus tipped over and lost power when the Sun left its one lit
    panel. Expected result: terrain sunlight still present at the reported end, with terrain
    sunset (blocked by the Malapert A rim) days later. Panel geometry is outside the model.
T7  Negative control IM-2: the tool should show plenty of sunlight left at the end, i.e.
    illumination did NOT end the mission (it lay on its side) - and say what it can't model.
"""
import json
from datetime import datetime

import pytest

from lunarnav.ephem import ROOT
from lunarnav.report import record

SITES = ROOT / "out" / "sites"


def _load(i):
    f = SITES / f"{i}.json"
    if not f.exists():
        pytest.skip(f"{f.name} not precomputed yet")
    return json.loads(f.read_text())["mission_replay"]


def _hours(a, b):
    return (datetime.fromisoformat(a.rstrip("Z")) - datetime.fromisoformat(b.rstrip("Z"))).total_seconds() / 3600


@pytest.mark.parametrize("sid,max_abs_h", [("chandrayaan3", 24.0), ("blue_ghost1", 24.0)])
def test_t6_sunset_endings(sid, max_abs_h):
    m = _load(sid)
    s = m["first_terrain_sunset_after_landing"]
    gap = m["end_minus_sunset_h"]
    ok = s is not None and abs(gap) <= max_abs_h
    record("T6_mission_endings", sid, {
        "landed_utc": m["landed_utc"], "reported_end_utc": m["end_utc"], "end_reason": m["end_reason"],
        "predicted_terrain_sunset_utc": s and s["utc"],
        "sunset_blocker": s and s.get("blocker", {}).get("phrase"),
        "end_minus_predicted_sunset_h": gap,
        "sun_frac_at_reported_end": m["sun_frac_at_end"],
        "criterion": f"|end - predicted sunset| <= {max_abs_h} h",
        "sources": m["sources"], "pass": bool(ok),
    })
    assert ok, gap


def test_t6_slim_nights():
    m = _load("slim")
    rises = m["sunrises_after_landing"]
    record("T6_mission_endings", "slim", {
        "landed_utc": m["landed_utc"], "reported_end_utc": m["end_utc"],
        "predicted_sunrises_utc": rises, "sun_frac_at_reported_end": m["sun_frac_at_end"],
        "criterion": "informational: wake-ups should follow predicted local sunrises (JAXA wake dates to be sourced)",
        "sources": m["sources"], "pass": None,
    })
    assert len(rises) >= 3


def test_t7_im2_negative_control():
    m = _load("im2")
    s = m["first_terrain_sunset_after_landing"]
    hours_left = _hours(s["utc"], m["end_utc"]) if s else None
    ok = m["sun_frac_at_end"] > 0.5 and (hours_left is None or hours_left > 24)
    record("T7_negative_control", "im2", {
        "landed_utc": m["landed_utc"], "reported_end_utc": m["end_utc"], "end_reason": m["end_reason"],
        "sun_frac_at_reported_end": m["sun_frac_at_end"],
        "predicted_next_terrain_sunset_utc": s and s["utc"],
        "sunlight_hours_left_at_end": hours_left and round(hours_left, 1),
        "verdict": "Light was not the limit: the site still had sunlight. The tool cannot model lander orientation.",
        "criterion": "sun visible at end and > 24 h of sunlight left",
        "sources": m["sources"], "pass": bool(ok),
    })
    assert ok


def test_t7_im1_tilt_limited():
    m = _load("im1")
    s = m["first_terrain_sunset_after_landing"]
    hours_left = _hours(s["utc"], m["end_utc"]) if s else None
    ok = m["sun_frac_at_end"] > 0.5 and hours_left is not None and hours_left > 24
    record("T7_negative_control", "im1", {
        "landed_utc": m["landed_utc"], "reported_end_utc": m["end_utc"], "end_reason": m["end_reason"],
        "sun_frac_at_reported_end": m["sun_frac_at_end"],
        "predicted_terrain_sunset_utc": s and s["utc"],
        "sunset_blocker": s and s.get("blocker", {}).get("phrase"),
        "terrain_sunlight_hours_left_at_end": hours_left and round(hours_left, 1),
        "verdict": ("Terrain sunlight remained; the end came from the tipped lander's single lit panel losing the "
                    "low Sun. Last-contact date is 29 Feb or 1 Mar 2024 depending on source; either way it is "
                    "> 1 day before terrain sunset."),
        "criterion": "sun visible at reported end and > 24 h of terrain sunlight left",
        "sources": m["sources"], "pass": bool(ok),
    })
    assert ok
