"""Machine-readable validation report (feeds the dashboard's Evidence page).

Tests call record(test_id, case_id, metrics); results are merged into
out/validation_report.json so partial test runs don't erase other tests.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from .ephem import ROOT

REPORT = ROOT / "out" / "validation_report.json"


def record(test_id: str, case_id: str, metrics: dict) -> None:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(REPORT.read_text()) if REPORT.exists() else {"tests": {}}
    data["generated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data["tests"].setdefault(test_id, {})[case_id] = metrics
    REPORT.write_text(json.dumps(data, indent=1))
