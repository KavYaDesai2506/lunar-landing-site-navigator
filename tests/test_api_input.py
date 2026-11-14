"""API input validation (no terrain reads)."""
import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from lunarnav.api import app  # noqa: E402

client = TestClient(app)  # not used as a context manager -> startup warm-up skipped


@pytest.mark.parametrize("path", ["/site", "/horizon"])
def test_north_polar_is_clean_422(path):
    r = client.get(path, params={"lat": 85.0, "lon": 10.0})
    assert r.status_code == 422
    assert "North polar" in r.json()["detail"]


def test_lat_out_of_range_422():
    assert client.get("/site", params={"lat": 95.0, "lon": 0}).status_code == 422
