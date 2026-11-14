import { useState } from "react";
import SourceLink from "../components/SourceLink";
import { useWidth } from "../components/Panorama";
import { loadIndex, loadSite, loadValidation, useAsync } from "../lib/data";
import { fmtDateTime, fmtSpan, parseUtc } from "../lib/format";
import { setState } from "../lib/state";

type Case = Record<string, any>;

function Status({ pass }: { pass: boolean | null | undefined }) {
  if (pass === true) return <span className="tag tag-match">✓ pass</span>;
  if (pass === false) return <span className="tag tag-fail">✕ outside criterion</span>;
  return <span className="tag tag-info">○ informational</span>;
}

const TITLES: Record<string, [string, string]> = {
  T1_ephemeris_vs_horizons: ["T1 · Sun and Earth directions vs JPL Horizons", "Is the geometry right before any terrain is involved?"],
  T2_terrain_vs_quickmap: ["T2 · Terrain sunset vs LROC QuickMap", "An independent tool with its own terrain model and 4-hour resolution."],
  T3_longterm_vs_glaser: ["T3 · 20-year illumination vs Gläser et al. 2018", "The reference study for the best-lit south-polar points, at the surface (0 m)."],
  T4_mast_height: ["T4 · Mast height", "Illumination must rise with observer height, as published."],
  T5_spatial_vs_pgda: ["T5 · 60-point map vs NASA PGDA illumination product", "Points on rings around the pole, compared with NASA Goddard's published maps."],
  T6_mission_endings: ["T6 · Predicted sunsets vs real mission endings", "Past landings as test cases with known answers."],
  T7_negative_control: ["T7 · Negative controls", "Missions that light did not end. The tool should say so."],
  T8_physics: ["T8 · Physical sanity checks", "Bounds any correct model must respect."],
};
const ORDER = Object.keys(TITLES);

function Scatter({ points }: { points: Case[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ p: Case; k: "sun" | "earth" } | null>(null);
  const S = Math.min(Math.max(width, 240), 380);
  const L = 40;
  const B = 34;
  const T = 10;
  const R = 10;
  const X = (v: number) => L + (v / 100) * (S - L - R);
  const Y = (v: number) => T + (1 - v / 100) * (S - T - B);
  return (
    <div ref={ref} className="chart-wrap scatter-wrap">
      {width > 0 && (
        <svg width={S} height={S} role="img" aria-label="Scatter plot of this engine's long-term visibility against NASA PGDA values for 60 points; points lie along the diagonal.">
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={X(v)} x2={X(v)} y1={T} y2={S - B} className="pano-grid" />
              <line x1={L} x2={S - R} y1={Y(v)} y2={Y(v)} className="pano-grid" />
              <text x={X(v)} y={S - B + 14} textAnchor="middle" className="axis-text">
                {v}%
              </text>
              <text x={L - 6} y={Y(v) + 4} textAnchor="end" className="axis-text">
                {v}%
              </text>
            </g>
          ))}
          <line x1={X(0)} y1={Y(0)} x2={X(100)} y2={Y(100)} className="pano-zero" />
          <text x={(L + S - R) / 2} y={S - 4} textAnchor="middle" className="axis-text strong">
            NASA PGDA
          </text>
          <text transform={`translate(11 ${(T + S - B) / 2}) rotate(-90)`} textAnchor="middle" className="axis-text strong">
            this engine
          </text>
          {points.map((p) => (
            <g key={p.name}>
              <rect x={X(p.earth_pgda_pct) - 4} y={Y(p.earth_ours_pct) - 4} width={8} height={8} className="pt-earth" onPointerEnter={() => setHover({ p, k: "earth" })} onPointerLeave={() => setHover(null)} />
              <circle cx={X(p.sun_pgda_pct)} cy={Y(p.sun_ours_pct)} r={4.5} className="pt-sun" onPointerEnter={() => setHover({ p, k: "sun" })} onPointerLeave={() => setHover(null)} />
            </g>
          ))}
        </svg>
      )}
      {hover && (
        <div className="tip" style={{ left: 50, top: 14 }}>
          <div className="tip-h">
            {hover.p.name} ({hover.p.lat.toFixed(2)}°, {hover.p.lon.toFixed(1)}° E)
          </div>
          <div>
            {hover.k === "sun" ? "Sun" : "Earth"}: PGDA <b>{hover.p[`${hover.k}_pgda_pct`]}%</b>, this engine <b>{hover.p[`${hover.k}_ours_pct`]}%</b>
          </div>
        </div>
      )}
      <div className="pano-legend">
        <span>
          <i className="sw sw-dot sunfill" /> Sun visibility
        </span>
        <span>
          <i className="sw sw-sq earthfill" /> Earth visibility
        </span>
        <span className="muted">On the diagonal means identical to NASA's value.</span>
      </div>
    </div>
  );
}

