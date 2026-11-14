"""Convert the USGS/IAU lunar nomenclature DBF to a compact JSON used for ridge naming.

Source: https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip
(Gazetteer of Planetary Nomenclature, IAU WGPSN / USGS Astrogeology).
"""
import json
import struct
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "data" / "gazetteer"


def read_dbf(path):
    with open(path, "rb") as f:
        h = f.read(32)
        n, hl, rl = struct.unpack("<IHH", h[4:12])
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        f.seek(hl)
        for _ in range(n):
            rec = f.read(rl)
            if rec[:1] == b"*":
                continue
            out, pos = {}, 1
            for name, ln in fields:
                out[name] = rec[pos : pos + ln].decode("utf-8", "replace").strip()
                pos += ln
            yield out


def main():
    rows = []
    for r in read_dbf(D / "MOON_nomenclature_center_pts.dbf"):
        if r["approval"] and "Dropped" in r["approval"]:
            continue
        try:
            lat, lon, dia = float(r["center_lat"]), float(r["center_lon"]) % 360, float(r["diameter"] or 0)
        except ValueError:
            continue
        rows.append({"name": r["clean_name"] or r["name"], "type": r["type"], "lat": round(lat, 4),
                     "lon": round(lon, 4), "diam_km": round(dia, 2)})
    (D / "moon_features.json").write_text(json.dumps(rows, separators=(",", ":")))
    print(len(rows), "features")


if __name__ == "__main__":
    main()
