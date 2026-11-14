"""Add `open_events` and the mission_replay extras (open-horizon sunset, 30-min track) to
existing out/sites/<id>.json without a full rebuild (no terrain reads).

The default-mast horizon stored in each file is enough: open-horizon events only need the
site position, and the replay track only needs the horizon elevations.

    .venv/Scripts/python scripts/add_open_events.py
    .venv/Scripts/python scripts/precompute.py --merge-only   # refresh index.json
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from lunarnav.horizon import Horizon  # noqa: E402
from lunarnav.precompute import OUT, WINDOW, _iso, open_events, replay_extras  # noqa: E402
from lunarnav.sites import BY_ID  # noqa: E402


def horizon_from_json(d: dict) -> Horizon:
    n = d["n_az"]
    z = np.zeros(n)
    g = lambda k: np.asarray(d[k], float) if k in d else z  # noqa: E731
    return Horizon(d["lat"], d["lon"], d["mast_m"], d["ground_m"], np.arange(n) * d["az_step_deg"],
                   np.asarray(d["el_deg"], float), g("block_dist_km"), g("block_lat"), g("block_lon"),
                   g("block_h_m"), d["near_res_m"], d["far_res_m"], d["near_km"], d["far_km"], d["sources"])


def main():
    for f in sorted(OUT.glob("*.json")):
        if f.name == "index.json":
            continue
        t0 = time.time()
        p = json.loads(f.read_text())
        h = horizon_from_json(p["horizons"][f"{p['default_mast_m']:g}"])
        p["open_events"] = open_events(h, *WINDOW)
        mr = p.get("mission_replay")
        if mr:
            m = BY_ID[p["id"]]["mission"]
            start, stop = mr["window"]
            # sanity: same window rule as precompute.mission_replay
            assert start == _iso(datetime.fromisoformat(m["landed_utc"]) - timedelta(days=1))
            mr.update(replay_extras(m, h, start, stop))
        f.write_text(json.dumps(p, separators=(",", ":")))
        o = (mr or {}).get("first_open_sunset_after_landing")
        t = (mr or {}).get("first_terrain_sunset_after_landing")
        extra = f"  terrain sunset {t['utc'] if t else '-'} | open {o['utc'] if o else '-'}" if mr else ""
        print(f"[ok] {p['id']:24s} {len(p['open_events']):4d} open events {time.time() - t0:5.1f} s{extra}")


if __name__ == "__main__":
    main()
