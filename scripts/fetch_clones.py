"""Fetch windows of the 100 PGDA product-78 LDEM clones (Barker et al. 2021) around a site.

Each clone is a full 5 m/px LDEM realisation drawn from the LDEM error covariance, so
running the horizon/event pipeline on every clone propagates NASA's own height error into
our sunset times (P10-P90).

Files are uncompressed row strips on a slow server, so we read a +-HALF_KM window per
clone (full rows are transferred), 8 clones in parallel, and cache a compact stack.

Usage: python scripts/fetch_clones.py Site04 -89.7849 203.97 [n_clones] [half_km]
"""
from __future__ import annotations

import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "dem" / "clones"
BASE = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/"
ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
           GDAL_HTTP_MULTIRANGE="YES", CPL_VSIL_CURL_CHUNK_SIZE="4194304", GDAL_HTTP_MAX_RETRY="5",
           GDAL_HTTP_RETRY_DELAY="3", VSI_CACHE="FALSE",
           GDAL_HTTP_TIMEOUT="180", GDAL_HTTP_CONNECTTIMEOUT="30",
           GDAL_HTTP_LOW_SPEED_TIME="45", GDAL_HTTP_LOW_SPEED_LIMIT="2000")  # stalled connections error out and retry


def window_for(path, lat, lon, half_km):
    import rasterio
    from rasterio.env import Env
    from rasterio.windows import from_bounds

    rho = 2 * 1737400 * math.tan(math.pi / 4 + math.radians(lat) / 2)
    x, y = rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
    h = half_km * 1000
    with Env(**ENV):
        with rasterio.open("/vsicurl/" + path) as d:
            w = from_bounds(x - h, y - h, x + h, y + h, d.transform).round_offsets().round_lengths()
            w = w.intersection(rasterio.windows.Window(0, 0, d.width, d.height))
            t = d.window_transform(w)
    return w, t


def read_window(path, w):
    import rasterio
    from rasterio.env import Env

    for attempt in range(4):
        try:
            with Env(**ENV):
                with rasterio.open("/vsicurl/" + path) as d:
                    return d.read(1, window=w).astype(np.float32)
        except Exception as e:  # flaky server: retry
            print("retry", path, e)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(path)


def main(site, lat, lon, n=100, half_km=2.0):
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{site}_{n}x_{half_km:g}km.npz"
    if out.exists():
        print("exists", out)
        return
    surf = f"{BASE}{site}/{site}_final_adj_5mpp_surf.tif"
    w, t = window_for(surf, lat, lon, half_km)
    print("window", w, "transform", t)
    t0 = time.time()
    parts = OUT / f"{site}_parts"
    parts.mkdir(exist_ok=True)

    def cached(name, url):
        f = parts / f"base_{name}.npy"
        if not f.exists():
            np.save(f, read_window(url, w))
            print(f"{name} done ({time.time() - t0:.0f} s)", flush=True)
        return np.load(f)

    base = cached("surf", surf)
    err = cached("toterr", f"{BASE}{site}/{site}_final_adj_5mpp_toterr.tif")
    paths = [f"{BASE}{site}/Clones/{site}_final_adj_5mpp_{k:04d}_err.tif" for k in range(1, n + 1)]

    def job(k):
        f = parts / f"{k + 1:04d}.npy"
        if f.exists():
            return
        try:
            np.save(f, read_window(paths[k], w))  # saved per clone: survives interruption
            print(f"clone {k + 1:3d} done  ({time.time() - t0:6.0f} s)", flush=True)
        except RuntimeError:
            print(f"clone {k + 1:3d} SKIPPED (server refused)", flush=True)

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(job, range(n)))
    got = sorted(f for f in parts.glob("*.npy") if f.stem.isdigit())
    stack = np.stack([np.load(f) for f in got]).astype(np.float32)
    ids = np.array([int(f.stem) for f in got])
    np.savez_compressed(out, surf=base, toterr=err, clones=stack, clone_ids=ids,
                        x0=t.c, y0=t.f, dx=t.a, dy=-t.e, site=site, lat=lat, lon=lon)
    print("saved", out, f"{time.time() - t0:.0f} s")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], float(a[1]), float(a[2]), int(a[3]) if len(a) > 3 else 100, float(a[4]) if len(a) > 4 else 2.0)
