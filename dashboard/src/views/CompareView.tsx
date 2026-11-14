import { useEffect, useMemo, useState } from "react";
import Panorama, { defaultYRange } from "../components/Panorama";
import { STAYS } from "../components/StayPlanner";
import Timeline, { LaneLegend } from "../components/Timeline";
import { bodyAt, buildModel, clampT, isPolar, nextEvent, stayStats } from "../lib/astro";
import type { Model } from "../lib/astro";
import { loadIndex, loadSite, useAsync } from "../lib/data";
import { DAY, csvRow, downloadText, fmtDateTime, fmtDeg, fmtDur, fmtPct, fmtSpan } from "../lib/format";
import { setState, useAppState } from "../lib/state";
import type { Site } from "../lib/types";
import { TimeControls, timelineRange, useNow, usePlayer } from "./SiteView";

interface Metric {
  label: string;
  hint?: string;
  get: (m: Model) => number | null;
  fmt: (v: number) => string;
  better: 1 | -1 | 0;
}

export default function CompareView() {
  const s = useAppState();
  const idx = useAsync(loadIndex, "index");
  const [sites, setSites] = useState<Record<string, Site>>({});
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    for (const id of s.cmp) {
      if (sites[id]) continue;
      loadSite(id).then(
        (site) => live && setSites((p) => ({ ...p, [id]: site })),
        () => live && setFailed((f) => (f.includes(id) ? f : [...f, id])),
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cmp.join()]);

  const models = useMemo(() => s.cmp.map((id) => sites[id]).filter(Boolean).map((site) => buildModel(site, s.mast)), [sites, s.cmp.join(), s.mast]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = models[0] ?? null;
  const now = useNow(s.t == null);
  const nowOk = first ? now >= first.t0 && now <= first.tEnd : true;
  const live = s.t == null && nowOk;
  const t = first ? clampT(first, s.t ?? now) : now;
  const [playing, setPlaying] = usePlayer(first, t);

  const toggle = (id: string) => {
    const has = s.cmp.includes(id);
    if (has) setState({ cmp: s.cmp.filter((x) => x !== id) });
    else if (s.cmp.length < 4) setState({ cmp: [...s.cmp, id] });
  };

  const chooser = (
    <section className="card" aria-labelledby="cmp-pick">
      <h2 id="cmp-pick">Compare up to four sites on one clock</h2>
      <div className="chip-pick" role="group" aria-label="Sites to compare">
        {idx.data?.sites.map((h) => {
          const on = s.cmp.includes(h.id);
          return (
            <button key={h.id} className={`pick ${on ? "on" : ""}`} aria-pressed={on} disabled={!on && s.cmp.length >= 4} onClick={() => toggle(h.id)}>
              {on ? "✓ " : ""}
              {h.name}
            </button>
          );
        })}
      </div>
      <div className="row-controls">
        <span className="ctl-label" id="cmp-mast">
          Mast height
        </span>
        <div className="seg" role="group" aria-labelledby="cmp-mast">
          {["0", "2", "10"].map((k) => (
            <button key={k} aria-pressed={s.mast === k} onClick={() => setState({ mast: k })}>
              {k} m
            </button>
          ))}
        </div>
        <span className="ctl-label" id="cmp-stay">
          Stay
        </span>
        <div className="seg" role="group" aria-labelledby="cmp-stay">
          {STAYS.map((x) => (
            <button key={x.d} aria-pressed={s.stay === x.d} onClick={() => setState({ stay: x.d })}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {failed.length > 0 && <p className="note">Could not load: {failed.join(", ")}.</p>}
    </section>
  );

  if (!first) {
    return (
      <div className="stack">
        {chooser}
        <div className="card loading" role="status">
          {s.cmp.length ? "Loading sites…" : "Choose at least two sites above."}
        </div>
      </div>
    );
  }

  const jump = (tt: number) => {
    setPlaying(false);
    setState({ t: clampT(first, tt) });
  };
  const stayMs = s.stay * DAY;
  const stats = models.map((m) => stayStats(m, t, stayMs));
  const iOf = (m: Model) => models.indexOf(m);

  const metrics: (Metric | string)[] = [
    `At the cursor: ${fmtDateTime(t)}`,
    { label: "Sun above the terrain horizon", get: (m) => bodyAt(m, "sun", t).clearance, fmt: (v) => fmtDeg(v), better: 0 },
    { label: "Visible part of the Sun's disc", get: (m) => bodyAt(m, "sun", t).frac * 100, fmt: (v) => (v <= 0 ? "hidden" : fmtPct(v, 0)), better: 0 },
    {
      label: "Time to the next terrain sunset",
      hint: "blank when the Sun is down or does not set again",
      get: (m) => {
        if (bodyAt(m, "sun", t).frac <= 0) return null;
        const e = nextEvent(m, "sun", ["last_light"], t);
        return e ? e.t - t : null;
      },
      fmt: (v) => fmtDur(v),
      better: 1,
    },
    `During a ${s.stay}-day stay from the cursor`,
    { label: "Sunlight (any part of the Sun)", get: (m) => stats[iOf(m)].sunH, fmt: (v) => fmtSpan(v), better: 1 },
    { label: "Sun and Earth together", get: (m) => stats[iOf(m)].bothH, fmt: (v) => (v < 0.02 ? "none" : fmtSpan(v)), better: 1 },
    { label: "Longest darkness", get: (m) => stats[iOf(m)].longestDarkH, fmt: (v) => (v < 0.02 ? "none" : fmtSpan(v)), better: -1 },
    "Long term (18.6 years, hourly)",
    { label: "Average illumination", hint: "mean visible fraction of the Sun's disc", get: (m) => m.site.longterm[m.mast].sun.avg_fraction_pct, fmt: (v) => fmtPct(v), better: 1 },
    { label: "Solar visibility", hint: "share of time any part of the Sun shows", get: (m) => m.site.longterm[m.mast].sun.any_visible_pct, fmt: (v) => fmtPct(v), better: 1 },
    { label: "Longest darkness", get: (m) => m.site.longterm[m.mast].sun.max_dark_h, fmt: (v) => fmtSpan(v), better: -1 },
    { label: "Earth visibility", hint: "any part of Earth's disc; optimistic for radio links", get: (m) => m.site.longterm[m.mast].earth.any_visible_pct, fmt: (v) => (v === 0 ? "never" : fmtPct(v)), better: 1 },
    { label: "Sun and Earth together", get: (m) => m.site.longterm[m.mast].both_any_pct, fmt: (v) => (v === 0 ? "never" : fmtPct(v)), better: 1 },
  ];

  const exportCsv = () => {
    const rows = [csvRow(["metric", ...models.map((m) => m.site.name)])];
    let section = "";
    for (const r of metrics) {
      if (typeof r === "string") section = r;
      else rows.push(csvRow([`${section}: ${r.label}`, ...models.map((m) => {
        const v = r.get(m);
        return v == null ? "" : r.fmt(v);
      })]));
    }
    downloadText(`compare_${models.map((m) => m.site.id).join("_")}.csv`, rows.join("\n"));
  };

  const allPolar = models.every((m) => isPolar(m.site));
  let yr: [number, number] | undefined;
  if (allPolar) {
    const rs = models.map((m) => defaultYRange(m, false));
    yr = [Math.min(...rs.map((r) => r[0])), Math.max(...rs.map((r) => r[1]))];
  }
  const groups = models.map((m) => {
    const hasEarth = m.any.earth.length > 0;
    return {
      title: m.site.name,
      lanes: [
        { label: "Sun", cls: "sun" as const, any: m.any.sun, full: m.full.sun },
        ...(hasEarth ? [{ label: "Earth", cls: "earth" as const, any: m.any.earth, full: m.full.earth }, { label: "Both", cls: "both" as const, any: m.both }] : []),
      ],
    };
  });

  return (
    <div className="stack">
      {chooser}
      <section className="card" aria-labelledby="cmp-time">
        <h2 id="cmp-time">One time cursor for every site</h2>
        <TimeControls model={first} t={t} live={live} playing={playing} setPlaying={setPlaying} zoom={s.zoom} />
        <Timeline groups={groups} range={timelineRange(first, t, s.zoom)} limits={[first.t0, first.tEnd]} t={t} onT={jump} stayMs={stayMs} />
        <LaneLegend />
      </section>

      <section className="card" aria-labelledby="cmp-score">
        <div className="card-head">
          <h2 id="cmp-score">Scorecard</h2>
          <button className="btn" onClick={exportCsv}>
            Download CSV
          </button>
        </div>
        <div className="table-scroll">
          <table className="data score">
            <thead>
              <tr>
                <th scope="col">Mast {s.mast} m</th>
                {models.map((m) => (
                  <th scope="col" key={m.site.id} className="num">
                    <button className="linkish" onClick={() => setState({ view: "site", site: m.site.id })} title="Open this site">
                      {m.site.name}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((r, ri) => {
                if (typeof r === "string")
                  return (
                    <tr key={ri} className="row-section">
                      <th scope="colgroup" colSpan={models.length + 1}>
                        {r}
                      </th>
                    </tr>
                  );
                const vals = models.map((m) => r.get(m));
                const nums = vals.filter((v): v is number => v != null);
                const best = r.better && nums.length > 1 ? (r.better > 0 ? Math.max(...nums) : Math.min(...nums)) : null;
                const tie = best != null && nums.filter((v) => Math.abs(v - best) < 1e-6).length > 1;
                return (
                  <tr key={ri}>
                    <th scope="row">
                      {r.label}
                      {r.hint && <span className="hint">{r.hint}</span>}
                    </th>
                    {vals.map((v, i) => (
                      <td key={i} className="num">
                        {v == null ? "" : r.fmt(v)}
                        {best != null && !tie && v != null && Math.abs(v - best) < 1e-6 && <span className="tag tag-best">BEST</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">The scorecard never blends these into one score: a site can win on sunlight and lose on Earth contact (compare Shackleton rim with Mons Malapert).</p>
      </section>

      <section className="card" aria-labelledby="cmp-pano">
        <h2 id="cmp-pano">The same moment on each horizon</h2>
        <div className={`cmp-grid n${models.length}`}>
          {models.map((m) => (
            <div key={m.site.id}>
              <Panorama model={m} t={t} compact yRange={yr} label={m.site.name} onJump={jump} />
            </div>
          ))}
        </div>
        <p className="note">{allPolar ? "All panels share one elevation scale." : "Elevation scales differ between panels: polar and mid-latitude skies do not fit one axis."} Dots mark rises and sets in the coming lunar day.</p>
      </section>
    </div>
  );
}
