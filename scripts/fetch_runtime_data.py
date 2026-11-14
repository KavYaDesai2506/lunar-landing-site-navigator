"""Fetch everything the API needs at runtime that is not in git (used by the Render build).

    python scripts/fetch_runtime_data.py

1. SPICE kernels from NAIF (md5-checked) -> data/kernels/
2. Two regional south-polar terrain clips from PGDA -> data/dem/clips/
   - near: 20 m, +-60 km around the pole   (custom points within ~40 km of the pole: ~1 s)
   - far : 240 m, +-505 km around the pole (far-field horizon for every point at lat <= -80)
   Other points fetch their own 20 m near clip on first request (~100 s), cached until restart.
Idempotent: anything already present is skipped.
"""
from __future__ import annotations

import hashlib
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = {
    "naif0012.tls": ("lsk/naif0012.tls", "25a2fff30b0dedb4d76c06727b1895b1"),
    "pck00011.tpc": ("pck/pck00011.tpc", "3c0bdc01bb4101d6242cf96ece67a586"),
    "de440s.bsp": ("spk/planets/de440s.bsp", "3917ee56769db332790c751e2168843d"),
    "moon_pa_de440_200625.bpc": ("pck/moon_pa_de440_200625.bpc", "9f48a8c4cf1c955ac5d3a7d77a127e42"),
    "moon_de440_250416.tf": ("fk/satellites/moon_de440_250416.tf", "3556dde4bb7ca54a89917c301e650bbf"),
}


def md5(p: Path) -> str:
    h = hashlib.md5()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fetch_kernels():
    kd = ROOT / "data" / "kernels"
    kd.mkdir(parents=True, exist_ok=True)
    for name, (rel, want) in KERNELS.items():
        p = kd / name
        if p.exists() and md5(p) == want:
            continue
        r = requests.get(NAIF + rel, timeout=300)
        r.raise_for_status()
        p.write_bytes(r.content)
        got = md5(p)
        if got != want:
            raise SystemExit(f"md5 mismatch for {name}: {got} != {want}")
        print("kernel", name, len(r.content) // 1024, "KiB", flush=True)


FAR_PRODUCT = "LDEM_60S_60MPP_ADJ.TIF"
FAR_HALF_KM = 505.0  # 303 km (lat -80) + 200 km far-field reach + margin


def far_regional_clip(half_km: float = FAR_HALF_KM):
    """240 m clip centred on the south pole, read from the product's built-in 4x overview
    (reading the 60 m base level and averaging would pull ~1 GB through PGDA)."""
    import numpy as np
    import rasterio
    from rasterio.env import Env
    from rasterio.windows import from_bounds

    from lunarnav.dem import CLIP_DIR, GDAL_ENV, PGDA, Clip, _key

    path = CLIP_DIR / f"polar_{_key('regional_far_ovr4', FAR_PRODUCT, half_km)}.npz"
    if path.exists():
        return Clip.load(path)
    h = half_km * 1000.0
    with Env(**GDAL_ENV):
        with rasterio.open("/vsicurl/" + PGDA + FAR_PRODUCT, overview_level=1) as d:  # level 1 = 4x
            assert abs(d.res[0] - 240.0) < 1e-6, d.res
            w = from_bounds(-h, -h, h, h, d.transform).round_offsets().round_lengths()
            arr = d.read(1, window=w).astype(np.float32)
            wt = d.window_transform(w)
    clip = Clip(arr, "stere_s", wt.c, wt.f, wt.a, -wt.e, 240.0, FAR_PRODUCT + "#ovr4")
    clip.save(path)
    return clip


def fetch_clips():
    from lunarnav.dem import CLIP_DIR, Clip, _clip_meta, mmap_sidecar, polar_clip

    t = time.time()
    c = polar_clip(-90.0, 0.0, 60.0, 20.0)
    print("near clip", c.heights_m.shape, f"{time.time() - t:.0f}s", flush=True)
    t = time.time()
    c = far_regional_clip()
    print("far clip", c.heights_m.shape, f"{time.time() - t:.0f}s", flush=True)
    # memory-map the two big regional clips (keeps the API inside 512 MB)
    for p in CLIP_DIR.glob("polar_*.npz"):
        m = _clip_meta(p)
        if m["shape"][0] * m["shape"][1] >= 4000 * 4000 and not mmap_sidecar(p).exists():
            Clip.load(p).write_mmap_sidecar(p)
            print("mmap sidecar", p.name, flush=True)


if __name__ == "__main__":
    fetch_kernels()
    fetch_clips()
    print("runtime data ready")
