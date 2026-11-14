"""Sun / Earth topocentric geometry for a fixed site on the Moon.

Everything is in the MOON_ME frame (DE440 mean-Earth realised as DE421 ME),
which is the frame of the LOLA DEMs and of JPL Horizons lunar site coordinates.
Mixing MOON_PA would shift sites by ~875 m.

Conventions
-----------
* latitude / longitude in degrees, longitude east-positive (0..360 or -180..180)
* height in metres above the 1737.4 km reference sphere (LOLA datum)
* azimuth clockwise from local north, 0..360 deg
* elevation above the local plane normal to the reference sphere
* aberration correction CN+S (converged light time + stellar aberration),
  i.e. *apparent* directions, which is what Horizons QUANTITIES=4 reports.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import spiceypy as spice

ROOT = Path(__file__).resolve().parents[2]
KERNEL_DIR = ROOT / "data" / "kernels"
KERNELS = [
    "naif0012.tls",
    "pck00011.tpc",
    "de440s.bsp",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
]

MOON_RADIUS_KM = 1737.4
SUN_RADIUS_KM = 695_700.0
EARTH_RADIUS_KM = 6_378.137
FRAME = "MOON_ME"
ABCORR = "CN+S"

_loaded = False


def load_kernels() -> None:
    global _loaded
    if _loaded:
        return
    for k in KERNELS:
        p = KERNEL_DIR / k
        if not p.exists():
            raise FileNotFoundError(f"missing SPICE kernel {p} - run scripts/fetch_kernels")
        spice.furnsh(str(p))
    _loaded = True


@dataclass(frozen=True)
class Site:
    lat: float  # deg
    lon: float  # deg east
    h_m: float = 0.0  # metres above 1737.4 km sphere (include mast height here)
    name: str = ""

    @property
    def lon360(self) -> float:
        return self.lon % 360.0

    def vector_km(self) -> np.ndarray:
        """Body-fixed MOON_ME position of the site, km."""
        r = MOON_RADIUS_KM + self.h_m / 1000.0
        la, lo = np.radians(self.lat), np.radians(self.lon)
        return np.array([r * np.cos(la) * np.cos(lo), r * np.cos(la) * np.sin(lo), r * np.sin(la)])

    def enu_basis(self) -> np.ndarray:
        """Rows: unit East, North, Up vectors in MOON_ME (sphere normal)."""
        la, lo = np.radians(self.lat), np.radians(self.lon)
        e = np.array([-np.sin(lo), np.cos(lo), 0.0])
        n = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
        u = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
        return np.vstack([e, n, u])


def utc_to_et(utc: str | list[str]) -> float | np.ndarray:
    load_kernels()
    if isinstance(utc, str):
        return spice.str2et(utc)
    return np.array([spice.str2et(u) for u in utc])


def et_to_utc(et: float, prec: int = 0) -> str:
    load_kernels()
    return spice.et2utc(float(et), "ISOC", prec) + "Z"


def et_range(start_utc: str, stop_utc: str, step_s: float) -> np.ndarray:
    a, b = utc_to_et(start_utc), utc_to_et(stop_utc)
    n = int(np.floor((b - a) / step_s)) + 1
    return a + np.arange(n) * step_s


_TARGET = {"SUN": ("SUN", SUN_RADIUS_KM), "EARTH": ("EARTH", EARTH_RADIUS_KM)}


def apparent_vectors(site: Site, et: np.ndarray, target: str) -> np.ndarray:
    """Apparent site->target vectors (km) in MOON_ME for each epoch, shape (n,3).

    spkcpo = constant-position observer on the Moon, frame MOON_ME evaluated at
    the observation epoch, light time + stellar aberration applied.
    """
    load_kernels()
    tgt, _ = _TARGET[target.upper()]
    obs = site.vector_km()
    et = np.atleast_1d(np.asarray(et, dtype=float))
    out = np.empty((et.size, 3))
    for i, t in enumerate(et):
        state, _lt = spice.spkcpo(tgt, float(t), FRAME, "OBSERVER", ABCORR, obs, "MOON", FRAME)
        out[i] = state[:3]
    return out


def azel(site: Site, et, target: str = "SUN") -> dict[str, np.ndarray]:
    """Apparent azimuth/elevation (deg), range (km) and angular radius (deg)."""
    v = apparent_vectors(site, et, target)
    enu = v @ site.enu_basis().T
    rng = np.linalg.norm(v, axis=1)
    az = np.degrees(np.arctan2(enu[:, 0], enu[:, 1])) % 360.0
    el = np.degrees(np.arcsin(np.clip(enu[:, 2] / rng, -1, 1)))
    radius = _TARGET[target.upper()][1]
    ang_r = np.degrees(np.arcsin(radius / rng))
    return {"az": az, "el": el, "range_km": rng, "ang_radius": ang_r}


def center_vectors(et, target: str = "SUN") -> np.ndarray:
    """Apparent Moon-centre -> target vectors (km, MOON_ME), shape (n,3).

    Compute once per time grid, then reuse for any number of sites with
    azel_from_center(): the site->target vector is V - site_vec (parallax handled
    exactly; the light-time/aberration difference between centre and surface is
    < 0.01 arcsec for the Sun and Earth)."""
    load_kernels()
    tgt, _ = _TARGET[target.upper()]
    et = np.atleast_1d(np.asarray(et, dtype=float))
    out = np.empty((et.size, 3))
    for i, t in enumerate(et):
        p, _lt = spice.spkpos(tgt, float(t), FRAME, ABCORR, "MOON")
        out[i] = p
    return out


def azel_from_center(site: Site, V: np.ndarray, target: str = "SUN") -> dict[str, np.ndarray]:
    v = V - site.vector_km()
    enu = v @ site.enu_basis().T
    rng = np.linalg.norm(v, axis=1)
    az = np.degrees(np.arctan2(enu[:, 0], enu[:, 1])) % 360.0
    el = np.degrees(np.arcsin(np.clip(enu[:, 2] / rng, -1, 1)))
    ang_r = np.degrees(np.arcsin(_TARGET[target.upper()][1] / rng))
    return {"az": az, "el": el, "range_km": rng, "ang_radius": ang_r}


def azel_spice(site: Site, et: float, target: str = "SUN") -> tuple[float, float]:
    """Cross-check path using SPICE's own azlcpo (sphere so ELLIPSOID==sphere normal)."""
    load_kernels()
    azlsta, _lt = spice.azlcpo(
        "ELLIPSOID", target.upper(), float(et), ABCORR, False, True, site.vector_km(), "MOON", FRAME
    )
    return float(np.degrees(azlsta[1]) % 360.0), float(np.degrees(azlsta[2]))


@lru_cache(maxsize=1)
def spice_version() -> str:
    return spice.tkvrsn("TOOLKIT")
