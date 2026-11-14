"""PGDA refused (HTTP 403 from Vercel, 13 Nov 2026): the API must fall back to cached terrain
or answer 503, never 500. Calls the endpoint functions directly (no httpx needed)."""
import pytest
from fastapi import HTTPException

from lunarnav import api, dem


def _regional_240m_cached():
    return dem.find_cached_clip(-80.0, 30.0, 150.0, 240.0) is not None


@pytest.fixture
def pgda_down(monkeypatch):
    def refuse(*a, **k):
        raise RuntimeError("HTTP response code: 403")
    monkeypatch.setattr(dem, "polar_clip", refuse)
    api._horizon.cache_clear()
    yield
    api._horizon.cache_clear()


@pytest.mark.skipif(not _regional_240m_cached(), reason="needs the 240 m regional clip (fetch_runtime_data.py)")
def test_polar_point_falls_back_to_bundled_terrain(pgda_down):
    r = api.horizon(lat=-82.0, lon=30.0, mast=2.0)
    assert r["degraded"] and "240" in r["degraded"]
    assert r["near_res_m"] >= 200


def test_point_outside_bundle_is_503(pgda_down):
    with pytest.raises(HTTPException) as e:
        api.horizon(lat=-65.0, lon=30.0, mast=2.0)
    assert e.value.status_code == 503
    assert "PGDA" in e.value.detail


def test_degraded_flag_does_not_leak_to_cached_clips(pgda_down):
    if not _regional_240m_cached():
        pytest.skip("needs the 240 m regional clip")
    api.horizon(lat=-82.0, lon=30.0, mast=2.0)
    clip = dem.find_cached_clip(-80.0, 30.0, 150.0, 240.0)
    assert getattr(clip, "degraded", None) is None
