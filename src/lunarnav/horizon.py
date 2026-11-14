"""Terrain horizon mask with ridge attribution.

For each of N azimuths (default 720, 0.5 deg) we march along the great circle
leaving the site, sample LOLA heights (near field at native resolution, far field
at ~240 m), and compute the exact 3D elevation angle of every terrain sample as seen
from the observer (curvature included, no small-angle approximations).

The horizon H(az) is the max over each ray; we also keep *which* sample produced it
(distance, lat/lon, height) - that's what lets us say "sunset behind the ridge 38 km
away at azimuth 312 deg".
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .dem import Clip, R_M, site_clips

DEFAULT_N_AZ = 720


@dataclass
class Horizon:
    lat: float
    lon: float
    mast_m: float
    ground_m: float  # DEM height at site, m above 1737.4 km
    az: np.ndarray  # deg, ray azimuths
    el: np.ndarray  # deg, horizon elevation per ray
    block_dist_km: np.ndarray
    block_lat: np.ndarray
    block_lon: np.ndarray
    block_h_m: np.ndarray
    near_res_m: float
    far_res_m: float
    near_km: float
    far_km: float
    sources: list[str] = field(default_factory=list)

    @property
    def observer_h_m(self) -> float:
        return self.ground_m + self.mast_m

    def at(self, az_deg) -> np.ndarray:
        """Horizon elevation at arbitrary azimuth(s), periodic linear interpolation."""
        a = np.asarray(az_deg, float) % 360.0
        step = 360.0 / self.az.size
        i = a / step
        i0 = np.floor(i).astype(int) % self.az.size
        i1 = (i0 + 1) % self.az.size
        f = i - np.floor(i)
        return self.el[i0] * (1 - f) + self.el[i1] * f

    def nearest_ray(self, az_deg) -> np.ndarray:
        return np.rint(np.asarray(az_deg, float) % 360.0 / (360.0 / self.az.size)).astype(int) % self.az.size

    def to_dict(self, decimals: int = 4) -> dict:
        r = lambda x, d=decimals: np.round(np.asarray(x, float), d).tolist()
        return {
            "lat": self.lat,
            "lon": self.lon,
            "mast_m": self.mast_m,
            "ground_m": round(self.ground_m, 2),
            "n_az": int(self.az.size),
            "az_step_deg": 360.0 / self.az.size,
            "el_deg": r(self.el),
            "block_dist_km": r(self.block_dist_km, 2),
            "block_lat": r(self.block_lat, 5),
            "block_lon": r(self.block_lon, 5),
            "block_h_m": r(self.block_h_m, 1),
            "near_res_m": self.near_res_m,
            "far_res_m": self.far_res_m,
            "near_km": self.near_km,
            "far_km": self.far_km,
            "sources": self.sources,
        }


def _gc_points(lat0, lon0, az_deg, dist_m):
    """Unit vectors / lat-lon of points at distance dist_m along azimuths az from site.
    Returns (lat, lon, U) with shapes (n_az, n_d) and U (n_az, n_d, 3)."""
    la, lo = np.radians(lat0), np.radians(lon0)
    u0 = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    e = np.array([-np.sin(lo), np.cos(lo), 0.0])
    n = np.array([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
    az = np.radians(az_deg)[:, None, None]
    th = (dist_m / R_M)[None, :, None]
    dirv = np.cos(az) * n + np.sin(az) * e  # (n_az,1,3)
    U = np.cos(th) * u0 + np.sin(th) * dirv
    lat = np.degrees(np.arcsin(np.clip(U[..., 2], -1, 1)))
    lon = np.degrees(np.arctan2(U[..., 1], U[..., 0]))
    return lat, lon, U, u0


def compute_horizon(
    lat: float,
    lon: float,
    mast_m: float = 2.0,
    n_az: int = DEFAULT_N_AZ,
    near: Clip | None = None,
    far: Clip | None = None,
    near_km: float = 20.0,
    far_km: float | None = None,
    ground_m: float | None = None,
    snap: bool = True,
) -> Horizon:
    """snap=True moves the observer to the nearest near-field DEM pixel centre and uses
    that pixel's height as ground (grid-point evaluation, as in Mazarico 2011 / Gläser
    2018). Bilinear ground between pixels can sit below neighbouring pixel centres, and
    at mast 0 m a 0.2 m bump 20 m away blocks the Sun at 0.6 deg - comparable to the
    whole polar Sun band. Snapped coordinates are reported on the Horizon."""
    if near is None or far is None:
        near, far, far_km = site_clips(lat, lon, near_km=near_km, far_km=far_km)
    far_km = far_km or 200.0
    return compute_horizon_tiers(lat, lon, mast_m, [(near, near_km), (far, far_km)], n_az=n_az,
                                 ground_m=ground_m, snap=snap)


def compute_horizon_tiers(
    lat: float,
    lon: float,
    mast_m: float,
    tiers: list[tuple[Clip, float]],
    n_az: int = DEFAULT_N_AZ,
    ground_m: float | None = None,
    snap: bool = True,
) -> Horizon:
    """General multi-resolution horizon. tiers = [(clip, max_km), ...] finest first; tier i
    is sampled at its own resolution from the previous tier's max distance to its own.
    Holes (NaN) in a tier are filled from coarser tiers. The observer snaps to the finest
    tier's pixel centre."""
    first = tiers[0][0]
    if snap and ground_m is None:
        r, c = first.pixel_index(lon, lat)
        lat, lon, ground_m = first.pixel_center(r, c)
    az = np.arange(n_az) * (360.0 / n_az)

    segs, prev = [], 0.0
    for clip, max_km in tiers:
        d = np.arange(prev + clip.res_m, max_km * 1000.0 + 1e-6, clip.res_m)
        segs.append(d)
        if d.size:
            prev = d[-1]
    dist = np.concatenate(segs)

    lat_g, lon_g, U, u0 = _gc_points(lat, lon, az, dist)
    h = np.full(lat_g.shape, np.nan)
    i0 = 0
    for ti, ((clip, _), d) in enumerate(zip(tiers, segs)):
        sl = slice(i0, i0 + d.size)
        h[:, sl] = clip.sample(lon_g[:, sl], lat_g[:, sl])
        for coarser, _ in tiers[ti + 1:]:
            miss = np.isnan(h[:, sl])
            if not miss.any():
                break
            sub = h[:, sl]
            sub[miss] = coarser.sample(lon_g[:, sl][miss], lat_g[:, sl][miss])
            h[:, sl] = sub
        i0 += d.size
    near, far = tiers[0][0], tiers[-1][0]
    near_km, far_km = tiers[0][1], tiers[-1][1]

    if ground_m is None:
        ground_m = float(near.sample(np.array([lon]), np.array([lat]))[0])
    obs_r = R_M + ground_m + mast_m
    O = obs_r * u0
    P = (R_M + h)[..., None] * U
    V = P - O
    vert = V @ u0
    elev = np.degrees(np.arctan2(vert, np.sqrt(np.maximum((V * V).sum(-1) - vert**2, 0))))
    elev = np.where(np.isnan(h), -90.0, elev)

    k = np.argmax(elev, axis=1)
    rows = np.arange(n_az)
    return Horizon(
        lat=lat,
        lon=lon,
        mast_m=mast_m,
        ground_m=ground_m,
        az=az,
        el=elev[rows, k],
        block_dist_km=dist[k] / 1000.0,
        block_lat=lat_g[rows, k],
        block_lon=lon_g[rows, k] % 360.0,
        block_h_m=h[rows, k],
        near_res_m=near.res_m,
        far_res_m=far.res_m,
        near_km=near_km,
        far_km=far_km,
        sources=[t[0].source for t in tiers],
    )
