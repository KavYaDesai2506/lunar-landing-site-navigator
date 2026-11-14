"""Open-horizon (no terrain) events and the mission-replay extras."""
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from add_open_events import horizon_from_json  # noqa: E402
from lunarnav.precompute import OUT, WINDOW, open_events  # noqa: E402

SYNODIC_D = 29.530589


def _site(sid):
    f = OUT / f"{sid}.json"
    if not f.exists():
        pytest.skip(f"{f} not built")
    return json.loads(f.read_text())


def _t(e):
    return datetime.fromisoformat(e["utc"].rstrip("Z"))


def test_stored_open_events_match_engine():
    p = _site("apollo11")
    h = horizon_from_json(p["horizons"]["2"])
    assert p["open_events"] == open_events(h, *WINDOW)


def test_equatorial_open_sunsets_one_synodic_month_apart():
    p = _site("apollo11")
    sets = [_t(e) for e in p["open_events"] if e["target"] == "sun" and e["kind"] == "last_light"]
    assert len(sets) >= 12
    gaps = np.diff([s.timestamp() for s in sets]) / 86400.0
    # the synodic month varies by about +-0.3 d (orbital eccentricity)
    assert np.all(np.abs(gaps - SYNODIC_D) < 0.6), gaps


def test_open_events_have_zero_horizon_and_no_blocker():
    p = _site("connecting_ridge_c2")
    assert p["open_events"]
    for e in p["open_events"]:
        assert e["horizon_el_deg"] == 0.0 and "blocker" not in e


def test_chandrayaan3_terrain_ends_light_before_open_horizon():
    mr = _site("chandrayaan3")["mission_replay"]
    gap_h = (_t(mr["first_open_sunset_after_landing"]) - _t(mr["first_terrain_sunset_after_landing"])).total_seconds() / 3600
    assert 9 < gap_h < 12  # ~10.4 h: the ridge near Manzinus U steals the last ~half day of light


def test_im2_summit_sees_past_open_horizon():
    # IM-2 sat on the Mons Mouton summit: the horizon dips below 0 deg to the west,
    # so terrain sunset comes *after* the flat-horizon sunset.
    mr = _site("im2")["mission_replay"]
    assert mr["first_terrain_sunset_after_landing"]["horizon_el_deg"] < 0
    assert _t(mr["first_terrain_sunset_after_landing"]) > _t(mr["first_open_sunset_after_landing"])


@pytest.mark.parametrize("sid", ["chandrayaan3", "slim", "im1", "im2", "blue_ghost1"])
def test_replay_track_covers_window(sid):
    mr = _site(sid)["mission_replay"]
    tr = mr["track"]
    assert tr["start_utc"] == mr["window"][0]
    assert tr["n"] <= 3000 and tr["step_s"] % 1800 == 0
    span = (datetime.fromisoformat(mr["window"][1]) - datetime.fromisoformat(mr["window"][0])).total_seconds()
    assert (tr["n"] - 1) * tr["step_s"] <= span < tr["n"] * tr["step_s"] + tr["step_s"]


def test_api_site_returns_open_events(monkeypatch):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from lunarnav import api

    h = horizon_from_json(_site("connecting_ridge_c2")["horizons"]["2"])

    class _Clip:
        source, res_m, degraded = "stub", 20.0, None

    api._horizon.cache_clear()
    monkeypatch.setattr(api, "_horizon", lambda lat, lon, mast: (h, _Clip(), _Clip(), 60.0))
    r = TestClient(api.app).get("/site", params={"lat": h.lat, "lon": h.lon})
    assert r.status_code == 200
    assert r.json()["open_events"] == open_events(h, *WINDOW)
