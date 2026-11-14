import { useEffect, useMemo, useState } from "react";
import { DEFAULT_API, apiHealth, getApiBase, loadFeatures, loadIndex, resetApiBase, setApiBase, useAsync } from "../lib/data";
import { fmtKm, fmtLat, fmtLon, fmtPct, fmtSpan, normLon, roundCoord } from "../lib/format";
import { RELIEF_CREDIT, R_MOON, moonKm, proj, reliefFor, reliefUrl, unproj } from "../lib/polar";
import { setState, useAppState } from "../lib/state";
import type { PolarFeature, SiteHeadline } from "../lib/types";

const ZOOMS = [
  { km: 30, label: "30 km (Shackleton)" },
  { km: 180, label: "180 km" },
  { km: 340, label: "340 km (to 79° S)" },
];

function PolarMap({ sites, features, picked, onPick }: { sites: SiteHeadline[]; features: PolarFeature[]; picked: [number, number] | null; onPick: (lat: number, lon: number) => void }) {
  const [zi, setZi] = useState(1);
  const ext = ZOOMS[zi].km;
  const S = 640;
  const k = S / 2 / ext;
  const rel = reliefFor(ext);
  const P = (lat: number, lon: number): [number, number] => {
    const [x, y] = proj(lat, lon);
    return [S / 2 + x * k, S / 2 - y * k];
  };
  const rings = ext <= 40 ? [-89.75, -89.5, -89.25] : ext <= 200 ? [-88, -86, -84] : [-88, -86, -84, -82, -80];
  const shown = features
    .filter((f) => f.d * k > 5)
    .sort((a, b) => b.d - a.d);
  const pins = sites.filter((h) => {
    const [x, y] = proj(h.lat, h.lon);
    return h.lat < -60 && Math.abs(x) < ext && Math.abs(y) < ext;
  });
  return (
    <div>
      <div className="row-controls">
        <span className="ctl-label" id="map-zoom">
          Map radius
        </span>
        <div className="seg" role="group" aria-labelledby="map-zoom">
          {ZOOMS.map((z, i) => (
            <button key={z.km} aria-pressed={zi === i} onClick={() => setZi(i)}>
              {z.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="polar-map"
        role="img"
        aria-label="Map of the lunar south pole with named craters and the catalogued sites. Click a point to fill in custom coordinates."
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * S;
          const y = ((e.clientY - r.top) / r.height) * S;
          const [lat, lon] = unproj((x - S / 2) / k, (S / 2 - y) / k);
          onPick(+lat.toFixed(4), +lon.toFixed(3));
        }}
      >
        <rect width={S} height={S} className="map-bg" />
        <image href={reliefUrl(rel)} x={S / 2 - rel * k} y={S / 2 - rel * k} width={2 * rel * k} height={2 * rel * k} className="relief" preserveAspectRatio="none" />
        <rect width={S} height={S} className="relief-tint" />
        {shown.map((f) => {
          const [x, y] = P(f.lat, f.lon);
          const r = (f.d / 2) * k;
          if (x + r < 0 || x - r > S || y + r < 0 || y - r > S) return null;
          return (
            <g key={f.n}>
              <circle cx={x} cy={y} r={r} className={f.t === "m" ? "map-mons" : "map-crater"} />
              {r > 20 && (
                <text x={x} y={y + (f.t === "m" ? 4 : r > 40 ? -r + 14 : 4)} textAnchor="middle" className="map-label">
                  {f.n}
                </text>
              )}
            </g>
          );
        })}
        {rings.map((lat) => {
          const r = 2 * R_MOON * Math.tan(((90 + lat) * Math.PI) / 360) * k;
          return (
            <g key={lat}>
              <circle cx={S / 2} cy={S / 2} r={r} className="map-grat" />
              {r < S / 2 - 4 && (
                <text x={S / 2 + 3} y={S / 2 + r - 3} className="axis-text">
                  {Math.abs(lat)}° S
                </text>
              )}
            </g>
          );
        })}
        {[0, 90, 180, 270].map((lon) => {
          const a = (lon * Math.PI) / 180;
          return (
            <g key={lon}>
              <line x1={S / 2} y1={S / 2} x2={S / 2 + Math.sin(a) * S} y2={S / 2 - Math.cos(a) * S} className="map-grat" />
              <text x={S / 2 + Math.sin(a) * (S / 2 - 22)} y={S / 2 - Math.cos(a) * (S / 2 - 14) + 4} textAnchor="middle" className="axis-text strong">
                {lon}° E{lon === 0 ? " · toward Earth" : ""}
              </text>
            </g>
          );
        })}
        <circle cx={S / 2} cy={S / 2} r={2.5} className="map-pole" />
        {pins.map((h, i) => {
          const [x, y] = P(h.lat, h.lon);
          const right = x < S * 0.62;
          return (
            <g
              key={h.id}
              className="map-pin"
              onClick={(e) => {
                e.stopPropagation();
                setState({ view: "site", site: h.id, lat: null, lon: null });
              }}
            >
              <title>{`${h.name}: open this site`}</title>
              <circle cx={x} cy={y} r={6.5} />
              <text x={x + (right ? 9 : -9)} y={y + 4 + (ext > 100 && h.group === "polar" ? (i % 3) * 12 - 12 : 0)} textAnchor={right ? "start" : "end"} className="map-pin-label">
                {h.name}
              </text>
            </g>
          );
        })}
        {picked &&
          (() => {
            const [x, y] = P(picked[0], picked[1]);
            return (
              <g pointerEvents="none">
                <line x1={x - 9} x2={x + 9} y1={y} y2={y} className="map-pick" />
                <line x1={x} x2={x} y1={y - 9} y2={y + 9} className="map-pick" />
              </g>
            );
          })()}
      </svg>
      <p className="note">{RELIEF_CREDIT}. Names from the IAU Gazetteer.</p>
    </div>
  );
}

type SortKey = "name" | "lat" | "sun_avg_pct" | "sun_any_pct" | "earth_any_pct" | "both_pct" | "max_dark_h";

export default function SitesView() {
  const s = useAppState();
  const idx = useAsync(loadIndex, "index");
  const feats = useAsync(loadFeatures, "features");
  const [lat, setLat] = useState(s.lat != null ? String(s.lat) : "-89.45");
  const [lon, setLon] = useState(s.lon != null ? String(s.lon) : "222.84");
  const [mast, setMast] = useState(["0", "2", "10"].includes(s.mast) ? s.mast : "2");
  const [api, setApi] = useState(getApiBase());
  const [health, setHealth] = useState<"idle" | "checking" | "ok" | "down">("idle");
  const [engine, setEngine] = useState("");
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(["sun_avg_pct", -1]);

  const customApi = api.trim().replace(/\/+$/, "") !== DEFAULT_API;
  const latN = Number(lat);
  const lonN = Number(lon);
  const valid = lat.trim() !== "" && lon.trim() !== "" && isFinite(latN) && isFinite(lonN) && latN >= -90 && latN <= 90 && lonN >= -360 && lonN <= 360;
  const outside = valid && latN > -60;

  const check = async (url = api) => {
    if (url.trim() === "" || url.replace(/\/+$/, "") === DEFAULT_API) {
      resetApiBase(); // also drops a ?api= override, which would otherwise win over the saved address
      url = DEFAULT_API;
      setApi(DEFAULT_API);
    } else setApiBase(url);
    setHealth("checking");
    try {
      const h = await apiHealth();
      setEngine(h.engine ?? "");
      setHealth(h.ok ? "ok" : "down");
    } catch {
      setHealth("down");
    }
  };

  // quiet health check on arrival, without touching the saved address
  useEffect(() => {
    let live = true;
    setHealth("checking");
    apiHealth().then(
      (h) => live && (setEngine(h.engine ?? ""), setHealth(h.ok ? "ok" : "down")),
      () => live && setHealth("down"),
    );
    return () => {
      live = false;
    };
  }, []);

  // the preset closest to the typed point: the fallback when the live engine is down
  const preset = useMemo(() => {
    const list = idx.data?.sites ?? [];
    if (!valid || !list.length) return null;
    const r = Math.PI / 180;
    const d = (h: SiteHeadline) => {
      const x = Math.sin(((h.lat - latN) * r) / 2) ** 2 + Math.cos(latN * r) * Math.cos(h.lat * r) * Math.sin(((h.lon - lonN) * r) / 2) ** 2;
      return Math.asin(Math.min(1, Math.sqrt(x)));
    };
    return list.reduce((best, h) => (d(h) < d(best) ? h : best), list[0]);
  }, [idx.data, valid, latN, lonN]);

  const nearest = useMemo(() => {
    const list = idx.data?.sites ?? [];
    if (!valid) return [];
    return list
      .map((h) => ({ h, km: moonKm(latN, lonN, h.lat, h.lon) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
  }, [idx.data, valid, latN, lonN]);

  const rows = useMemo(() => {
    const list = [...(idx.data?.sites ?? [])];
    const [k, dir] = sort;
    list.sort((a, b) => (k === "name" ? a.name.localeCompare(b.name) : (a[k] as number) - (b[k] as number)) * dir);
    return list;
  }, [idx.data, sort]);

  const th = (k: SortKey, label: string, title?: string) => (
    <th scope="col" className={k === "name" ? "" : "num"} aria-sort={sort[0] === k ? (sort[1] > 0 ? "ascending" : "descending") : "none"}>
      <button className="th-sort" title={title} onClick={() => setSort([k, sort[0] === k ? (-sort[1] as 1 | -1) : k === "name" ? 1 : -1])}>
        {label}
        {sort[0] === k ? (sort[1] > 0 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <div className="stack">
      <div className="map-layout">
        <section className="card map-card" aria-labelledby="map-h">
          <h2 id="map-h">Lunar south pole</h2>
          <p className="map-how">
            <span className="map-key pin" aria-hidden /> pin: open that site <span className="map-key cross" aria-hidden /> anywhere else: pick your own point
          </p>
          <PolarMap sites={idx.data?.sites ?? []} features={feats.data ?? []} picked={valid && latN < -60 ? [latN, normLon(lonN)] : null} onPick={(a, b) => (setLat(String(a)), setLon(String(b)))} />
        </section>

        <div className="map-side">
        <section className="card custom-card" aria-labelledby="custom-h" data-hl="custom">
          <h2 id="custom-h">Analyse your own point</h2>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              setApiBase(api === DEFAULT_API ? "" : api);
              setState({ view: "site", site: "custom", lat: roundCoord(latN), lon: normLon(lonN), mast, t: s.t, tab: null });
            }}
          >
            <label>
              <span className="ctl-label">Latitude (south is negative)</span>
              <input className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} aria-invalid={!valid} />
            </label>
            <label>
              <span className="ctl-label">Longitude (east, 0 to 360)</span>
              <input className="input" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} aria-invalid={!valid} />
            </label>
            <div>
              <span className="ctl-label" id="c-mast">
                Mast height
              </span>
              <div className="seg" role="group" aria-labelledby="c-mast">
                {["0", "2", "10"].map((k) => (
                  <button type="button" key={k} aria-pressed={mast === k} onClick={() => setMast(k)}>
                    {k} m
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={!valid}>
              Analyse this point →
            </button>
          </form>
          <p className="note">Same engine as the preset sites. Usually a few seconds.</p>
          {!valid && <p className="note alert">Latitude must be between −90 and 90, longitude between 0 and 360.</p>}
          {valid && (
            <p className="note">
              {fmtLat(roundCoord(latN))}, {fmtLon(normLon(lonN))}
              {outside ? ". Away from the south pole the engine uses coarser terrain and the first request can be slow. The north pole is not covered yet." : ""}
            </p>
          )}

          <p className="engine-line" role="status">
            {health === "idle" || health === "checking" ? (
              <>
                <span className="tag tag-info">… live engine waking up</span> It sleeps when idle and takes about 15 seconds to start.
              </>
            ) : health === "ok" ? (
              <>
                <span className="tag tag-match">✓ live engine ready</span>
              </>
            ) : (
              <>
                <span className="tag tag-fail">live engine not answering</span> {customApi ? "Nothing answered at the address set under Advanced." : "It may still be starting."} The preset sites never need it.
              </>
            )}
          </p>
          {health === "down" && (
            <div className="row-controls">
              <button className="btn btn-primary" type="button" onClick={() => check()}>
                Check again
              </button>
              <button className="btn" type="button" onClick={() => setState({ view: "site", site: preset?.id ?? "shackleton_rim_s", lat: null, lon: null, mast: "2", tab: null })}>
                Try a preset{preset ? `: ${preset.name}` : ""}
              </button>
            </div>
          )}

          <details className="explain">
            <summary>What terrain does a custom point use?</summary>
            <p>
              20 m per pixel near the pole when NASA's terrain server answers, and a coarser 240 m copy bundled with the engine when it does not. The result always says which one it used; on the coarser one, times are approximate.
            </p>
          </details>
          <details className="explain" open={customApi || undefined}>
            <summary>Advanced: engine address</summary>
            <p className="note">Only needed if you run the engine yourself. Everything else on this site is precomputed.</p>
            <div className="form form-row">
              <label style={{ flex: 1 }}>
                <span className="ctl-label">Engine address</span>
                <input className="input" value={api} onChange={(e) => (setApi(e.target.value), setHealth("idle"))} spellCheck={false} />
              </label>
              <button className="btn" type="button" onClick={() => check()}>
                Check connection
              </button>
            </div>
            {health === "ok" && engine && <p className="note">Connected · engine {engine}</p>}
            {customApi && (
              <p>
                <button className="btn" type="button" onClick={() => check(DEFAULT_API)}>
                  Reset to the hosted engine
                </button>
              </p>
            )}
            <p className="note">To run it locally, start it from the engine folder, enter http://127.0.0.1:8765 above, then check the connection:</p>
            <pre className="code">.venv/Scripts/python -m uvicorn lunarnav.api:app --app-dir src --port 8765</pre>
          </details>
        </section>

        {nearest.length > 0 && (
          <section className="card near-card" aria-labelledby="near-h">
            <h2 id="near-h">Preset sites nearest this point</h2>
            <ul className="near-list">
              {nearest.map(({ h, km }) => (
                <li key={h.id}>
                  <button className="near-row" onClick={() => setState({ view: "site", site: h.id, lat: null, lon: null })} title={`Open ${h.name}`}>
                    <span className="near-name">{h.name}</span>
                    <span className="near-km">{fmtKm(km)}</span>
                    <span className="near-bar" aria-hidden>
                      <i style={{ width: `${Math.round(h.sun_avg_pct)}%` }} />
                    </span>
                    <span className="near-pct" title="Average illumination, 2 m mast">
                      {fmtPct(h.sun_avg_pct, 0)} lit
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>
      </div>

      <section className="card" aria-labelledby="cat-h">
        <h2 id="cat-h">{rows.length} preset sites</h2>
        <p className="card-lede">Click a name to open the site, a column to sort. Long-term values for a 2 m mast.</p>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {th("name", "Site")}
                {th("lat", "Latitude")}
                {th("sun_avg_pct", "Average illumination", "Mean visible fraction of the Sun's disc")}
                {th("sun_any_pct", "Solar visibility", "Share of time any part of the Sun shows")}
                {th("max_dark_h", "Longest darkness")}
                {th("earth_any_pct", "Earth visibility", "Any part of Earth's disc; optimistic for radio links")}
                {th("both_pct", "Sun and Earth")}
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <th scope="row">
                    <button className="linkish" onClick={() => setState({ view: "site", site: h.id, lat: null, lon: null })}>
                      {h.name}
                    </button>
                    <span className="hint">{h.group === "artemis" ? "Artemis III region (best-lit point)" : h.group === "polar" ? "south-polar candidate" : h.group === "apollo" ? "Apollo" : h.country ?? "mission"}</span>
                  </th>
                  <td className="num">{fmtLat(h.lat, 2)}</td>
                  <td className="num">
                    <span className="bar-cell">
                      <span className="bar sun" style={{ width: `${h.sun_avg_pct * 0.5}px` }} aria-hidden />
                      {fmtPct(h.sun_avg_pct)}
                    </span>
                  </td>
                  <td className="num">{fmtPct(h.sun_any_pct)}</td>
                  <td className="num">{fmtSpan(h.max_dark_h)}</td>
                  <td className="num">{h.far_side ? "never" : fmtPct(h.earth_any_pct)}</td>
                  <td className="num">{h.far_side ? "never" : fmtPct(h.both_pct)}</td>
                  <td>
                    {h.far_side && <span className="chip chip-alert">far side</span>}
                    {h.earth_blocked_by_terrain && <span className="chip chip-alert">Earth hidden by terrain</span>}
                    {h.has_mission && <span className="chip chip-quiet">mission replay</span>}
                    {h.has_uncertainty && <span className="chip chip-quiet" title="Event times checked on NASA's 100 alternative terrains">± error bands</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Not here yet: three of the nine Artemis III candidate regions, and north-polar sites. Any south-polar point can be analysed with the form above.</p>
      </section>
    </div>
  );
}
