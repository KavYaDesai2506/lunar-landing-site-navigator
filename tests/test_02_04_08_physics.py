"""Validation tests 2, 4 and 8.

T2  Terrain vs LROC QuickMap (hands-on observation during research, Nov 2026):
    Shackleton rim point 204E, -89.78, eye 1.7 m. QuickMap: terrain sunset roughly
    11 Nov 2026 06:00-10:00 UTC (4-h resolution); Sun hidden at geometric el 1.70 deg
    at 11 Nov 13:42; Earth visible 17 Nov 17:42 at el -0.13, az 150.
    QuickMap states its own accuracy caveats, so this is reported, not gated hard.
T4  Mast height at Connecting Ridge C1 (Gläser 2014/2018): illumination rises with height
    (C1-0 at 2 m: 88.0% avg / 92.1% vis; Gläser 2014: 92.27% at 2 m, 95.65% at 10 m).
T8  Physics sanity: polar Sun stays within +-1.6 deg elevation; far-side Chang'e-6 never
    sees Earth; near-side Apollo 11 always does.
"""
import numpy as np
import pytest

from lunarnav.dem import site_clips
from lunarnav.ephem import Site, azel, et_range
from lunarnav.events import find_events, long_term_stats, series
from lunarnav.horizon import compute_horizon
from lunarnav.report import record

C1_BEST = (-89.449762, 222.862727)  # best pixel within 60 m of Gläser C1 in our DEM (test 3)


@pytest.mark.network
def test_t2_quickmap_shackleton():
    lat, lon = -89.78, 204.0
    h = compute_horizon(lat, lon, mast_m=1.7)
    ev = find_events(h, "2026-11-09T00:00:00", "2026-11-25T00:00:00", "SUN", 600)
    ev_e = find_events(h, "2026-11-09T00:00:00", "2026-11-25T00:00:00", "EARTH", 600)
    et = et_range("2026-11-11T13:42:00", "2026-11-11T13:42:00", 60)
    s = series(h, et, "SUN")
    et2 = et_range("2026-11-17T17:42:00", "2026-11-17T17:42:00", 60)
    e = series(h, et2, "EARTH")
    sunsets = [x.to_dict(h)["utc"] for x in ev if x.kind == "last_light"]
    in_window = any("2026-11-11T06" <= u <= "2026-11-11T10:59" for u in sunsets)
    record("T2_terrain_vs_quickmap", "shackleton_rim_204E", {
        "our_sun_last_light_utc": sunsets,
        "quickmap_sunset_window_utc": ["2026-11-11T06:00", "2026-11-11T10:00"],
        "sun_frac_at_2026-11-11T13:42": round(float(s["frac"][0]), 3),
        "sun_geom_el_at_2026-11-11T13:42": round(float(s["el"][0]), 3),
        "horizon_el_at_sun_az": round(float(s["horizon"][0]), 3),
        "earth_frac_at_2026-11-17T17:42": round(float(e["frac"][0]), 3),
        "earth_el_az": [round(float(e["el"][0]), 3), round(float(e["az"][0]), 2)],
        "earth_events": [x.to_dict(h)["utc"] + " " + x.kind for x in ev_e],
        "snapped": [h.lat, h.lon],
        "criterion": "our terrain sunset falls in QuickMap's 06-10 UTC window (informational; QuickMap has 4-h resolution and its own caveats)",
        "pass": None,  # informational (see criterion)
        "in_quickmap_window": bool(in_window),
    })


@pytest.mark.network
@pytest.mark.slow
def test_t4_mast_height_c1():
    near, far, fk = site_clips(-89.4505, 222.84)
    out = {}
    for m in (0.0, 2.0, 10.0):
        h = compute_horizon(*C1_BEST, mast_m=m, near=near, far=far, far_km=fk)
        s = long_term_stats(h, "2017-01-01T00:00:00", "2037-01-01T00:00:00", 3600, targets=("SUN",))["sun"]
        out[f"{m:g}m"] = {"avg_pct": round(s["avg_fraction_pct"], 2), "vis_pct": round(s["any_visible_pct"], 2),
                          "max_shadow_h": s["max_dark_h"]}
    a0, a2, a10 = (out[k]["avg_pct"] for k in ("0m", "2m", "10m"))
    ok = a0 < a2 < a10 and (a2 - a0) > 3.0
    record("T4_mast_height", "connecting_ridge_c1", {
        "ours": out,
        "glaser_2018_C1-0_2m": {"avg_pct": 88.0, "vis_pct": 92.1},
        "glaser_2014": {"2m_pct": 92.27, "10m_pct": 95.65},
        "criterion": "illumination increases with mast height, with a clear (>3 pp) 0->2 m gain",
        "pass": bool(ok),
    })
    assert ok, out


def test_t8_physics():
    et = et_range("2026-01-01T00:00:00", "2027-01-01T00:00:00", 3600)
    pole = azel(Site(-89.78, 204.0), et, "SUN")
    ch6 = azel(Site(-41.6385, 206.0148), et, "EARTH")
    a11 = azel(Site(0.67416, 23.47314), et, "EARTH")
    # Gläser's 1.54 deg bound is AT the pole; 0.22 deg away the local vertical tilts by 0.22 deg
    ok_pole = float(np.abs(pole["el"]).max()) < 1.6 + (90 - 89.78)
    ok_far = float((ch6["el"] + ch6["ang_radius"]).max()) < 0
    ok_near = float((a11["el"] - a11["ang_radius"]).min()) > 0
    record("T8_physics", "sanity", {
        "polar_sun_max_abs_el_deg": round(float(np.abs(pole["el"]).max()), 3),
        "change6_earth_max_upper_limb_el_deg": round(float((ch6["el"] + ch6["ang_radius"]).max()), 2),
        "apollo11_earth_min_lower_limb_el_deg": round(float((a11["el"] - a11["ang_radius"]).min()), 2),
        "criterion": "Sun |el| at 89.78S < 1.6 + 0.22 deg (pole bound 1.54 + site colatitude); far side never sees Earth; Apollo 11 always does",
        "pass": bool(ok_pole and ok_far and ok_near),
    })
    assert ok_pole and ok_far and ok_near
