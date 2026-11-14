"""Assemble a self-contained Vercel project for the engine API in deploy/vercel-api/.

    python scripts/fetch_runtime_data.py      # once: kernels + regional clips + mmap sidecars
    python scripts/build_vercel_api.py
    cd deploy/vercel-api && npx vercel@65.14.0 deploy --prod --yes

The bundle holds the engine source, SPICE kernels, the two regional south-polar clips
(memory-mapped .npy + a meta-only .npz stub), and the small data files the API imports.
Clips fetched at request time go to /tmp (LUNARNAV_CACHE_DIR).
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from lunarnav.dem import CLIP_DIR, _clip_meta, mmap_sidecar  # noqa: E402

OUT = ROOT / "deploy" / "vercel-api"

INDEX = '''"""Vercel entry point: the FastAPI engine (custom coordinates for the dashboard)."""
import os
import sys
from pathlib import Path

os.environ.setdefault("LUNARNAV_CACHE_DIR", "/tmp/lunarnav-clips")
os.environ.setdefault("LUNARNAV_CLIP_CACHE", "2")
os.environ.setdefault("LUNARNAV_HORIZON_CACHE", "8")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from urllib.parse import parse_qsl, urlencode  # noqa: E402

from lunarnav.api import app as engine  # noqa: E402


async def app(scope, receive, send):
    """Vercel rewrites every path to /api/index and passes the original as ?__p=<path>;
    restore it so FastAPI routes normally."""
    if scope["type"] == "http":
        q = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
        orig = next((v for k, v in q if k == "__p"), None)
        if orig is not None:
            rest = urlencode([(k, v) for k, v in q if k != "__p"])
            scope = dict(scope, path=orig, raw_path=orig.encode(), query_string=rest.encode())
    await engine(scope, receive, send)
'''

REQUIREMENTS = """spiceypy>=8.3
numpy>=2.1
scipy>=1.14
rasterio>=1.4
pyproj>=3.7
requests>=2.32
fastapi>=0.115
"""

VERCEL_JSON = {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "functions": {
        "api/index.py": {
            "maxDuration": 300,
            "memory": 2048,
            "includeFiles": "{src/**,data/**}",
        }
    },
    "rewrites": [{"source": "/(.*)", "destination": "/api/index?__p=/$1"}],
}


def main():
    keep = {".vercel", ".env.local"}  # Vercel project link survives rebuilds
    if OUT.exists():
        for q in OUT.iterdir():
            if q.name not in keep:
                shutil.rmtree(q) if q.is_dir() else q.unlink()
    (OUT / "api").mkdir(parents=True)
    (OUT / "api" / "index.py").write_text(INDEX)
    (OUT / "requirements.txt").write_text(REQUIREMENTS)
    (OUT / ".python-version").write_text("3.12\n")
    (OUT / "vercel.json").write_text(json.dumps(VERCEL_JSON, indent=2))
    (OUT / ".vercelignore").write_text("__pycache__/\n*.pyc\n.env.local\n.vercel\n")

    shutil.copytree(ROOT / "src" / "lunarnav", OUT / "src" / "lunarnav",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copytree(ROOT / "data" / "kernels", OUT / "data" / "kernels")
    (OUT / "data" / "artemis").mkdir(parents=True)
    shutil.copy2(ROOT / "data" / "artemis" / "regions.json", OUT / "data" / "artemis")
    (OUT / "data" / "gazetteer").mkdir(parents=True)
    shutil.copy2(ROOT / "data" / "gazetteer" / "moon_features.json", OUT / "data" / "gazetteer")

    clips = OUT / "data" / "dem" / "clips"
    clips.mkdir(parents=True)
    n = 0
    for p in CLIP_DIR.glob("polar_*.npz"):
        side = mmap_sidecar(p)
        if not side.exists():
            continue
        m = _clip_meta(p)
        # meta-only stub: Clip.load takes the heights from the memory-mapped sidecar
        np.savez(clips / p.name, heights_m=np.zeros((0, 0), np.float32), meta=json.dumps(m))
        if side.stat().st_size < 90e6:
            shutil.copy2(side, clips / side.name)
        else:  # Vercel CLI rejects files > 100 MB: ship row blocks, re-assembled into /tmp on load
            a = np.load(side, mmap_mode="r")
            k = int(np.ceil(side.stat().st_size / 80e6))
            for i, blk in enumerate(np.array_split(np.arange(a.shape[0]), k)):
                np.save(clips / f"{p.stem}.heights.part{i}.npy", np.asarray(a[blk[0]:blk[-1] + 1]))
            print("  split into", k, "parts")
        n += 1
        print("clip", p.name, m["res_m"], m["shape"])
    if n == 0:
        raise SystemExit("no mmap sidecars in data/dem/clips: run scripts/fetch_runtime_data.py first")
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1e6
    print(f"bundle data+code: {size:.0f} MB -> {OUT}")


if __name__ == "__main__":
    main()
