import { useEffect, useState } from "react";
import { MissionCard, earthText, fmtClear, gapText, openGap, toneMark, verdict } from "../components/Mission";
import { loadIndex, loadSite, useAsync } from "../lib/data";
import { fmtDate, fmtDateTime, fmtDur, fmtSpan, parseUtc } from "../lib/format";
import { setState, useAppState } from "../lib/state";
import { missionKind } from "../lib/types";
import type { Site } from "../lib/types";

const ORDER = ["chandrayaan3", "blue_ghost1", "im2", "im1", "slim"];

export default function MissionsView() {
  const s = useAppState();
  const idx = useAsync(loadIndex, "index");
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!idx.data) return;
    const ids = idx.data.sites.filter((h) => h.has_mission).map((h) => h.id);
    ids.sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);
    let live = true;
    Promise.all(ids.map(loadSite)).then(
      (all) => live && setSites(all.filter((s) => s.mission_replay)),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [idx.data]);

  if (error || idx.error) return <div className="card card-alert">Mission data could not be loaded. Run npm run sync-data.</div>;
  if (!sites)
    return (
      <div className="card loading" role="status">
        Loading mission replays…
      </div>
    );

  // Two groups. The scored ones are the validation test: did the light end the mission, and did we predict it?
  // The others (Apollo, Chang'e-3, Chang'e-6) were never ended by light: replayed, shown apart, never scored.
  const scored = sites.filter((x) => missionKind(x.mission_replay!) === "scored");
  const visits = sites.filter((x) => missionKind(x.mission_replay!) !== "scored").sort((p, q) => parseUtc(p.mission_replay!.landed_utc) - parseUtc(q.mission_replay!.landed_utc));
  const farSide = new Set(idx.data?.sites.filter((h) => h.far_side).map((h) => h.id));
  const tally = { match: 0, honest: 0, info: 0, visit: 0 };
  for (const site of scored) tally[verdict(site.mission_replay!).tone]++;

  return (
    <div className="stack">
      <section className="card" aria-labelledby="ms-h">
        <div className="card-head">
          <h1 id="ms-h">Did the light end the mission?</h1>
          <div className="tally">
            <span className="tag tag-match">✓ {tally.match} predicted within hours of the record</span>
            <span className="tag tag-honest">◆ {tally.honest} ended by something light cannot explain</span>
            {tally.info > 0 && <span className="tag tag-info">○ {tally.info} survived the night</span>}
          </div>
        </div>
        <div className="table-scroll">
          <table className="data data-big">
            <thead>
              <tr>
                <th scope="col">Mission</th>
                <th scope="col">Reported end</th>
                <th scope="col">Predicted terrain sunset</th>
                <th scope="col">Flat-horizon tool says</th>
                <th scope="col">Blocked by</th>
                <th scope="col" className="num">
                  End vs sunset
                </th>
                <th scope="col" className="num">
                  Sun at the end
                </th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((site) => {
                const r = site.mission_replay!;
                const v = verdict(r);
                const ss = r.first_terrain_sunset_after_landing;
                const d = r.end_minus_sunset_h;
                const g = openGap(r);
                return (
                  <tr key={site.id} className="row-click" onClick={() => setState({ open: site.id, hl: `mission-${site.id}` })}>
                    <th scope="row">
                      <button className="linkish" onClick={() => setState({ open: site.id, hl: `mission-${site.id}` })} title="Open the replay below">
                        {site.name}
                      </button>
                      {site.country && <span className="hint">{site.country}</span>}
                    </th>
                    <td>{fmtDateTime(parseUtc(r.end_utc))}</td>
                    <td>{ss ? fmtDateTime(parseUtc(ss.utc)) : ""}</td>
                    <td>
                      {g ? fmtDateTime(g.open, false) : ""}
                      {g && <span className="hint">{gapText(g)}</span>}
                    </td>
                    <td>{ss?.blocker ? (ss.blocker.dist_km < 1 ? "ground slope at the site" : ss.blocker.phrase) : ""}</td>
                    <td className="num">{r.expected === "multi_night" || d == null ? "n/a" : `${fmtSpan(d)} ${d < 0 ? "before" : "after"}`}</td>
                    <td className="num">{r.sun_frac_at_end > 0 ? `${Math.round(r.sun_frac_at_end * 100)}% up` : "dark"}</td>
                    <td>
                      <span className={`tag tag-${v.tone}`}>
                        {toneMark(v.tone)}
                        {v.tag}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details className="explain">
          <summary>How to read this table</summary>
          <p>
            {scored.length} real landings, replayed by the same engine. Click a row to watch it happen. Times are UTC. "Flat-horizon tool" is the same sunset against a flat 0° horizon, which is what a tool without terrain assumes: later where ridges stand in the way, earlier on a summit such as IM-2's. "Reported end" comes from
            the cited public sources and some are known only to the day.
          </p>
          <p>Two rows are deliberate honesty checks: missions that ended for reasons light cannot explain. The model knows terrain and geometry; it does not know lander tilt, thermal limits or battery state.</p>
        </details>
      </section>
      <Replays sites={scored} open={s.open} />
      {visits.length > 0 && (
        <section className="card" aria-labelledby="mv-h">
          <div className="card-head">
            <h2 id="mv-h">Also replayed: landings the light did not end</h2>
            <div className="tally">
              <span className="tag tag-visit">Not scored</span>
            </div>
          </div>
          <p className="card-lede">
            Apollo crews and Chang'e-6 landed in the lunar morning and lifted off again in daylight. Chang'e-3 is reported still working. None of them was ended by the light, so there is nothing here to score. They are shown as replays only, and they
            are not counted in the tally above.
          </p>
          <div className="table-scroll">
            <table className="data data-big">
              <thead>
                <tr>
                  <th scope="col">Mission</th>
                  <th scope="col">On the surface</th>
                  <th scope="col" className="num">
                    Sun above terrain
                    <br />
                    at landing
                  </th>
                  <th scope="col" className="num">
                    Sun above terrain
                    <br />
                    at lift-off
                  </th>
                  <th scope="col">First terrain sunset after landing</th>
                  <th scope="col">Earth (radio link)</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((site) => {
                  const r = site.mission_replay!;
                  const v = verdict(r);
                  const left = missionKind(r) === "visit";
                  const landed = parseUtc(r.landed_utc);
                  const end = parseUtc(r.end_utc);
                  const ss = r.first_terrain_sunset_after_landing;
                  const tSet = ss ? parseUtc(ss.utc) : NaN;
                  const earth = earthText(r, farSide.has(site.id));
                  return (
                    <tr key={site.id} className="row-click" onClick={() => setState({ open: site.id, hl: `mission-${site.id}` })}>
                      <th scope="row">
                        <button className="linkish" onClick={() => setState({ open: site.id, hl: `mission-${site.id}` })} title="Open the replay below">
                          {site.name}
                        </button>
                        {site.country && <span className="hint">{site.country}</span>}
                      </th>
                      <td>
                        {left ? `${fmtDate(landed, false)} to ${fmtDate(end)}` : `Since ${fmtDate(landed)}`}
                        <span className="hint">{left ? `${fmtDur(end - landed)}, landing to lift-off` : `replay runs to ${fmtDate(end)}`}</span>
                      </td>
                      <td className="num">{fmtClear(r.sun_clearance_deg_at?.landed)}</td>
                      <td className="num">{left ? fmtClear(r.sun_clearance_deg_at?.end) : "n/a"}</td>
                      <td>
                        {ss ? fmtDateTime(tSet) : "none in the replay window"}
                        {ss && <span className="hint">{left ? `${fmtSpan((tSet - end) / 3600e3)} after lift-off` : `${fmtSpan((tSet - landed) / 3600e3)} after landing`}</span>}
                      </td>
                      <td>
                        {earth ? earth.main : "n/a"}
                        {earth && <span className="hint">{earth.sub}</span>}
                      </td>
                      <td>
                        <span className={`tag tag-${v.tone}`}>
                          {toneMark(v.tone)}
                          {v.tag}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details className="explain">
            <summary>How to read this table</summary>
            <p>
              Click a row to watch the Sun over that site during the visit. Times are UTC. Landing and lift-off times come from the public record linked in each replay. The Sun and Earth heights are computed by this engine: the height of the
              centre of the disc above the real terrain horizon in that direction, which can be lower than the height above a flat horizon where mountains stand in the way.
            </p>
            <p>"After lift-off" is how much daylight was left at the site when the visit ended. Chang'e-3 has no lift-off: its replay covers the first lunar day and night after landing.</p>
          </details>
        </section>
      )}
      <Replays sites={visits} open={s.open} />
    </div>
  );
}

/** One expandable replay per mission, opened from its table row. */
function Replays({ sites, open: openId }: { sites: Site[]; open: string | null }) {
  return (
    <div className="acc">
      {sites.map((site) => {
        const v = verdict(site.mission_replay!);
        const open = openId === site.id;
        return (
          <section key={site.id} className={`acc-item${open ? " open" : ""}`} data-hl={`mission-${site.id}`}>
            <h2 className="acc-h">
              <button className="acc-btn" aria-expanded={open} aria-controls={`acc-${site.id}`} onClick={() => setState({ open: open ? null : site.id })}>
                <span className="acc-caret" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                <span className="acc-name">
                  {site.name}
                  {site.country ? <span className="muted"> · {site.country}</span> : null}
                </span>
                <span className={`tag tag-${v.tone}`}>
                  {toneMark(v.tone)}
                  {v.tag}
                </span>
              </button>
            </h2>
            {open && (
              <div className="acc-body" id={`acc-${site.id}`}>
                <MissionCard site={site} heading="none" />
                <p>
                  <button className="btn" onClick={() => setState({ view: "site", site: site.id, lat: null, lon: null, t: null, tab: "mission" })}>
                    Open this site in Explore →
                  </button>
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
