"""Validation test 5: spatial agreement with PGDA product 69 long-term maps (Mazarico et al.).

PGDA AVGVISIB_85S_060M_201608: mean visible solar-disc fraction over an 18.6-yr nutation
cycle, hourly, 60 m grid. *_EARTH: % of time ANY part of Earth's disc is visible.
We run our engine at matched resolution (60 m near field to 20 km, 240 m to 200 km,
observer on the 60 m pixel centre, mast 0 m) at the same pixel centres, over an 18.6-yr
hourly window, for the curated polar presets plus a systematic ring sample of 85-90 S.

Pass: RMSE <= 5 pp for solar illumination (published peers: NetRunnerXD 3.54 pp,
Lunar Horizon 7.33 pp mean abs). Earth RMSE reported alongside.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from lunarnav.dem import GDAL_ENV, polar_clip
from lunarnav.events import long_term_stats
from lunarnav.horizon import compute_horizon
from lunarnav.report import record

PGDA69 = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
START, STOP = "2017-01-01T00:00:00", "2035-08-08T00:00:00"  # ~18.6 yr nutation cycle
PRESETS = {
    "shackleton_rim_s": (-89.7849, 203.97),
    "connecting_ridge_c1": (-89.4505, 222.84),
    "connecting_ridge_c2": (-89.3157, 245.94),
    "malapert_region": (-85.99, 357.07),
}


def ring_points():
    pts = {}
    for r_km in (5, 15, 30, 50, 75, 100, 130):
        for k in range(8):
            lon = (k * 45 + r_km * 7) % 360
            colat = math.degrees(r_km / 1737.4)
            pts[f"ring_{r_km:03d}km_{lon:03d}E"] = (-90 + colat, float(lon))
    return pts


def pgda_sample(fname: str, lat: float, lon: float) -> tuple[float, float, float]:
    """Value (0-1) at the PGDA pixel containing lat/lon, plus that pixel centre lat/lon."""
    import rasterio
    from rasterio.env import Env
    from rasterio.windows import Window

    with Env(**GDAL_ENV):
        with rasterio.open("/vsicurl/" + PGDA69 + fname) as d:
            rho = 2 * 1737400 * math.tan(math.pi / 4 + math.radians(lat) / 2)
            x, y = rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
            row, col = d.index(x, y)
            v = d.read(1, window=Window(col, row, 1, 1))[0, 0]
            xc, yc = d.xy(row, col)
    rho = math.hypot(xc, yc)
    la = math.degrees(2 * math.atan(rho / (2 * 1737400))) - 90
    lo = math.degrees(math.atan2(xc, yc)) % 360
    return (np.nan if v == -32768 else float(v) * 4e-5), la, lo


@pytest.fixture(scope="module")
def regional():
    # one regional clip pair re-used for every point within ~140 km of the pole
    near = polar_clip(-90.0, 0.0, 165.0, target_res_m=60.0, product="LDEM_60S_60MPP_ADJ.TIF")
    far = polar_clip(-90.0, 0.0, 345.0, target_res_m=240.0, product="LDEM_60S_60MPP_ADJ.TIF")
    return near, far


@pytest.mark.network
@pytest.mark.slow
def test_spatial_vs_pgda(regional):
    near, far = regional
    rows = []
    for name, (lat, lon) in {**PRESETS, **ring_points()}.items():
        sun_ref, plat, plon = pgda_sample("AVGVISIB_85S_060M_201608.TIF", lat, lon)
        earth_ref, _, _ = pgda_sample("AVGVISIB_85S_060M_201608_EARTH.TIF", lat, lon)
        if np.isnan(sun_ref):
            continue
        h = compute_horizon(plat, plon, 0.0, near=near, far=far, near_km=20, far_km=200)
        s = long_term_stats(h, START, STOP, 3600.0)
        rows.append({
            "name": name, "lat": round(plat, 5), "lon": round(plon, 4),
            "sun_pgda_pct": round(sun_ref * 100, 2), "sun_ours_pct": round(s["sun"]["avg_fraction_pct"], 2),
            "earth_pgda_pct": round(earth_ref * 100, 2), "earth_ours_pct": round(s["earth"]["any_visible_pct"], 2),
        })
    ds = np.array([r["sun_ours_pct"] - r["sun_pgda_pct"] for r in rows])
    de = np.array([r["earth_ours_pct"] - r["earth_pgda_pct"] for r in rows])
    rmse_s, rmse_e = float(np.sqrt((ds**2).mean())), float(np.sqrt((de**2).mean()))
    ok = rmse_s <= 5.0
    record("T5_spatial_vs_pgda", "85S_060M", {
        "n_points": len(rows), "period": f"{START[:10]}..{STOP[:10]} hourly", "grid": "60 m near / 240 m far, mast 0",
        "sun_rmse_pp": round(rmse_s, 2), "sun_bias_pp": round(float(ds.mean()), 2),
        "sun_mae_pp": round(float(np.abs(ds).mean()), 2),
        "earth_rmse_pp": round(rmse_e, 2), "earth_bias_pp": round(float(de.mean()), 2),
        "peers": {"NetRunnerXD_rmse_pp": 3.54, "LunarHorizon_mean_abs_pp": 7.33},
        "criterion": "sun RMSE <= 5 pp", "source": "https://pgda.gsfc.nasa.gov/products/69",
        "points": rows, "pass": bool(ok),
    })
    assert ok, rmse_s
