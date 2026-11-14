"""LOLA terrain access with a local clip cache.

Sources
-------
* Polar (|lat| >= 60): PGDA product 90 polar-stereographic COGs (Barker et al. 2023),
  heights in metres above the 1737.4 km sphere. Read remotely by window (HTTP range),
  using GDAL overviews for the coarse far field.
* Non-polar (|lat| < 60): SLDEM2015 simple-cylindrical PDS float tiles from MIT
  (values are km above 1737.4). Raw row-major files, so we fetch only the needed
  column span of each row with parallel HTTP range requests.

Both servers are slow (PGDA ~200 KB/s per connection), so every clip is cached
on disk under data/dem/clips/ and re-used.
"""
from __future__ import annotations

import os

import copy
import hashlib
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import requests

from .ephem import MOON_RADIUS_KM, ROOT

CLIP_DIR = ROOT / "data" / "dem" / "clips"
# Read-only deployments (Vercel) point this at a writable folder such as /tmp/lunarnav-clips;
# clips are then read from CLIP_DIR or WRITE_DIR and new downloads are saved to WRITE_DIR.
WRITE_DIR = Path(os.environ.get("LUNARNAV_CACHE_DIR") or CLIP_DIR)
CLIP_DIRS = [CLIP_DIR] if WRITE_DIR == CLIP_DIR else [CLIP_DIR, WRITE_DIR]


def _clip_path(name: str) -> Path:
    """Existing cached clip in any clip dir, else the path a new download is written to."""
    for d in CLIP_DIRS:
        if (d / name).exists():
            return d / name
    return WRITE_DIR / name
R_M = MOON_RADIUS_KM * 1000.0
PGDA = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
SLDEM_TILES = "http://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/"
SLDEM_GLOBAL = "http://imbrium.mit.edu/DATA/SLDEM2015/GLOBAL/FLOAT_IMG/"

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF",
    GDAL_NUM_THREADS="ALL_CPUS",
    GDAL_HTTP_MULTIRANGE="YES",
    CPL_VSIL_CURL_CHUNK_SIZE="1048576",
    GDAL_HTTP_MAX_RETRY="4",
    GDAL_HTTP_RETRY_DELAY="2",
    VSI_CACHE="TRUE",
)

# polar products: (file, native res m, max |lat| extent covered in deg from pole)
POLAR_SOUTH = [
    ("LDEM_83S_10MPP_ADJ.TIF", 10.0, 7.0),
    ("LDEM_80S_20MPP_ADJ.TIF", 20.0, 10.0),
    ("LDEM_75S_30MPP_ADJ.TIF", 30.0, 15.0),
    ("LDEM_60S_60MPP_ADJ.TIF", 60.0, 30.0),
]
POLAR_NORTH = [(f.replace("S_", "N_"), r, e) for f, r, e in POLAR_SOUTH]


