"""Validation test 1: SPICE Sun/Earth apparent az/el vs JPL Horizons (cached offline).

Pass criterion: max angular separation < 1 arcsec over every cached epoch.
"""
import numpy as np
import pytest

from lunarnav.ephem import Site, azel, azel_spice, utc_to_et
from lunarnav.horizons import angular_sep_deg, load_case
from lunarnav.report import record

CASES = [
    "shackleton_sun",
    "shackleton_earth",
    "apollo11_sun",
    "apollo11_earth",
    "change6_sun",
    "change6_earth",
]


@pytest.mark.parametrize("case_id", CASES)
def test_ephemeris_vs_horizons(case_id):
    h = load_case(case_id)
    site = Site(h["lat"], h["lon"], h["alt_km"] * 1000)
    et = utc_to_et(h["utc"])
    ours = azel(site, et, h["target"])
    sep_arcsec = angular_sep_deg(ours["az"], ours["el"], h["az"], h["el"]) * 3600
    record(
        "T1_ephemeris_vs_horizons",
        case_id,
        {
            "n_epochs": int(len(et)),
            "max_sep_arcsec": float(sep_arcsec.max()),
            "median_sep_arcsec": float(np.median(sep_arcsec)),
            "max_el_err_arcsec": float(np.abs(ours["el"] - h["el"]).max() * 3600),
            "criterion": "< 1 arcsec",
            "pass": bool(sep_arcsec.max() < 1.0),
        },
    )
    assert sep_arcsec.max() < 1.0


def test_research_anchor_values():
    """Values read off Horizons by hand during research (Shackleton rim, 204E -89.78)."""
    s = Site(-89.78, 204.0)
    r = azel(s, utc_to_et(["2026-11-10T00:00:00", "2026-11-10T13:00:00"]), "SUN")
    assert r["el"][0] == pytest.approx(1.737, abs=5e-4)
    assert r["az"][0] == pytest.approx(331.40, abs=5e-3)
    assert r["el"][1] == pytest.approx(1.727, abs=5e-4)
    assert r["az"][1] == pytest.approx(324.79, abs=5e-3)


def test_azlcpo_agrees_with_enu_path():
    s = Site(-69.373, 32.319, 2.0)
    et = utc_to_et("2023-09-02T12:00:00")
    ours = azel(s, et, "SUN")
    az, el = azel_spice(s, et, "SUN")
    assert angular_sep_deg(ours["az"][0], ours["el"][0], az, el) * 3600 < 1e-3
