"""(Re)compute `mission_replay` for every site that has a mission record, from the horizon
already stored in out/sites/<id>.json (no terrain reads). Added 14 Nov 2026 for the Apollo and
Chang'e landings (daylight stays, replayed but not scored) and the Sun/Earth clearance fields.

    .venv/Scripts/python scripts/add_mission_replays.py
    .venv/Scripts/python scripts/precompute.py --merge-only   # refresh index.json
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from add_open_events import horizon_from_json  # noqa: E402
from lunarnav.precompute import OUT, mission_replay  # noqa: E402
from lunarnav.sites import BY_ID  # noqa: E402

UNSCORED = {"daylight_stay", "still_operating"}


def main():
    for f in sorted(OUT.glob("*.json")):
        if f.name == "index.json":
            continue
        p = json.loads(f.read_text())
        site = BY_ID.get(p["id"])
        if not site or not site.get("mission"):
            continue
        t0 = time.time()
        h = horizon_from_json(p["horizons"][f"{p['default_mast_m']:g}"])
        fresh = mission_replay(site, h)
        old = p.get("mission_replay")
        if old and old.get("expected") not in UNSCORED:
            # scored replays keep the events computed from the full-precision horizon (the stored one
            # rounds event times by ~1 s); only the clearance fields are added
            old.update({k: fresh[k] for k in ("sun_clearance_deg_at", "earth_clearance_deg_at")})
        else:
            p["mission_replay"] = fresh
        f.write_text(json.dumps(p, separators=(",", ":")))
        r = p["mission_replay"]
        s = r["first_terrain_sunset_after_landing"]
        c = r["sun_clearance_deg_at"]
        print(f"[ok] {p['id']:14s} {r['expected']:17s} sun {c['landed']:6.2f} -> {c['end']:6.2f} deg  "
              f"first terrain sunset {s['utc'] if s else '-'}  frac_end {r['sun_frac_at_end']}  {time.time() - t0:4.1f} s")


if __name__ == "__main__":
    main()