@dataclass
class Clip:
    """A cached DEM clip. heights_m[row, col]; grid either polar-stereo (x,y metres)
    or geographic (lon, lat degrees). Pixel centres: x0 + (col+0.5)*dx, y0 - (row+0.5)*dy."""

    heights_m: np.ndarray
    kind: str  # "stere_s" | "stere_n" | "geo"
    x0: float
    y0: float
    dx: float
    dy: float
    res_m: float
    source: str

    # ---- coordinate conversion -------------------------------------------------
    def to_grid(self, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if self.kind == "geo":
            lonw = np.mod(lon - self.x0, 360.0) + self.x0  # unwrap into clip's lon range
            return lonw, lat
        la, lo = np.radians(lat), np.radians(lon)
        if self.kind == "stere_s":
            rho = 2 * R_M * np.tan(np.pi / 4 + la / 2)
            return rho * np.sin(lo), rho * np.cos(lo)
        rho = 2 * R_M * np.tan(np.pi / 4 - la / 2)
        return rho * np.sin(lo), -rho * np.cos(lo)

    def sample(self, lon, lat) -> np.ndarray:
        """Bilinear height (m) at lon/lat; NaN outside the clip."""
        x, y = self.to_grid(np.asarray(lon, float), np.asarray(lat, float))
        c = (x - self.x0) / self.dx - 0.5
        r = (self.y0 - y) / self.dy - 0.5
        H, W = self.heights_m.shape
        c0 = np.floor(c).astype(np.int64)
        r0 = np.floor(r).astype(np.int64)
        ok = (c0 >= 0) & (r0 >= 0) & (c0 < W - 1) & (r0 < H - 1)
        out = np.full(np.shape(x), np.nan, dtype=np.float64)
        if not ok.any():
            return out
        cc, rr = c0[ok], r0[ok]
        fc, fr = c[ok] - cc, r[ok] - rr
        a = self.heights_m
        v = (
            a[rr, cc] * (1 - fc) * (1 - fr)
            + a[rr, cc + 1] * fc * (1 - fr)
            + a[rr + 1, cc] * (1 - fc) * fr
            + a[rr + 1, cc + 1] * fc * fr
        )
        out[ok] = v
        return out

    def pixel_index(self, lon, lat) -> tuple[int, int]:
        x, y = self.to_grid(np.asarray(lon, float), np.asarray(lat, float))
        return int(np.floor((self.y0 - y) / self.dy)), int(np.floor((x - self.x0) / self.dx))

    def pixel_center(self, row: int, col: int) -> tuple[float, float, float]:
        """(lat, lon, height_m) of a pixel centre."""
        x = self.x0 + (col + 0.5) * self.dx
        y = self.y0 - (row + 0.5) * self.dy
        if self.kind == "geo":
            lat, lon = y, x % 360.0
        else:
            rho = np.hypot(x, y)
            colat = 2 * np.arctan(rho / (2 * R_M))
            if self.kind == "stere_s":
                lat, lon = np.degrees(colat) - 90.0, np.degrees(np.arctan2(x, y)) % 360.0
            else:
                lat, lon = 90.0 - np.degrees(colat), np.degrees(np.arctan2(x, -y)) % 360.0
        return float(lat), float(lon), float(self.heights_m[row, col])

    # ---- persistence -------------------------------------------------------------
    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        meta = dict(kind=self.kind, x0=self.x0, y0=self.y0, dx=self.dx, dy=self.dy, res_m=self.res_m,
                    source=self.source, shape=list(self.heights_m.shape))
        np.savez_compressed(path, heights_m=self.heights_m.astype(np.float32), meta=json.dumps(meta))

    @classmethod
    def load(cls, path: Path) -> "Clip":
        z = np.load(path)
        meta = json.loads(str(z["meta"]))
        meta.pop("shape", None)
        side = mmap_sidecar(path)
        if not side.exists():
            side = _assemble_parts(path)
        if side is not None and side.exists():
            # memory-mapped heights: only pages a request touches enter RAM (Render free tier)
            return cls(heights_m=np.load(side, mmap_mode="r"), **meta)
        return cls(heights_m=z["heights_m"], **meta)

    def write_mmap_sidecar(self, path: Path) -> Path:
        """Raw float32 .npy next to the .npz so `load` can memory-map it."""
        side = mmap_sidecar(path)
        np.save(side, np.ascontiguousarray(self.heights_m, dtype=np.float32))
        return side


def mmap_sidecar(path: Path) -> Path:
    return path.with_name(path.stem + ".heights.npy")


def _assemble_parts(path: Path) -> Path | None:
    """Sidecar shipped as row blocks (<stem>.heights.partN.npy, for upload size limits):
    concatenate once into WRITE_DIR and return that file, else None."""
    parts = sorted(path.parent.glob(path.stem + ".heights.part*.npy"),
                   key=lambda q: int(q.stem.rsplit("part", 1)[1]))
    if not parts:
        return None
    out = WRITE_DIR / (path.stem + ".heights.npy")
    if out.exists():
        return out
    arrs = [np.load(q, mmap_mode="r") for q in parts]
    shape = (sum(a.shape[0] for a in arrs), arrs[0].shape[1])
    WRITE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.npy")
    mm = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.float32, shape=shape)
    r = 0
    for a in arrs:
        mm[r:r + a.shape[0]] = a
        r += a.shape[0]
    mm.flush()
    del mm
    tmp.replace(out)
    return out


def _key(*parts) -> str:
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