function Generic({ c }: { c: Case }) {
  return (
    <dl className="kv">
      {Object.entries(c)
        .filter(([k]) => !["pass", "criterion", "source", "sources", "points"].includes(k))
        .map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k.replace(/_/g, " ")}</dt>
            <dd>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
    </dl>
  );
}

function Links({ c }: { c: Case }) {
  const urls: string[] = [...(c.source ? [c.source] : []), ...(Array.isArray(c.sources) ? c.sources : [])];
  if (!urls.length) return null;
  return (
    <span className="muted">
      {" "}
      Source:{" "}
      {urls.map((u, i) => (
        <span key={u}>
          {i ? ", " : ""}
          <SourceLink src={u} />
        </span>
      ))}
    </span>
  );
}

function Body({ id, cases }: { id: string; cases: Record<string, Case> }) {
  const entries = Object.entries(cases);
  if (id.startsWith("T1")) {
    const worst = Math.max(...entries.map(([, c]) => c.max_sep_arcsec));
    return (
      <>
        <p className="big-fact">
          Largest difference: <b>{worst.toFixed(4)}″</b> <span className="muted">(arcseconds; the Sun's disc is about 1,900″ wide)</span>
        </p>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col" className="num">Epochs</th>
                <th scope="col" className="num">Max separation</th>
                <th scope="col" className="num">Median</th>
                <th scope="col">Criterion</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, c]) => (
                <tr key={k}>
                  <th scope="row">{k.replace(/_/g, " ")}</th>
                  <td className="num">{c.n_epochs}</td>
                  <td className="num">{c.max_sep_arcsec.toFixed(5)}″</td>
                  <td className="num">{c.median_sep_arcsec.toFixed(5)}″</td>
                  <td>{c.criterion}</td>
                  <td><Status pass={c.pass} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  if (id.startsWith("T3")) {
    return (
      <>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Site (0 m mast)</th>
                <th scope="col" className="num">Avg illumination: ours</th>
                <th scope="col" className="num">Gläser</th>
                <th scope="col" className="num">Solar visibility: ours</th>
                <th scope="col" className="num">Gläser</th>
                <th scope="col" className="num">Longest shadow: ours</th>
                <th scope="col" className="num">Gläser</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, c]) => {
                const o = c.ours_best_within_60m_20m ?? c.ours_exact_pixel_20m;
                return (
                  <tr key={k}>
                    <th scope="row">
                      {k.replace(/_/g, " ")}
                      {o?.moved_m ? <span className="hint">best pixel within 60 m, moved {o.moved_m} m</span> : <span className="hint">exact pixel</span>}
                    </th>
                    <td className="num">{o?.avg_pct}%</td>
                    <td className="num">{c.glaser_20m?.avg_pct}%</td>
                    <td className="num">{o?.vis_pct}%</td>
                    <td className="num">{c.glaser_20m?.vis_pct}%</td>
                    <td className="num">{o?.max_shadow_h} h</td>
                    <td className="num">{c.glaser_20m?.max_shadow_h} h</td>
                    <td><Status pass={c.pass} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">
          Criterion: {entries[0]?.[1].criterion}. <Links c={entries[0]?.[1] ?? {}} /> A site that misses the criterion stays marked as a miss; the threshold was not loosened. Published coordinates are rounded, and at 20 m per pixel a one-pixel
          shift changes the answer by several points (see "A few metres matter" on any polar site).
        </p>
      </>
    );
  }
  if (id.startsWith("T4")) {
    return (
      <>
        {entries.map(([k, c]) => (
          <div key={k}>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">{k.replace(/_/g, " ")}</th>
                    <th scope="col" className="num">Average illumination</th>
                    <th scope="col" className="num">Solar visibility</th>
                    <th scope="col" className="num">Longest darkness</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(c.ours ?? {}).map(([mast, v]: [string, any]) => (
                    <tr key={mast}>
                      <th scope="row">Mast {mast.replace("m", " m")}</th>
                      <td className="num">
                        <span className="bar-cell">
                          <span className="bar sun" style={{ width: `${v.avg_pct * 0.8}px` }} aria-hidden />
                          {v.avg_pct}%
                        </span>
                      </td>
                      <td className="num">{v.vis_pct}%</td>
                      <td className="num">{v.max_shadow_h} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Criterion: {c.criterion}. <Status pass={c.pass} /> Published comparison: Gläser et al. 2018 give {c["glaser_2018_C1-0_2m"]?.avg_pct}% average illumination at 2 m for their C1 point.
            </p>
          </div>
        ))}
      </>
    );
  }
  if (id.startsWith("T5")) {
    return (
      <>
        {entries.map(([k, c]) => (
          <div key={k} className="mission-grid">
            <div>
              <p className="big-fact">
                Sun RMSE <b>{c.sun_rmse_pp} pp</b> · Earth RMSE <b>{c.earth_rmse_pp} pp</b> <Status pass={c.pass} />
              </p>
              <dl className="kv">
                <dt>Points</dt>
                <dd>{c.n_points}, {c.grid}</dd>
                <dt>Period</dt>
                <dd>{c.period}</dd>
                <dt>Sun bias / mean abs error</dt>
                <dd>{c.sun_bias_pp} pp / {c.sun_mae_pp} pp</dd>
                <dt>Earth bias</dt>
                <dd>{c.earth_bias_pp} pp</dd>
                <dt>Criterion</dt>
                <dd>{c.criterion}</dd>
                {c.peers && (
                  <>
                    <dt>For scale</dt>
                    <dd>
                      Other public entries to this challenge report {Object.entries(c.peers).map(([pk, pv]) => `${pv} pp (${pk.includes("rmse") ? "RMSE" : "mean absolute"})`).join(" and ")} against the same NASA product.
                    </dd>
                  </>
                )}
              </dl>
              <p className="note"><Links c={c} /></p>
            </div>
            {Array.isArray(c.points) && <Scatter points={c.points} />}
          </div>
        ))}
      </>
    );
  }
  if (id.startsWith("T6") || id.startsWith("T7")) {
    return (
      <>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Mission</th>
                <th scope="col">Reported end</th>
                <th scope="col">Predicted terrain sunset</th>
                <th scope="col" className="num">Sun at the end</th>
                <th scope="col">Criterion</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, c]) => {
                const ss = c.predicted_terrain_sunset_utc ?? c.predicted_next_terrain_sunset_utc;
                const d = c.end_minus_predicted_sunset_h;
                return (
                  <tr key={k}>
                    <th scope="row">
                      <button className="linkish" onClick={() => setState({ view: "site", site: k })}>{k}</button>
                    </th>
                    <td>{fmtDateTime(parseUtc(c.reported_end_utc))}</td>
                    <td>
                      {ss ? fmtDateTime(parseUtc(ss)) : "n/a"}
                      {d != null ? <span className="hint">end is {fmtSpan(d)} {d < 0 ? "before" : "after"} sunset</span> : null}
                      {c.sunlight_hours_left_at_end != null || c.terrain_sunlight_hours_left_at_end != null ? (
                        <span className="hint">{fmtSpan(c.sunlight_hours_left_at_end ?? c.terrain_sunlight_hours_left_at_end)} of sunlight left at the end</span>
                      ) : null}
                    </td>
                    <td className="num">{c.sun_frac_at_reported_end > 0 ? `${Math.round(c.sun_frac_at_reported_end * 100)}% up` : "dark"}</td>
                    <td>{c.criterion}</td>
                    <td><Status pass={c.pass} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {id.startsWith("T6") && cases.im1?.pass === false && (
          <p className="note">
            IM-1 misses the sunset criterion and is left that way. Its lander tipped over and lost power when the low Sun left its one lit panel, days before terrain sunset, so it is also listed under the negative controls (T7).
          </p>
        )}
        {id.startsWith("T7") && entries.map(([k, c]) => (c.verdict ? <p className="note" key={k}><b>{k}:</b> {c.verdict}</p> : null))}
        <p className="note">
          Details and sources for each mission are on the <button className="linkish" onClick={() => setState({ view: "missions" })}>Missions page</button>.
        </p>
      </>
    );
  }
  return (
    <>
      {entries.map(([k, c]) => (
        <div key={k}>
          <p>
            <b>{k.replace(/_/g, " ")}</b> <Status pass={c.pass} />
          </p>
          <p className="note">Criterion: {c.criterion}<Links c={c} /></p>
          <Generic c={c} />
        </div>
      ))}
      {id.startsWith("T2") && (
        <p className="note">
          The two tools agree on where the Sun and Earth are and disagree on when the local ridge hides the Sun. QuickMap samples every 4 hours and evaluates a slightly different point, so this comparison is reported, not scored.
        </p>
      )}
    </>
  );
}

export default function EvidenceView() {
  const rep = useAsync(loadValidation, "validation");
  const idx = useAsync(loadIndex, "index");
  const shack = useAsync(() => loadSite("shackleton_rim_s").catch(() => null), "ev-shack");
  if (rep.error) return <div className="card card-alert">No validation report found. Run the engine's pytest, then npm run sync-data.</div>;
  if (!rep.data)
    return (
      <div className="card loading" role="status">
        Loading validation report…
      </div>
    );
  const tests = rep.data.tests;
  const ids = [...ORDER.filter((k) => tests[k]), ...Object.keys(tests).filter((k) => !ORDER.includes(k))];
  let pass = 0;
  let fail = 0;
  let info = 0;
  for (const id of ids)
    for (const c of Object.values(tests[id])) {
      if (c.pass === true) pass++;
      else if (c.pass === false) fail++;
      else info++;
    }
  const unc = shack.data?.uncertainty;
  const uncSites = idx.data?.sites.filter((h) => h.has_uncertainty).map((h) => h.name) ?? [];
  return (
    <div className="stack">
      <section className="card" aria-labelledby="ev-h1">
        <h1 id="ev-h1">Evidence: every claim, tested against a published answer</h1>
        <p className="card-lede">
          This page is generated from the engine's own test report ({fmtDateTime(parseUtc(rep.data.generated_utc))}). Nothing is hand-edited: checks that miss their criterion are shown as misses.
        </p>
        <div className="tiles tiles-3">
          <div className="tile">
            <div className="tile-label">Checks passed</div>
            <div className="tile-value">{pass}</div>
            <div className="tile-sub">against JPL Horizons, Gläser et al. 2018, NASA PGDA maps and mission records</div>
          </div>
          <div className="tile">
            <div className="tile-label">Outside criterion</div>
            <div className="tile-value">{fail}</div>
            <div className="tile-sub">kept visible, with the reason, in the sections below</div>
          </div>
          <div className="tile">
            <div className="tile-label">Informational</div>
            <div className="tile-value">{info}</div>
            <div className="tile-sub">comparisons reported without a pass mark</div>
          </div>
        </div>
      </section>

      {ids.map((id) => (
        <section className="card" key={id} aria-label={TITLES[id]?.[0] ?? id}>
          <h2>{TITLES[id]?.[0] ?? id.replace(/_/g, " ")}</h2>
          {TITLES[id] && <p className="card-lede">{TITLES[id][1]}</p>}
          <Body id={id} cases={tests[id]} />
        </section>
      ))}

      <section className="card" aria-labelledby="lim-h">
        <h2 id="lim-h">What this tool does not know</h2>
        <ul className="plain spaced">
          <li>
            <b>Lander orientation.</b> A tipped lander can lose power in full terrain sunlight (IM-1, IM-2). The model is a point on a mast.
          </li>
          <li>
            <b>Uncertainty covers nearby terrain only.</b> {unc ? unc.scope_note : "The DEM clones sample height error within about 2 km of the site; error in distant ridges is not sampled."} Clone results exist only where NASA publishes clones (PGDA
            product 78): {uncSites.length ? uncSites.join(", ") : "Shackleton rim"} so far. Some brief events do not happen at all in part of the clones; the site page lists them as fragile.
          </li>
          <li>
            <b>Flat horizon across the disc.</b> The visible fraction treats the terrain as level across the 0.53° Sun and the 1.9° Earth.
          </li>
          <li>
            <b>Earth visibility is optimistic for radio.</b> It counts any part of Earth's disc, which NASA's PGDA calls slightly optimistic for links to a specific ground station.
          </li>
          <li>
            <b>Grid-point evaluation.</b> Each site is evaluated at the nearest DEM pixel centre (20 m at the pole, 60 m elsewhere). Rounded published coordinates can land one pixel off.
          </li>
          <li>
            <b>Coverage.</b> South-polar and mid-latitude terrain only; the north pole needs another DEM reader. The planning window is November 2026 to January 2028.
          </li>
          <li>
            <b>In this dashboard.</b> Positions between the engine's 3-hourly samples are interpolated, and "without terrain" times are read from that track, so they are good to a few minutes, not seconds. Rise and set times themselves come
            from the engine, refined to about 1 second.
          </li>
        </ul>
      </section>
    </div>
  );
}
