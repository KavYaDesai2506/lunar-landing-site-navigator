"""Curated site catalogue + published reference values used by the validation suite.

Coordinates: MOON_ME (mean-Earth) planetocentric degrees, east-positive longitude.
Every value carries a source. Items marked "unverified" must be checked before the demo.
"""
from __future__ import annotations

# --------------------------------------------------------------------------------------
# Gläser et al. 2018 (PSS; NTRS 20170007365) Table 1: surface level, 20 m LOLA DTM,
# hourly 2017-2037.  avg = mean visible solar-disc fraction %, vis = % time any part
# visible, shadow = longest continuous shadow (h). Mazarico 2011 = 240 m grid.
GLASER_TABLE1 = {
    "shackleton_rim_s": dict(lat=-89.7849, lon=203.97, avg=81.0, vis=85.5, shadow=221,
                             mazarico=dict(lat=-89.78, lon=204.27, avg=86.7, vis=90.5)),
    "connecting_ridge_c1": dict(lat=-89.4505, lon=222.84, avg=76.0, vis=81.3, shadow=268,
                                mazarico=dict(lat=-89.45, lon=222.69, avg=89.0, vis=92.7, shadow=141.12)),
    "connecting_ridge_c2": dict(lat=-89.3157, lon=245.94, avg=75.6, vis=80.6, shadow=166),
    "whipple_np": dict(lat=89.3766, lon=126.48, avg=82.9, vis=88.5, shadow=101,
                       mazarico=dict(avg=84.6, vis=89.4)),
}
GLASER_SOURCE = "https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf"

# --------------------------------------------------------------------------------------
LROC_APOLLO = "https://www.lroc.asu.edu/ (Apollo landing-site coordinates, LROC NAC)"

