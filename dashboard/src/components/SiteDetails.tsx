import { useMemo, useState } from "react";
import Info from "./Info";
import PoleLocator, { onRelief } from "./PoleLocator";
import SourceLink from "./SourceLink";
import { bodyAt, eventBlocker, featureLabels, mastKeys, presentFrac } from "../lib/astro";
import type { Model } from "../lib/astro";
import { setState } from "../lib/state";
import { compass, csvRow, downloadText, fmtAz, fmtDateTime, fmtKm, fmtLat, fmtLon, fmtPct, fmtSpan, parseUtc } from "../lib/format";
import type { Sensitivity, Site, Target } from "../lib/types";

// ---------- 18.6-year statistics by mast height ----------

export function LongTermCard({ site, mast, onMast }: { site: Site; mast: string; onMast?: (m: string) => void }) {
  const keys = mastKeys(site);
  const lt0 = site.longterm[keys[0]];
  const unc = site.uncertainty?.longterm_sun;
  const farSide = lt0.earth.any_visible_pct === 0;
  return (
    <section className="card" aria-labelledby="lt-h">
      <h2 id="lt-h">Raise the mast, gain light</h2>
      <p className="card-lede">
        Lifting the solar panel or antenna clears nearby terrain. Averages over {lt0.start_utc.slice(0, 4)} to {lt0.stop_utc.slice(0, 4)}, one full 18.6-year cycle of the Moon's orbit.{onMast ? " Click a height to use it everywhere on this page." : ""}
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Mast</th>
              <th scope="col" className="num">
                Average illumination <Info label="What average illumination means">The share of the Sun's disc in view, averaged over time. A half-hidden Sun counts as half.</Info>
              </th>
              <th scope="col" className="num">
                Solar visibility{" "}
                <Info label="What solar visibility means">The share of time any part of the Sun shows. It runs about 5 points above average illumination at the same spot, so check which one a paper quotes.</Info>
              </th>
              <th scope="col" className="num">
                Longest darkness
              </th>
              <th scope="col" className="num">
                Earth visibility{" "}
                <Info label="What Earth visibility means">The share of time any part of Earth's disc shows. NASA's PGDA calls this slightly optimistic for a radio link to one ground station.</Info>
              </th>
              <th scope="col" className="num">
                Sun and Earth
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const lt = site.longterm[k];
              return (
                <tr key={k} className={k === mast ? "row-sel" : ""}>
                  <th scope="row">
                    {onMast && keys.length > 1 ? (
                      <button className="linkish" onClick={() => onMast(k)} aria-pressed={k === mast}>
                        {k} m
                      </button>
                    ) : (
                      `${k} m`
                    )}
                    {k === mast ? <span className="chip chip-quiet">shown</span> : null}
                  </th>
                  <td className="num">
                    <span className="bar-cell">
                      <span className="bar sun" style={{ width: `${lt.sun.avg_fraction_pct * 0.6}px` }} aria-hidden />
                      {fmtPct(lt.sun.avg_fraction_pct)}
                    </span>
                  </td>
                  <td className="num">{fmtPct(lt.sun.any_visible_pct)}</td>
                  <td className="num">{fmtSpan(lt.sun.max_dark_h)}</td>
                  <td className="num">{farSide ? "never" : fmtPct(lt.earth.any_visible_pct)}</td>
                  <td className="num">{farSide ? "never" : fmtPct(lt.both_any_pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unc && (
        <p className="note">
          <button type="button" className="chip chip-btn" onClick={() => setState({ tab: "sure" })}>
            How sure
          </button>{" "}
          On NASA's 100 alternative terrains the 2 m average illumination stays between {unc.avg_p10_p50_p90[0].toFixed(1)}% and {unc.avg_p10_p50_p90[2].toFixed(1)}%.{" "}
          <Info label="Why this differs slightly from the table">
            8 in 10 terrains fall in this range (median {unc.avg_p10_p50_p90[1].toFixed(1)}%). That run uses a finer 5 m surface near the site, so its own baseline ({unc.baseline_avg_pct.toFixed(1)}%) sits slightly off the 20 m value in the table.
          </Info>
        </p>
      )}
    </section>
  );
}

// ---------- sensitivity: "move N metres" ----------

export function SensitivityCard({ s }: { s: Sensitivity }) {
  const R = s.radius_px;
  const n = 2 * R + 1;
  const cell = 34;
  const vals = s.cells.map((c) => c.avg_pct);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const at = new Map(s.cells.map((c) => [`${c.dr},${c.dc}`, c]));
  const moved = s.best.dist_m > 0 && s.gain_pp > 0.005;
  return (
    <section className="card" aria-labelledby="sens-h">
      <h2 id="sens-h">A few metres matter</h2>
      <div className="sens-wrap">
        <svg viewBox={`0 0 ${n * cell} ${n * cell}`} className="sens" role="img" aria-label={`Grid of average illumination for DEM pixels around the site, from ${lo.toFixed(1)} to ${hi.toFixed(1)} percent.`}>
          {Array.from({ length: n * n }, (_, k) => {
            const dr = Math.floor(k / n) - R;
            const dc = (k % n) - R;
            const c = at.get(`${dr},${dc}`);
            if (!c) return null;
            const f = hi > lo ? (c.avg_pct - lo) / (hi - lo) : 1;
            const isC = dr === 0 && dc === 0;
            const isB = moved && dr === s.best.dr && dc === s.best.dc;
            return (
              <g key={k}>
                <title>{`${dr === 0 && dc === 0 ? "Site pixel" : `Offset ${dc * s.res_m} m across, ${-dr * s.res_m} m up the grid`}: average illumination ${c.avg_pct.toFixed(1)}%, solar visibility ${c.vis_pct.toFixed(1)}%`}</title>
                <rect x={(dc + R) * cell + 1} y={(dr + R) * cell + 1} width={cell - 2} height={cell - 2} rx={3} style={{ fill: `color-mix(in oklab, var(--seq-hi) ${Math.round(8 + f * 92)}%, var(--seq-lo))` }} />
                <text x={(dc + R) * cell + cell / 2} y={(dr + R) * cell + cell / 2 + 4} textAnchor="middle" className={f > 0.55 ? "sens-t on-dark" : "sens-t"}>
                  {c.avg_pct.toFixed(0)}
                </text>
                {isC && <rect x={(dc + R) * cell + 2.5} y={(dr + R) * cell + 2.5} width={cell - 5} height={cell - 5} rx={3} className="sens-centre" />}
                {isB && <rect x={(dc + R) * cell + 2.5} y={(dr + R) * cell + 2.5} width={cell - 5} height={cell - 5} rx={3} className="sens-best" />}
              </g>
            );
          })}
        </svg>
        <div className="fact-col">
          <div className="tile">
            <div className="tile-label">Best pixel nearby</div>
            <div className="tile-value">{moved ? `+${s.gain_pp.toFixed(2)} pts` : "this one"}</div>
            <div className="tile-state">
              {moved ? (
                <>
                  <i className="sw sw-ring best" /> {Math.round(s.best.dist_m)} m toward {fmtAz(s.best.bearing_deg)} → {s.best.avg_pct.toFixed(1)}%
                </>
              ) : (
                <>already the best-lit pixel within {R * s.res_m} m</>
              )}
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Range within {R * s.res_m} m</div>
            <div className="tile-value">
              {lo.toFixed(1)}–{hi.toFixed(1)}%
            </div>
            <div className="seq-ramp" aria-hidden />
            <div className="tile-state">
              <i className="sw sw-ring centre" /> the site pixel: {s.centre.avg_pct.toFixed(1)}%{" "}
              <Info label="How to read the grid">
                Average illumination over 18.6 years. Each cell is one {s.res_m} m DEM pixel on the polar-stereographic grid; rows and columns are grid offsets, and the compass bearing of the best pixel is given beside it.
              </Info>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- uncertainty from DEM clones ----------

const BUCKETS: [string, number][] = [
  ["under 1 min", 1 / 60],
  ["1 to 5 min", 5 / 60],
  ["5 to 30 min", 0.5],
  ["30 min to 2 h", 2],
  ["2 to 24 h", 24],
  ["over 24 h", Infinity],
];

export function UncertaintyCard({ site, onJump }: { site: Site; onJump: (t: number) => void }) {
  const u = site.uncertainty!;
  const spreads = u.events.map((e) => e.spread_p10_p90_h).sort((a, b) => a - b);
  const median = spreads[Math.floor(spreads.length / 2)];
  const counts = BUCKETS.map(() => 0);
  for (const s of spreads) counts[BUCKETS.findIndex(([, hi]) => s < hi)]++;
  const max = Math.max(...counts);
  const widest = [...u.events].sort((a, b) => b.spread_p10_p90_h - a.spread_p10_p90_h).slice(0, 4);
  const tight = spreads.filter((s) => s < 5 / 60).length;
  const fragile = u.events.filter((e) => presentFrac(e, u.n_clones) < 0.995).sort((a, b) => presentFrac(a, u.n_clones) - presentFrac(b, u.n_clones));
  return (
    <section className="card" aria-labelledby="unc-h">
      <h2 id="unc-h">How sure are these times?</h2>
      <p className="big-fact">
        <b>
          {tight} of {spreads.length}
        </b>{" "}
        event times move by less than 5 minutes when the terrain is wrong by as much as NASA says it could be.
      </p>
      <p className="card-lede">
        We recomputed every sunrise and sunset on <b>{u.n_clones} alternative terrains</b>: NASA's own versions of the elevation map, each shifted within its measurement error. The typical event moves by {fmtSpan(median)}. A few grazing
        events, where the Sun skims a ridge, are far less certain; they are listed below.
      </p>
      <div className="hbar" role="img" aria-label={`Spread of event times across ${u.n_clones} terrain clones: ${BUCKETS.map(([l], i) => `${counts[i]} events ${l}`).join(", ")}.`}>
        {BUCKETS.map(([label], i) => (
          <div className="hbar-row" key={label}>
            <span className="hbar-label">{label}</span>
            <span className="hbar-track">
              <span className={`hbar-fill ${i >= 3 ? "warn" : ""}`} style={{ width: `${(counts[i] / max) * 100}%` }} />
            </span>
            <span className="hbar-val">{counts[i]}</span>
          </div>
        ))}
      </div>
      <h3>The least certain events</h3>
      <ul className="plain">
        {widest.map((e) => (
          <li key={e.utc + e.kind}>
            <button className="linkish" onClick={() => onJump(parseUtc(e.utc))}>
              {fmtDateTime(parseUtc(e.utc))}
            </button>{" "}
            {e.target === "sun" ? "Sun" : "Earth"} {e.kind.replace("_", " ")}: 8 in 10 terrains agree within <b>{fmtSpan(e.spread_p10_p90_h)}</b>
            {presentFrac(e, u.n_clones) < 0.995 ? `; it happens in ${Math.round(presentFrac(e, u.n_clones) * 100)}% of terrain versions` : ""}
          </li>
        ))}
      </ul>
      {fragile.length > 0 && (
        <>
          <h3>Fragile events: {fragile.length} that some terrain versions do not have at all</h3>
          <p className="note">A brief flicker of sunlight past a ridge can vanish when the terrain is a metre different.</p>
          <ul className="plain">
            {fragile.slice(0, 4).map((e) => (
              <li key={"f" + e.utc + e.kind}>
                <button className="linkish" onClick={() => onJump(parseUtc(e.utc))}>
                  {fmtDateTime(parseUtc(e.utc))}
                </button>{" "}
                this {e.target === "sun" ? (e.kind === "first_light" || e.kind === "full_disc" ? "sunrise" : "sunset") : e.kind === "first_light" || e.kind === "full_disc" ? "Earthrise" : "Earthset"} ({e.kind.replace("_", " ")}) happens in{" "}
                <b>{Math.round(presentFrac(e, u.n_clones) * 100)}%</b> of terrain versions
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="note">
        <b>What this does not cover.</b> Only the terrain within about {u.inner_km} km of the site was varied. An error in a distant ridge is not included, so treat the spreads as a lower bound.{" "}
        <button className="linkish" onClick={() => setState({ view: "evidence" })}>
          Method and citations are on the Evidence page
        </button>
        .
      </p>
    </section>
  );
}

/** "How sure" for the sites NASA publishes no alternative terrains for. */
export function NoClonesCard({ custom }: { custom: boolean }) {
  return (
    <section className="card" aria-labelledby="unc-h">
      <h2 id="unc-h">How sure are these times?</h2>
      <p className="card-lede">
        {custom ? "A live point is computed on one terrain model, so its times come without an error band." : "This site is computed on one terrain model, so its times come without an error band."} Where NASA publishes alternative terrains
        (Shackleton rim and Connecting Ridge C1), most sunrise and sunset times move by less than 5 minutes; grazing events, where the Sun skims a ridge, can move by hours.
      </p>
      <div className="row-controls">
        <button className="btn" onClick={() => setState({ site: "shackleton_rim_s", lat: null, lon: null, mast: "2", tab: "sure" }, { push: true })}>
          See the error bands at Shackleton rim
        </button>
        <button className="btn" onClick={() => setState({ view: "evidence" })}>
          Every check against published answers
        </button>
      </div>
    </section>
  );
}

// ---------- where the horizon comes from ----------

export function BlockerRadar({ model: m, t }: { model: Model; t: number }) {
  const S = 340;
  const c = S / 2;
  const rMax = c - 26;
  const dist = m.blk.dist;
  const far = m.site.dem.far_km;
  const lmin = Math.log10(0.05);
  const lmax = Math.log10(Math.max(far, 100));
  const rad = (d: number) => ((Math.log10(Math.max(0.05, d)) - lmin) / (lmax - lmin)) * rMax;
  const P = (az: number, r: number): [number, number] => [c + r * Math.sin((az * Math.PI) / 180), c - r * Math.cos((az * Math.PI) / 180)];
  const geo = useMemo(() => {
    if (!dist) return null;
    const n = dist.length;
    let d = "";
    for (let i = 0; i <= n; i++) {
      const [x, y] = P((i % n) * (360 / n), rad(dist[i % n]));
      d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d + "Z";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);
  if (!dist || !geo) return null;
  const sun = bodyAt(m, "sun", t);
  const earth = bodyAt(m, "earth", t);
  const earthEver = m.any.earth.length > 0;
  const labels = featureLabels(m).slice(0, 5);
  const local = dist.filter((d) => d < 1).length / dist.length;
  const sorted = [...dist].sort((a, b) => a - b);
  const rings = [0.1, 1, 10, 100].filter((r) => r <= Math.max(far, 100));
  const [sx, sy] = P(sun.az, rMax + 8);
  const [ex, ey] = P(earth.az, rMax + 8);
  return (
    <section className="card" aria-labelledby="radar-h">
      <h2 id="radar-h">Which terrain sets the horizon</h2>
      <div className="radar-wrap">
        <svg viewBox={`0 0 ${S} ${S}`} className="radar" role="img" aria-label="Polar plot of the distance to the horizon-setting terrain in every direction, with the current Sun and Earth directions.">
          {rings.map((r) => (
            <g key={r}>
              <circle cx={c} cy={c} r={rad(r)} className="radar-ring" />
              <text x={c + 3} y={c - rad(r) - 2} className="axis-text">
                {r < 1 ? `${r * 1000} m` : `${r} km`}
              </text>
            </g>
          ))}
          {[0, 90, 180, 270].map((a) => {
            const [x, y] = P(a, rMax + 16);
            const [x1, y1] = P(a, rMax);
            return (
              <g key={a}>
                <line x1={c} y1={c} x2={x1} y2={y1} className="radar-ring" />
                <text x={x} y={y + 4} textAnchor="middle" className="axis-text strong">
                  {compass(a)}
                </text>
              </g>
            );
          })}
          <path d={geo} className="radar-shape" />
          <line x1={c} y1={c} x2={sx} y2={sy} className={`radar-ray sun ${sun.frac > 0 ? "" : "hidden"}`} />
          <circle cx={sx} cy={sy} r={6} className={sun.frac > 0 ? "disc-sun" : "disc-ghost sun"} />
          {earthEver && (
            <>
              <line x1={c} y1={c} x2={ex} y2={ey} className={`radar-ray earth ${earth.frac > 0 ? "" : "hidden"}`} />
              <circle cx={ex} cy={ey} r={6} className={earth.frac > 0 ? "disc-earth" : "disc-ghost earth"} />
            </>
          )}
          {labels.map((f) => {
            const [x, y] = P(f.az, rad(f.dist));
            return (
              <g key={f.name + f.az}>
                <circle cx={x} cy={y} r={3} className="radar-dot" />
                <text x={x + (x > c ? 6 : -6)} y={y + 4} textAnchor={x > c ? "start" : "end"} className="terrain-label halo">
                  {f.name}
                </text>
              </g>
            );
          })}
          <circle cx={c} cy={c} r={3.5} className="radar-site" />
        </svg>
        {onRelief(m.site.requested.lat, m.site.requested.lon) && <PoleLocator model={m} t={t} />}
        <div className="fact-col">
          <div className="tile">
            <div className="tile-label">Half the horizon is set within</div>
            <div className="tile-value">{fmtKm(sorted[Math.floor(sorted.length / 2)])}</div>
            <div className="tile-state">{local > 0.005 ? `${Math.round(local * 100)}% of it is ground slope within 1 km` : "none of it is ground slope within 1 km"}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Toward the Sun now</div>
            <div className="tile-value">{fmtKm(dist[Math.round(sun.az * 2) % dist.length])}</div>
            <div className="tile-state">
              <i className="sw sw-dot sunfill" /> horizon set that far away, at {fmtAz(sun.az)}
            </div>
          </div>
          {earthEver && (
            <div className="tile">
              <div className="tile-label">Toward Earth now</div>
              <div className="tile-value">{fmtKm(dist[Math.round(earth.az * 2) % dist.length])}</div>
              <div className="tile-state">
                <i className="sw sw-dot earthfill" /> at {fmtAz(earth.az)}
              </div>
            </div>
          )}
          <p className="note">
            The plot is the site from above: in each direction the shape reaches out to the terrain that blocks the view (logarithmic distance).{m.blk.approx ? " Blocking distances are from the 2 m mast horizon." : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------- event list + CSV ----------

const KIND: Record<Target, Record<string, string>> = {
  sun: { first_light: "Sunrise: first light", full_disc: "Full Sun clear", partial: "Sun partly hidden", last_light: "Sunset: last light" },
  earth: { first_light: "Earthrise", full_disc: "Full Earth clear", partial: "Earth partly hidden", last_light: "Earthset" },
};

export function EventsTable({ model: m, t, onJump }: { model: Model; t: number; onJump: (t: number) => void }) {
  const [target, setTarget] = useState<"all" | Target>("all");
  const [major, setMajor] = useState(true);
  const [count, setCount] = useState(10);
  const hasEarth = m.events.some((e) => e.target === "earth");
  const list = m.events.filter((e) => e.t >= t - 60e3 && (target === "all" || e.target === target) && (!major || e.kind === "first_light" || e.kind === "last_light"));
  const hasUnc = m.events.some((e) => e.unc);

  const exportCsv = () => {
    const rows = [csvRow(["utc", "target", "kind", "azimuth_deg", "elevation_deg", "terrain_horizon_deg", "blocker", "blocker_feature", "blocker_dist_km", "blocker_lat", "blocker_lon_east", "blocker_height_m", "p10_utc", "p90_utc", "spread_p10_p90_h", "present_frac"])];
    for (const e of m.events) {
      const b = eventBlocker(m, e);
      rows.push(csvRow([e.utc, e.target, e.kind, e.az_deg, e.el_deg, e.horizon_el_deg, b?.phrase, b?.feature, b?.dist_km, b?.lat, b?.lon, b?.h_m, e.unc?.p10_utc, e.unc?.p90_utc, e.unc?.spread_p10_p90_h, e.unc ? presentFrac(e.unc) : null]));
    }
    downloadText(`${m.site.id}_events_mast${m.mast}m.csv`, rows.join("\n"));
  };

  return (
    <section className="card" aria-labelledby="ev-h">
      <div className="card-head">
        <h2 id="ev-h">Upcoming events and what causes them</h2>
        <button className="btn" onClick={exportCsv}>
          Download CSV ({m.events.length} events)
        </button>
      </div>
      <div className="row-controls">
        <div className="seg" role="group" aria-label="Body">
          <button aria-pressed={target === "all"} onClick={() => setTarget("all")}>
            All
          </button>
          <button aria-pressed={target === "sun"} onClick={() => setTarget("sun")}>
            Sun
          </button>
          {hasEarth && (
            <button aria-pressed={target === "earth"} onClick={() => setTarget("earth")}>
              Earth
            </button>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} /> rises and sets only
        </label>
      </div>
      {list.length === 0 ? (
        <p className="note">No more events after this time in the precomputed window.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Time (UTC)</th>
                <th scope="col">Event</th>
                <th scope="col">Direction</th>
                <th scope="col">Terrain that causes it</th>
                <th scope="col" className="num">
                  Distance
                </th>
                {hasUnc && (
                  <th scope="col" className="num">
                    How sure <Info label="What How sure means">How far the time moves across NASA's 100 alternative terrains (8 in 10 fall inside this span).</Info>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {list.slice(0, count).map((e) => {
                const b = eventBlocker(m, e);
                return (
                  <tr key={e.utc + e.kind + e.target}>
                    <td>
                      <button className="linkish" onClick={() => onJump(e.t)} title="Move the time cursor here">
                        {fmtDateTime(e.t)}
                      </button>
                    </td>
                    <td>
                      <span className={`dot ${e.target === "sun" ? "dot-sun" : "dot-earth"}`} aria-hidden /> {KIND[e.target][e.kind]}
                    </td>
                    <td>{fmtAz(e.az_deg)}</td>
                    <td>{b ? (b.local ? "ground slope right at the site" : b.phrase ?? "terrain (unnamed)") : ""}</td>
                    <td className="num">{b ? fmtKm(b.dist_km) : ""}</td>
                    {hasUnc && (
                      <td className="num">
                        {e.unc ? `± ${fmtSpan(e.unc.spread_p10_p90_h)}` : ""}
                        {e.unc && presentFrac(e.unc) < 0.995 ? <span className="hint">in {Math.round(presentFrac(e.unc) * 100)}% of terrain versions</span> : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.length > count && (
        <button className="btn" onClick={() => setCount(count + 30)}>
          Show more ({list.length - count} left)
        </button>
      )}
      {m.blk.approx && <p className="note">The engine names blocking terrain for the default 2 m mast. At {m.mast} m the event times are exact, and the blocking terrain shown is read from the 2 m horizon in the same direction.</p>}
    </section>
  );
}

// ---------- provenance ----------

export function Provenance({ site }: { site: Site }) {
  const moved = site.requested.lat !== site.snapped.lat || site.requested.lon !== site.snapped.lon;
  return (
    <section className="card card-quiet" aria-labelledby="prov-h">
      <h2 id="prov-h">Data behind this site</h2>
      <dl className="kv">
        <dt>Requested point</dt>
        <dd>
          {fmtLat(site.requested.lat)}, {fmtLon(site.requested.lon)} (MOON_ME frame, east-positive)
        </dd>
        <dt>Evaluated at</dt>
        <dd>
          {fmtLat(site.snapped.lat, 5)}, {fmtLon(site.snapped.lon, 5)}, ground {Math.round(site.snapped.ground_m).toLocaleString("en")} m above the 1737.4 km sphere
          {moved ? " (nearest DEM pixel centre)" : ""}
        </dd>
        <dt>Terrain</dt>
        <dd>
          LOLA {site.dem.near_res_m} m/px to 20 km ({site.dem.near}), {site.dem.far_res_m} m/px out to {site.dem.far_km} km ({site.dem.far}); 720 horizon rays
          {site.dem.degraded ? (
            <>
              <br />
              <span className="chip chip-alert">fallback terrain</span> {site.dem.degraded}
            </>
          ) : null}
        </dd>
        <dt>Ephemeris</dt>
        <dd>NAIF SPICE {site.meta.spice ? `(${site.meta.spice})` : ""}, apparent positions with light time and stellar aberration</dd>
        <dt>Engine</dt>
        <dd>
          {site.meta.engine}
          {site.meta.generated_utc ? `, computed ${fmtDateTime(parseUtc(site.meta.generated_utc))}` : ""}
          {site.meta.compute_s != null ? `, computed live in ${site.meta.compute_s} s` : ""}
        </dd>
        {site.source && (
          <>
            <dt>Coordinates from</dt>
            <dd>
              <SourceLink src={site.source} />
            </dd>
          </>
        )}
        {site.note && (
          <>
            <dt>Note</dt>
            <dd>{site.note}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
