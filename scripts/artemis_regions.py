"""Best-lit landable point inside each Artemis III candidate region (USGS LGRS boxes).

Region boxes: data/artemis/LGRS_A3CLR_Grid_Generation.txt (USGS LGRS data release,
doi:10.5066/P13FD9ZD). The box corners are lon/lat; the box is square in polar stereo.

Search (objective = 18.6-yr average solar illumination at a 2 m mast, the Gläser metric):
  1. coarse 9x9 grid over the whole box
  2. 9x9 grid over +-1 coarse step around each of the TOP_K best coarse points (>= 2 steps apart)
  3. every 20 m DEM pixel within 3 px of the best refined point (sensitivity.local_scan)
Candidates steeper than MAX_SLOPE_DEG (20 m DEM, 3x3 gradient) are skipped: the goal is a
spot a lander could use, not a crater-wall pixel. Result: data/artemis/regions.json

Candidates must lie inside their own box (neighbouring boxes overlap). box_centre reports the
centre's real illumination and slope, whether or not it is landable.

Usage: python scripts/artemis_regions.py [RegionName ...] [--centre-only]
"""
from __future__ import annotations

import json
import math
import re
import sys
import time
from pathlib import Path

import numpy as np

from lunarnav.dem import polar_clip, site_clips
from lunarnav.ephem import ROOT, azel_from_center
from lunarnav.events import disc_fraction, grid_vectors, site_of
from lunarnav.horizon import compute_horizon
from lunarnav.sensitivity import local_scan

SRC = ROOT / "data" / "artemis" / "LGRS_A3CLR_Grid_Generation.txt"
OUT = ROOT / "data" / "artemis" / "regions.json"
R = 1737400.0
MAST = 2.0
MAX_SLOPE_DEG = 8.0
TOP_K = 3  # coarse seeds refined per region
LT = ("2017-01-01T00:00:00", "2035-08-08T00:00:00", 3600.0)

# LGRS name -> (current NASA name, note). 2024 list: nasa.gov RELEASE24-136.
REGIONS = {
    "Haworth": ("Haworth", None),
    "Malapert_Massif": ("Malapert Massif", None),
    "Nobile_Rim_1": ("Nobile Rim 1", None),
    "Nobile_Rim_2": ("Nobile Rim 2", None),
    "de_Gerlache_Rim_2": ("de Gerlache Rim 2", None),
    "Leibnitz_Beta_Plateau": ("Mons Mouton Plateau",
                              "LGRS box is named 'Leibnitz Beta Plateau' (Leibnitz Beta was renamed Mons Mouton); "
                              "assumed to match NASA's 'Mons Mouton Plateau' region (unverified)."),
}


def boxes():
    t = SRC.read_text()
    arr = lambda n: [x.strip("' ") for x in re.search(n + r"=\(([^)]*)\)", t).group(1).split()]
    names = arr("LR")
    vals = [list(map(float, arr(k))) for k in ("LR_ulX", "LR_ulY", "LR_lrX", "LR_lrY")]
    return {n: tuple(v[i] for v in vals) for i, n in enumerate(names)}


def fwd(lon, lat):
    rho = 2 * R * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def inv(x, y):
    return math.degrees(2 * math.atan(math.hypot(x, y) / (2 * R))) - 90, math.degrees(math.atan2(x, y)) % 360


def slope_deg(clip, lat, lon):
    r, c = clip.pixel_index(lon, lat)
    z = clip.heights_m[r - 1:r + 2, c - 1:c + 2].astype(float)
    if z.shape != (3, 3) or not np.isfinite(z).all():
        return 90.0
    gx = ((z[:, 2] - z[:, 0]).sum()) / (6 * clip.dx)
    gy = ((z[0, :] - z[2, :]).sum()) / (6 * clip.dy)
    return math.degrees(math.atan(math.hypot(gx, gy)))