CATALOGUE: list[dict] = [
    # ---- South-pole reference sites (Gläser 2018) -------------------------------------
    dict(id="shackleton_rim_s", name="Shackleton rim (S)", group="polar", lat=-89.7849, lon=203.97,
         note="One of the best-lit spots on the Moon", source=GLASER_SOURCE),
    dict(id="connecting_ridge_c1", name="Connecting Ridge C1", group="polar", lat=-89.4505, lon=222.84,
         source=GLASER_SOURCE),
    dict(id="connecting_ridge_c2", name="Connecting Ridge C2", group="polar", lat=-89.3157, lon=245.94,
         source=GLASER_SOURCE),
    dict(id="malapert_region", name="Mons Malapert summit", group="polar", lat=-85.9879, lon=2.0671,
         note=("Artemis III candidate region (Malapert Massif). Point = highest LOLA 20 m DEM pixel within 15 km "
               "(5173 m). The earlier catalogue point (-85.99, 357.07) lay on the south flank, where the massif "
               "itself hides Earth."),
         source="LDEM_80S_20MPP_ADJ peak search; IAU Mons Malapert centre -85.98, 358.33"),
    # ---- Recent landers (mission endings, test 6/7) ------------------------------------
    dict(id="chandrayaan3", name="Chandrayaan-3 Vikram (Shiv Shakti Point)", group="mission", country="India",
         lat=-69.373, lon=32.319,
         mission=dict(landed_utc="2023-08-23T12:33:00", end_utc="2023-09-04T02:30:00",
                      end_reason="Put to sleep by ISRO ahead of local sunset; did not wake",
                      end_note="ISRO: sleep 4 Sep 2023 ~08:00 IST; sources give 2-4 Sep",
                      expected="sunset_after_end",
                      sources=["https://spacepolicyonline.com/news/india-says-good-night-to-chandrayaan-3/",
                               "https://en.wikipedia.org/wiki/Chandrayaan-3"])),
    dict(id="im1", name="IM-1 Odysseus", group="mission", country="USA (CLPS)", lat=-80.13, lon=1.44,
         mission=dict(landed_utc="2024-02-22T23:23:00", end_utc="2024-02-29T00:00:00",
                      end_reason=("Tipped on landing; power ended 'as the sun moved out of view of the one illuminated "
                                  "solar panel' (SpaceNews via Wikipedia), i.e. a panel-geometry limit, before terrain sunset"),
                      expected="tilt_limited",
                      sources=["https://en.wikipedia.org/wiki/IM-1",
                               "https://spacenews.com/intuitive-machines-and-nasa-call-im-1-lunar-lander-a-success-as-mission-winds-down/"])),
    dict(id="im2", name="IM-2 Athena", group="mission", country="USA (CLPS)", lat=-84.7906, lon=29.1957,
         mission=dict(landed_utc="2025-03-06T17:28:00", end_utc="2025-03-07T06:15:00",
                      end_reason="Landed on its side in a cold crater; power ran out",
                      expected="negative_control",
                      sources=["https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/",
                               "https://www.lroc.asu.edu/images/1401"])),
    dict(id="blue_ghost1", name="Blue Ghost Mission 1", group="mission", country="USA (CLPS)", lat=18.56, lon=61.81,
         mission=dict(landed_utc="2025-03-02T08:34:00", end_utc="2025-03-16T23:25:00",
                      end_reason="Local sunset 16 Mar; batteries lasted ~5 h into the night",
                      expected="sunset_before_end", sunset_reported_utc="2025-03-16",
                      sources=["https://fireflyspace.com/missions/blue-ghost-mission-1/"])),
    dict(id="slim", name="SLIM", group="mission", country="Japan", lat=-13.316, lon=25.251,
         mission=dict(landed_utc="2024-01-19T15:20:00", end_utc="2024-04-28T00:00:00",
                      end_reason="Survived several lunar nights; last contact 28 Apr 2024",
                      expected="multi_night",
                      sources=["https://global.jaxa.jp/press/2024/08/20240826-1_e.html"])),
    # ---- Daylight visits and long-lived landers (replayed, not scored: light did not end them) ----
    dict(id="change3", name="Chang'e-3", group="mission", country="China", lat=44.1214, lon=340.4884,
         source="https://www.lroc.asu.edu/images/811",
         mission=dict(landed_utc="2013-12-14T13:11:00", end_utc="2014-01-12T00:00:00",
                      end_reason=("Still operating: 2025 status checks report the lander working about twelve years "
                                  "after landing. The replay covers its first lunar day and night; the rover was "
                                  "commanded out of sleep mode on 11 Jan 2014"),
                      end_note="end_utc is the end of the replayed first lunar cycle, not an end of mission",
                      expected="still_operating",
                      sources=["https://en.wikipedia.org/wiki/Chang%27e_3"])),
    dict(id="change6", name="Chang'e-6", group="mission", country="China", lat=-41.6385, lon=206.0148,
         note="Far side: Earth never visible", source="https://lroc.im-ldi.com/images/1374",
         mission=dict(landed_utc="2024-06-01T22:23:16", end_utc="2024-06-03T23:38:10",
                      end_reason="Ascent stage lifted off with the samples in daylight after about two days",
                      expected="daylight_stay",
                      sources=["https://en.wikipedia.org/wiki/Chang%27e_6"])),
    # ---- Apollo ------------------------------------------------------------------------
    dict(id="apollo11", name="Apollo 11", group="apollo", lat=0.67416, lon=23.47314, source=LROC_APOLLO,
         mission=dict(landed_utc="1969-07-20T20:17:40", end_utc="1969-07-21T17:54:00",
                      end_reason="Crew lifted off in daylight after the planned surface stay",
                      expected="daylight_stay",
                      sources=["https://en.wikipedia.org/wiki/Apollo_11"])),
    dict(id="apollo12", name="Apollo 12", group="apollo", lat=-3.01239, lon=336.57843, source=LROC_APOLLO,
         mission=dict(landed_utc="1969-11-19T06:54:35", end_utc="1969-11-20T14:25:47",
                      end_reason="Crew lifted off in daylight after the planned surface stay",
                      expected="daylight_stay",
                      sources=["https://en.wikipedia.org/wiki/Apollo_12"])),
    dict(id="apollo14", name="Apollo 14", group="apollo", lat=-3.64530, lon=342.52864, source=LROC_APOLLO,
         mission=dict(landed_utc="1971-02-05T09:18:11", end_utc="1971-02-06T18:48:42",
                      end_reason="Crew lifted off in daylight after the planned surface stay",
                      expected="daylight_stay",
                      sources=["https://en.wikipedia.org/wiki/Apollo_14"])),
    dict(id="apollo15", name="Apollo 15", group="apollo", lat=26.13222, lon=3.63386, source=LROC_APOLLO,
         mission=dict(landed_utc="1971-07-30T22:16:29", end_utc="1971-08-02T17:11:23",
                      end_reason="Crew lifted off in daylight after the planned surface stay",
                      expected="daylight_stay",
                      sources=["https://en.wikipedia.org/wiki/Apollo_15"])),
    dict(id="apollo16", name="Apollo 16", group="apollo", lat=-8.97301, lon=15.50019, source=LROC_APOLLO,
         mission=dict(landed_utc="1972-04-21T02:23:35", end_utc="1972-04-24T01:25:47",
                      end_reason="Crew lifted off in daylight after the planned surface stay",
                      expected="daylight_stay",
                      sources=["https://en.wikipedia.org/wiki/Apollo_16"])),
    dict(id="apollo17", name="Apollo 17", group="apollo", lat=20.19080, lon=30.77168, source=LROC_APOLLO,
         mission=dict(landed_utc="1972-12-11T19:54:58", end_utc="1972-12-14T22:54:37",
                      end_reason="Crew lifted off in daylight after the planned surface stay",
                      expected="daylight_stay",
                      sources=["https://en.wikipedia.org/wiki/Apollo_17"])),
]


def _artemis_sites() -> list[dict]:
    """Artemis III candidate regions: best-lit landable point inside each USGS LGRS box,
    found by scripts/artemis_regions.py (data/artemis/regions.json). Covers 6 of NASA's 9
    current regions; Mons Mouton, Peak near Cabeus B and Slater Plain are not in the LGRS release."""
    import json
    from pathlib import Path
    f = Path(__file__).resolve().parents[2] / "data" / "artemis" / "regions.json"
    if not f.exists():
        return []
    out = []
    for key, r in json.loads(f.read_text()).items():
        b, c = r["best"], r["box_centre"]
        note = (f"Artemis III candidate region ({r['box_km']} km box). Point = best-lit spot with slope <= "
                f"{r['search']['max_slope_deg']:g}° found by our search: {b['avg_pct']}% average illumination at 2 m, "
                f"slope {b['slope_deg']}°; the box centre gets {c['avg_pct']}%.")
        if r.get("note"):
            note += " " + r["note"]
        out.append(dict(id="artemis_" + key.lower(), name=f"Artemis III: {r['nasa_name']}", group="artemis",
                        lat=b["lat"], lon=b["lon"], note=note, source=r["source"],
                        region={"box_ul_lonlat": r["box_ul_lonlat"], "box_lr_lonlat": r["box_lr_lonlat"],
                                "box_km": r["box_km"], "box_centre": c, "best": b, "search": r["search"]}))
    return out


CATALOGUE += _artemis_sites()

BY_ID = {s["id"]: s for s in CATALOGUE}