# ------------------------------------------------------------------------------------
# Polar: PGDA COGs
# ------------------------------------------------------------------------------------
def pick_polar_product(lat: float, half_km: float, prefer_res: float | None = None):
    table = POLAR_SOUTH if lat < 0 else POLAR_NORTH
    colat = 90.0 - abs(lat)
    reach_deg = colat + math.degrees(half_km / MOON_RADIUS_KM) * 1.05
    cands = [p for p in table if p[2] >= reach_deg]
    if not cands:
        raise ValueError(f"no polar product covers lat {lat} with half-size {half_km} km")
    if prefer_res:
        # coarsest product that is still at least as fine as requested (fewest bytes)
        ok = [p for p in cands if p[1] <= prefer_res]
        if ok:
            return max(ok, key=lambda p: p[1])
    return min(cands, key=lambda p: p[1])


def polar_clip(lat: float, lon: float, half_km: float, target_res_m: float | None = None,
               product: str | None = None) -> Clip:
    """Square clip centred on the site in the product's polar-stereo grid."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.env import Env
    from rasterio.windows import from_bounds

    if product is None:
        product, native, _ = pick_polar_product(lat, half_km, target_res_m)
    else:
        native = next(r for f, r, _ in POLAR_SOUTH + POLAR_NORTH if f == product)
    res = max(native, target_res_m or native)
    path = _clip_path(f"polar_{_key(product, round(lat, 5), round(lon, 5), half_km, res)}.npz")
    if path.exists():
        return Clip.load(path)
    kind = "stere_s" if lat < 0 else "stere_n"
    probe = Clip(np.zeros((1, 1)), kind, 0, 0, 1, 1, res, product)
    xc, yc = probe.to_grid(np.array(lon), np.array(lat))
    xc, yc = float(xc), float(yc)
    h = half_km * 1000.0
    with Env(**GDAL_ENV):
        with rasterio.open("/vsicurl/" + PGDA + product) as d:
            w = from_bounds(xc - h, yc - h, xc + h, yc + h, d.transform).round_offsets().round_lengths()
            n_out = int(round(2 * h / res))
            arr = d.read(1, window=w, out_shape=(n_out, n_out), resampling=Resampling.average,
                         boundless=False).astype(np.float32)
            wt = d.window_transform(w)
            x0, y0 = wt.c, wt.f
            dx = (wt.a * w.width) / n_out
            dy = (-wt.e * w.height) / n_out
    clip = Clip(arr, kind, x0, y0, dx, dy, res, product)
    clip.save(path)
    return clip


# ------------------------------------------------------------------------------------
# Non-polar: SLDEM2015 raw PDS tiles
# ------------------------------------------------------------------------------------
@lru_cache(maxsize=64)
def _pds_label(url_lbl: str) -> dict:
    txt = requests.get(url_lbl, timeout=60).text

    def num(key):
        m = re.search(rf"\b{key}\s*=\s*([-+0-9.Ee]+)", txt)
        return float(m.group(1)) if m else None

    return dict(
        lines=int(num("LINES")),
        samples=int(num("LINE_SAMPLES")),
        record_bytes=int(num("RECORD_BYTES")),
        sample_bits=int(num("SAMPLE_BITS")),
        offset=num("OFFSET") or 0.0,
        scale=num("SCALING_FACTOR") or 1.0,
        ppd=num("MAP_RESOLUTION"),
        max_lat=num("MAXIMUM_LATITUDE"),
        min_lat=num("MINIMUM_LATITUDE"),
        west_lon=num("WESTERNMOST_LONGITUDE"),
        east_lon=num("EASTERNMOST_LONGITUDE"),
        image_ptr=_image_pointer(txt),
    )


def _image_pointer(txt: str) -> int:
    m = re.search(r"\^IMAGE\s*=\s*\(?\s*\"?[^,\"\n]*\"?\s*,?\s*(\d+)?", txt)
    if m and m.group(1):
        return int(m.group(1))
    return 1


def _sldem_tile_name(lat: float, lon: float) -> str:
    lon = lon % 360.0
    bands = [(-60, -30, "60S_30S"), (-30, 0, "30S_00S"), (0, 30, "00N_30N"), (30, 60, "30N_60N")]
    b = next(n for lo, hi, n in bands if lo <= lat < hi)
    l0 = int(lon // 45) * 45
    return f"SLDEM2015_512_{b}_{l0:03d}_{l0 + 45:03d}_FLOAT"


def _fetch_rows(url_img, lbl, row0, row1, col0, col1, workers=16) -> np.ndarray:
    nb = lbl["sample_bits"] // 8
    base = (lbl["image_ptr"] - 1) * lbl["record_bytes"]
    sess = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=workers, pool_maxsize=workers, max_retries=4)
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)

    def get(r):
        a = base + (r * lbl["samples"] + col0) * nb
        b = base + (r * lbl["samples"] + col1) * nb - 1
        resp = sess.get(url_img, headers={"Range": f"bytes={a}-{b}"}, timeout=60)
        resp.raise_for_status()
        return np.frombuffer(resp.content, dtype="<f4")

    with ThreadPoolExecutor(workers) as ex:
        rows = list(ex.map(get, range(row0, row1)))
    return np.vstack(rows)


def sldem_clip(lat: float, lon: float, half_km: float, coarse: bool = False) -> Clip:
    """Geographic clip from SLDEM2015 (512 ppd tiles, or 128 ppd global if coarse)."""
    if coarse:
        name = "SLDEM2015_128_60S_60N_000_360_FLOAT"
        root = SLDEM_GLOBAL
    else:
        name = _sldem_tile_name(lat, lon)
        root = SLDEM_TILES
    path = _clip_path(f"sldem_{_key(name, round(lat, 5), round(lon, 5), half_km)}.npz")
    if path.exists():
        return Clip.load(path)
    lbl = _pds_label(root + name + ".LBL")
    ppd = lbl["ppd"]
    dlat = math.degrees(half_km / MOON_RADIUS_KM)
    dlon = dlat / max(math.cos(math.radians(lat)), 0.05)
    lon = lon % 360.0
    west = lbl["west_lon"] % 360.0
    r0 = int(math.floor((lbl["max_lat"] - (lat + dlat)) * ppd))
    r1 = int(math.ceil((lbl["max_lat"] - (lat - dlat)) * ppd))
    c0 = int(math.floor(((lon - dlon) - west) * ppd))
    c1 = int(math.ceil(((lon + dlon) - west) * ppd))
    r0, r1 = max(r0, 0), min(r1, lbl["lines"])
    ns = lbl["samples"]
    full_circle = abs((lbl["east_lon"] - lbl["west_lon"]) - 360.0) < 1e-6
    if c0 < 0 or c1 > ns:
        if not full_circle:
            raise ValueError(f"clip crosses SLDEM tile edge ({name}); use a neighbouring tile")
        # global product: stitch across the 0/360 seam
        parts = []
        for a, b in ([(c0 + ns, ns), (0, c1)] if c0 < 0 else [(c0, ns), (0, c1 - ns)]):
            parts.append(_fetch_rows(root + name + ".IMG", lbl, r0, r1, a, b))
        raw = np.hstack(parts)
    else:
        raw = _fetch_rows(root + name + ".IMG", lbl, r0, r1, c0, c1)
    heights_m = ((raw * lbl["scale"] + lbl["offset"]) - MOON_RADIUS_KM) * 1000.0
    heights_m[raw < -1e30] = np.nan
    clip = Clip(
        heights_m.astype(np.float32),
        "geo",
        x0=west + c0 / ppd,
        y0=lbl["max_lat"] - r0 / ppd,
        dx=1.0 / ppd,
        dy=1.0 / ppd,
        res_m=math.radians(1.0 / ppd) * R_M,
        source=name,
    )
    clip.save(path)
    return clip


# ------------------------------------------------------------------------------------
_META_CACHE: dict[Path, dict] = {}


def _clip_meta(path: Path) -> dict:
    if path not in _META_CACHE:
        with np.load(path) as z:
            m = json.loads(str(z["meta"]))
            if "shape" not in m:  # older clips: read the array header once
                m["shape"] = list(z["heights_m"].shape)
        _META_CACHE[path] = m
    return _META_CACHE[path]


def find_cached_clip(lat: float, lon: float, half_km: float, max_res_m: float) -> Clip | None:
    """Finest already-cached polar clip that fully contains a half_km box around the site
    with resolution <= max_res_m (lets custom coordinates reuse regional downloads)."""
    if abs(lat) < 60:
        return None
    kind = "stere_s" if lat < 0 else "stere_n"
    probe = Clip(np.zeros((1, 1)), kind, 0, 0, 1, 1, 1, "")
    x, y = (float(v) for v in probe.to_grid(np.array(lon), np.array(lat)))
    h = half_km * 1000.0
    best, best_res = None, None
    for p in (q for d in CLIP_DIRS if d.exists() for q in d.glob("polar_*.npz")):
        m = _clip_meta(p)
        if m["kind"] != kind or m["res_m"] > max_res_m + 1e-6:
            continue
        H, W = m["shape"]
        x1, y1 = m["x0"] + W * m["dx"], m["y0"] - H * m["dy"]
        if m["x0"] <= x - h and x + h <= x1 and y1 <= y - h and y + h <= m["y0"]:
            if best_res is None or m["res_m"] < best_res or (m["res_m"] == best_res and H * W < best[1]):
                best, best_res = (p, H * W), m["res_m"]
    return _load_cached(best[0]) if best else None


class TerrainUnavailable(RuntimeError):
    """The remote terrain server failed and no cached clip covers the site."""


def _cached_fallback(lat: float, lon: float, near_km: float, far_km: float, exc: Exception):
    """Remote download failed: use the finest cached clip that covers the site (the bundled
    240 m regional clip on the hosted API), shrinking the far range to what it covers.
    The caller sees the coarser resolution through Clip.res_m and the `degraded` note."""
    near = find_cached_clip(lat, lon, near_km, 240.0)
    if near is None:
        raise TerrainUnavailable(
            "The NASA terrain server (PGDA) did not answer this request, and the terrain bundled "
            "with this server does not reach this point. Points within about 16 degrees of the "
            "south pole (lat <= -74), any curated site, and latitudes 60S-60N still work.") from exc
    for fk in sorted({far_km, 150.0, 100.0, 60.0, 40.0}, reverse=True):
        if fk > far_km:
            continue
        far = find_cached_clip(lat, lon, fk, 240.0)
        if far is not None:
            # shallow copies: cached clips are shared via lru_cache and must stay unflagged
            near, far = copy.copy(near), copy.copy(far)
            near.degraded = far.degraded = (
                f"NASA's terrain server did not answer, so this uses the {near.res_m:g} m/px terrain "
                f"bundled with the server (out to {fk:g} km). Nearby ridges are smoothed; times can "
                "shift by minutes to hours.")
            return near, far, fk
    raise TerrainUnavailable("No cached far-field terrain covers this point.") from exc


# Render free tier has 512 MB: set LUNARNAV_CLIP_CACHE=2 there (near + far regional clip).
@lru_cache(maxsize=int(os.environ.get("LUNARNAV_CLIP_CACHE", "8")))
def _load_cached(path: Path) -> "Clip":
    return Clip.load(path)


def site_clips(lat: float, lon: float, near_km: float = 20.0, far_km: float | None = None,
               prefer_cached: bool = False):
    """(near, far) clips appropriate for the site. Far range defaults to 200 km polar,
    100 km elsewhere (beyond that, curvature hides everything but the highest massifs)."""
    polar = abs(lat) >= 60.0
    if far_km is None:
        far_km = 200.0 if abs(lat) >= 75 else (150.0 if polar else 100.0)
    if polar and prefer_cached:
        near = find_cached_clip(lat, lon, near_km, 60.0)
        far = find_cached_clip(lat, lon, far_km, 240.0)
        if near is not None and far is not None:
            return near, far, far_km
    if polar:
        try:
            near = polar_clip(lat, lon, near_km, target_res_m=20.0)
            # 60 m product's 4x overview is exactly 240 m -> cheapest far-field read
            far60 = "LDEM_60S_60MPP_ADJ.TIF" if lat < 0 else "LDEM_60N_60MPP_ADJ.TIF"
            far = polar_clip(lat, lon, far_km, target_res_m=240.0, product=far60)
        except Exception as exc:  # PGDA refuses some hosts (HTTP 403 from Vercel/AWS, 13 Nov)
            if not prefer_cached:
                raise
            return _cached_fallback(lat, lon, near_km, far_km, exc)
    else:
        near = sldem_clip(lat, lon, near_km)
        far = sldem_clip(lat, lon, far_km, coarse=True)
    return near, far, far_km
