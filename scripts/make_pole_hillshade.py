"""Render a shaded-relief PNG of the lunar south pole from a cached LOLA clip.

The dashboard's pole map draws this behind its pins so the locator shows real
NASA terrain (LOLA, via PGDA) instead of plain circles. Input is a clip written
by lunarnav.dem (south polar stereographic, metres, top-left origin x0/y0):
<base>.npz holds the metadata, the heights live in <base>.heights.npy or in
<base>.heights.partN.npy pieces.

Usage:
    python scripts/make_pole_hillshade.py <clip base path> <half width km> <out px> <out.png>

Writes <out.png> (8-bit greyscale) and <out.json> with the map extent in km, so
the dashboard can place it: x right = 90 deg E, y up = 0 deg E, pole at (0, 0).
"""

from __future__ import annotations

import glob
import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np


def load_clip(base: str) -> tuple[np.ndarray, dict]:
    meta = json.loads(str(np.load(base + ".npz")["meta"]))
    single = Path(base + ".heights.npy")
    if single.exists():
        h = np.load(single, mmap_mode="r")
    else:
        parts = sorted(glob.glob(base + ".heights.part*.npy"))
        if not parts:
            raise SystemExit(f"no heights found next to {base}.npz")
        h = np.concatenate([np.load(p, mmap_mode="r") for p in parts], axis=0)
    h = np.asarray(h).reshape(meta["shape"])
    return h, meta


def crop(h: np.ndarray, meta: dict, half_km: float) -> np.ndarray:
    half_m = half_km * 1000.0
    c0 = int(round((-half_m - meta["x0"]) / meta["dx"]))
    c1 = int(round((half_m - meta["x0"]) / meta["dx"]))
    r0 = int(round((meta["y0"] - half_m) / meta["dy"]))
    r1 = int(round((meta["y0"] + half_m) / meta["dy"]))
    if c0 < 0 or r0 < 0 or c1 > h.shape[1] or r1 > h.shape[0]:
        raise SystemExit(f"clip does not cover +-{half_km} km")
    return h[r0:r1, c0:c1].astype(np.float32)


def block_mean(a: np.ndarray, out_px: int) -> np.ndarray:
    k = a.shape[0] // out_px
    a = a[: k * out_px, : k * out_px]
    return a.reshape(out_px, k, out_px, k).mean(axis=(1, 3))


def hillshade(z: np.ndarray, cell_m: float, az_deg: float = 315.0, alt_deg: float = 35.0,
              exaggeration: float = 2.0) -> np.ndarray:
    dzdy, dzdx = np.gradient(z * exaggeration, cell_m)
    # np.gradient runs down the rows (image space), which is the sign this formula expects
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    az = np.radians(360.0 - az_deg + 90.0)
    alt = np.radians(alt_deg)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0.0, 1.0)


def write_png_gray(path: Path, img: np.ndarray) -> None:
    h, w = img.shape
    raw = b"".join(b"\x00" + img[r].tobytes() for r in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    base, half_km, out_px, out = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4])
    h, meta = load_clip(base)
    z = block_mean(crop(h, meta, half_km), out_px)
    cell_m = 2 * half_km * 1000.0 / out_px
    shade = hillshade(z, cell_m)
    # gentle contrast stretch so the dark theme keeps detail in the shadows
    lo, hi = np.percentile(shade, [1, 99.5])
    img = (np.clip((shade - lo) / max(hi - lo, 1e-6), 0, 1) * 255).astype(np.uint8)
    write_png_gray(out, img)
    info = {
        "extent_km": [-half_km, half_km, -half_km, half_km],
        "px": out_px,
        "projection": "south polar stereographic, R=1737.4 km; x right = 90 E, y up = 0 E",
        "source": f"NASA LOLA via PGDA ({meta.get('source')}), {meta['res_m']:.0f} m/px input",
        "light": "hillshade, Sun from upper left, 35 deg, 2x vertical exaggeration",
    }
    out.with_suffix(".json").write_text(json.dumps(info, indent=2))
    print(out, out.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
