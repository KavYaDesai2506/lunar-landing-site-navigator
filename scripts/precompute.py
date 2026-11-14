"""Usage: python scripts/precompute.py [site_id ...] [--no-scan] [--merge-only]

--merge-only: skip recomputation; re-attach out/uncertainty/*.json and rebuild index.json."""
import sys
from lunarnav.precompute import main

args = [a for a in sys.argv[1:] if not a.startswith("--")]
main(args or None, scan="--no-scan" not in sys.argv, merge_only="--merge-only" in sys.argv)
