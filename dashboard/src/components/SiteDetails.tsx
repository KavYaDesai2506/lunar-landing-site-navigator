import { useMemo, useState } from "react";
import SourceLink from "./SourceLink";
import { bodyAt, eventBlocker, featureLabels, mastKeys, presentFrac } from "../lib/astro";
import type { Model } from "../lib/astro";
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
      <h2 id="lt-h">Long-term light, by mast height</h2>
      <p className="card-lede">
        Hourly over one full 18.6-year lunar precession cycle ({lt0.start_utc.slice(0, 4)} to {lt0.stop_utc.slice(0, 4)}). Raising the solar panel or antenna lifts it over nearby terrain.
      </p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Mast</th>
              <th scope="col" className="num" title="Mean visible fraction of the Sun's disc over time">
                Average illumination
              </th>
              <th scope="col" className="num" title="Share of time any part of the Sun is visible">
                Solar visibility
              </th>
              <th scope="col" className="num">
                Longest darkness
              </th>
              <th scope="col" className="num" title="Share of time any part of Earth's disc is visible">
                Earth visibility
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
          <span className="chip chip-quiet">How sure</span> Across NASA's 100 DEM error clones the 2 m average illumination is {unc.avg_p10_p50_p90[0].toFixed(1)}% to {unc.avg_p10_p50_p90[2].toFixed(1)}% (P10 to P90, median{" "}
          {unc.avg_p10_p50_p90[1].toFixed(1)}%). That run uses a 5 m surface near the site, so its baseline ({unc.baseline_avg_pct.toFixed(1)}%) differs slightly from the 20 m value in the table.
        </p>
      )}
      <p className="note">
        Two metrics, often confused: <b>average illumination</b> is the mean visible fraction of the Sun's disc; <b>solar visibility</b> is the share of time any part of the Sun shows. They differ by about 5 points at the same spot. Earth
        visibility counts any part of Earth's disc, which NASA's PGDA calls slightly optimistic for radio links.
      </p>
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
      <p className="card-lede">
        {moved ? (
          <>
            Moving <b>{Math.round(s.best.dist_m)} m</b> toward bearing <b>{fmtAz(s.best.bearing_deg)}</b> raises average illumination by <b>{s.gain_pp.toFixed(2)} points</b> (to {s.best.avg_pct.toFixed(1)}%).
          </>
        ) : (
          <>This point is already the best-lit pixel within {R * s.res_m} m.</>
        )}{" "}
        Within {R * s.res_m} m of the site, average illumination ranges from <b>{lo.toFixed(1)}%</b> to <b>{hi.toFixed(1)}%</b>.
      </p>
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
        <div className="sens-key">
          <div>
            <i className="sw sw-ring centre" /> the site pixel ({s.centre.avg_pct.toFixed(1)}%)
          </div>
          {moved && (
            <div>
              <i className="sw sw-ring best" /> best pixel ({s.best.avg_pct.toFixed(1)}%)
            </div>
          )}
          <div className="seq-ramp" aria-hidden />
          <div className="muted">
            {lo.toFixed(0)}% to {hi.toFixed(0)}% average illumination (18.6 yr). Each cell is one {s.res_m} m DEM pixel on the polar-stereographic grid; rows and columns are grid offsets, the compass bearing is in the sentence above.
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
      <p className="card-lede">
        Each event was recomputed on <b>{u.n_clones} alternative terrains</b>: NASA's own statistical "clones" of the elevation model, which differ within its measurement error. {tight} of {spreads.length} event times move by less than 5 minutes
        (median {fmtSpan(median)}). A few grazing events, where the Sun skims a ridge, are far less certain.
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
            {e.target === "sun" ? "Sun" : "Earth"} {e.kind.replace("_", " ")}: P10 to P90 spans <b>{fmtSpan(e.spread_p10_p90_h)}</b>
            {presentFrac(e, u.n_clones) < 0.995 ? `; it happens in ${Math.round(presentFrac(e, u.n_clones) * 100)}% of terrain versions` : ""}
          </li>
        ))}
      </ul>
      {fragile.length > 0 && (
        <>
          <h3>Fragile events: {fragile.length} that some terrain versions do not have at all</h3>
          <p className="note">A brief flicker of sunlight past a ridge can vanish when the terrain is a metre different. Percentiles for these use only the clones where the event happens.</p>
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
        <b>Scope.</b> {u.scope_note} Method: {u.method}
      </p>
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
      <h2 id="radar-h">Where the horizon comes from</h2>
      <p className="card-lede">
        Seen from above, with the site at the centre: for each of the 720 directions, how far away is the terrain that sets the horizon? Half of the horizon is set by terrain within <b>{fmtKm(sorted[Math.floor(sorted.length / 2)])}</b>;{" "}
        {local > 0.005 ? (
          <>
            <b>{Math.round(local * 100)}%</b> of it is the ground slope within 1 km.
          </>
        ) : (
          <>none of it is ground slope within 1 km.</>
        )}
        {m.blk.approx ? " (Blocking distances are from the 2 m mast horizon.)" : ""}
      </p>
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
        <div className="sens-key">
          <div>
            <i className="sw sw-dot sunfill" /> toward the Sun now ({fmtAz(sun.az)}): horizon set {fmtKm(dist[Math.round(sun.az * 2) % dist.length])} away
          </div>
          {earthEver && (
            <div>
              <i className="sw sw-dot earthfill" /> toward Earth now ({fmtAz(earth.az)})
            </div>
          )}
          <div className="muted">Distance scale is logarithmic. Named features are the ones that cause rise and set events at this site.</div>
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
                  <th scope="col" className="num" title="P10 to P90 spread across NASA's 100 DEM error clones">
                    Time spread
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
                        {e.unc ? fmtSpan(e.unc.spread_p10_p90_h) : ""}
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
      <h2 id="prov-h">Where these numbers come from</h2>
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