def main(only=None, centre_only=False):
    bx = boxes()
    _, V = grid_vectors(*LT, "SUN")
    res = json.loads(OUT.read_text()) if OUT.exists() else {}
    for key, (name, note) in REGIONS.items():
        if only and key not in only:
            continue
        t0 = time.time()
        ulx, uly, lrx, lry = bx[key]
        (x1, y1), (x2, y2) = fwd(ulx, uly), fwd(lrx, lry)
        xc, yc = (x1 + x2) / 2, (y1 + y2) / 2
        clat, clon = inv(xc, yc)
        half_km = max(abs(x2 - x1), abs(y2 - y1)) / 2000
        near = polar_clip(clat, clon, half_km + 20.0, target_res_m=20.0)
        _, far, far_km = site_clips(clat, clon)

        xlo, xhi, ylo, yhi = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)

        def inside(la, lo):
            x, y = fwd(lo, la)
            return xlo <= x <= xhi and ylo <= y <= yhi

        def illum(la, lo):
            h = compute_horizon(la, lo, MAST, near=near, far=far, far_km=far_km)
            g = azel_from_center(site_of(h), V, "SUN")
            return float(disc_fraction(g["el"], h.at(g["az"]), g["ang_radius"]).mean() * 100)

        def score(la, lo):  # -1 = not a candidate (outside the box or too steep)
            if not inside(la, lo) or slope_deg(near, la, lo) > MAX_SLOPE_DEG:
                return -1.0
            return illum(la, lo)

        if centre_only:
            res[key]["box_centre"].update(avg_pct=round(illum(clat, clon), 2),
                                          slope_deg=round(slope_deg(near, clat, clon), 1))
            OUT.write_text(json.dumps(res, indent=1))
            print(key, "centre", res[key]["box_centre"], flush=True)
            continue

        def grid(x0, y0, half_m, n=9):
            """All (score, (x, y)) on an n x n grid, best first."""
            pts = []
            for gx in np.linspace(x0 - half_m, x0 + half_m, n):
                for gy in np.linspace(y0 - half_m, y0 + half_m, n):
                    la, lo = inv(gx, gy)
                    pts.append((score(la, lo), (gx, gy)))
            return sorted(pts, key=lambda p: -p[0])

        coarse = grid(xc, yc, half_km * 1000 * 0.95)
        s1 = coarse[0][0]
        step = half_km * 1000 * 0.95 * 2 / 8
        # Refine around the TOP_K best coarse points that are >= 2 steps apart: bright ridges
        # are narrow, so the single best coarse point can sit next to the wrong one.
        seeds = []
        for sc, xy in coarse:
            if sc < 0:
                break
            if all(math.hypot(xy[0] - q[0], xy[1] - q[1]) >= 2 * step for q in seeds):
                seeds.append(xy)
            if len(seeds) == TOP_K:
                break
        s2, (bx2, by2) = max((grid(x, y, step)[0] for x, y in seeds), key=lambda p: p[0])
        la, lo = inv(bx2, by2)
        scan = local_scan(la, lo, radius_px=3, mast_m=MAST, near=near, far=far, far_km=far_km,
                          start_utc=LT[0], stop_utc=LT[1], step_s=LT[2])
        ok = [c for c in scan["cells"] if inside(c["lat"], c["lon"])
              and slope_deg(near, c["lat"], c["lon"]) <= MAX_SLOPE_DEG]
        best = max(ok, key=lambda c: c["avg_pct"]) if ok else scan["centre"]
        res[key] = {
            "nasa_name": name, "lgrs_name": key, "note": note,
            "box_ul_lonlat": [ulx, uly], "box_lr_lonlat": [lrx, lry], "box_km": round(2 * half_km, 1),
            "box_centre": {"lat": round(clat, 5), "lon": round(clon, 5), "avg_pct": round(illum(clat, clon), 2),
                           "slope_deg": round(slope_deg(near, clat, clon), 1)},
            "best": {"lat": best["lat"], "lon": best["lon"], "ground_m": best["ground_m"],
                     "avg_pct": round(best["avg_pct"], 2), "vis_pct": round(best["vis_pct"], 2),
                     "slope_deg": round(slope_deg(near, best["lat"], best["lon"]), 1)},
            "search": {"coarse_best_pct": round(s1, 2), "refined_best_pct": round(s2, 2), "top_k": TOP_K, "mast_m": MAST,
                       "max_slope_deg": MAX_SLOPE_DEG, "period": list(LT), "dem_res_m": near.res_m},
            "source": "https://doi.org/10.5066/P13FD9ZD",
        }
        OUT.write_text(json.dumps(res, indent=1))
        b = res[key]["best"]
        print(f"{name:22s} best {b['lat']:.5f} {b['lon']:.5f}  avg {b['avg_pct']:.1f}%  slope {b['slope_deg']}°  "
              f"(box centre {res[key]['box_centre']['avg_pct']:.1f}%)  {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args or None, centre_only="--centre-only" in sys.argv)
