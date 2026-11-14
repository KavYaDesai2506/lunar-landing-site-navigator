import { useEffect, useState } from "react";
import { MissionCard, gapText, openGap, verdict } from "../components/Mission";
import { loadIndex, loadSite, useAsync } from "../lib/data";
import { fmtDateTime, fmtSpan, parseUtc } from "../lib/format";
import { setState, useAppState } from "../lib/state";
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

  return (
    <div className="stack">
      <section className="card" aria-labelledby="ms-h">
        <h1 id="ms-h">Did the light end the mission?</h1>
        <p className="card-lede">
          {sites.length} real landings, replayed by the same engine. For each: when did the terrain take the Sun, which terrain did it, and does that match the record? Click a mission to watch it happen.
        </p>
        <div className="table-scroll">
          <table className="data">
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
              {sites.map((site) => {
                const r = site.mission_replay!;
                const v = verdict(r);
                const ss = r.first_terrain_sunset_after_landing;
                const d = r.end_minus_sunset_h;
                const g = openGap(r);
                return (
                  <tr key={site.id}>
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
                        {v.tone === "match" ? "✓ " : v.tone === "honest" ? "◆ " : "○ "}
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
            Times are UTC. "Flat-horizon tool" is the same sunset against a flat 0° horizon, which is what a tool without terrain assumes: later where ridges stand in the way, earlier on a summit such as IM-2's. "Reported end" comes from
            the cited public sources and some are known only to the day.
          </p>
          <p>Two rows are deliberate honesty checks: missions that ended for reasons light cannot explain. The model knows terrain and geometry; it does not know lander tilt, thermal limits or battery state.</p>
        </details>
      </section>
      <div className="acc">
        {sites.map((site) => {
          const v = verdict(site.mission_replay!);
          const open = s.open === site.id;
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
                    {v.tone === "match" ? "✓ " : v.tone === "honest" ? "◆ " : "○ "}
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
    </div>
  );
}
