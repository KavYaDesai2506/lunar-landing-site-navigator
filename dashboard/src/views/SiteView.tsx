import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MissionCard } from "../components/Mission";
import NowPanel from "../components/NowPanel";
import Panorama from "../components/Panorama";
import { BlockerRadar, EventsTable, LongTermCard, NoClonesCard, Provenance, SensitivityCard, UncertaintyCard } from "../components/SiteDetails";
import SitePicker from "../components/SitePicker";
import StayPlanner from "../components/StayPlanner";
import Timeline, { LaneLegend } from "../components/Timeline";
import { buildModel, clampT, mastKeys, nextEvent, openIntervals, prevEvent } from "../lib/astro";
import type { Model } from "../lib/astro";
import { DEFAULT_API, degradedNote, describeApiError, getApiBase, isDefaultApi, loadCustom, loadIndex, loadSite, resetApiBase, useAsync } from "../lib/data";
import { ExploreLinks, moonTrekLink, quickmapLink } from "../components/ExternalMaps";
import { DAY, HOUR, fmtDateTime, fmtKm, fmtLat, fmtLon } from "../lib/format";
import { tr } from "../lib/i18n";
import { DEFAULTS, setState, useAppState } from "../lib/state";
import type { ApiErrorInfo } from "../lib/data";
import type { SiteHeadline } from "../lib/types";

export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function timelineRange(m: Model, t: number, zoomDays: number): [number, number] {
  if (!zoomDays) return [m.t0, m.tEnd];
  const span = zoomDays * DAY;
  const k = Math.floor((t - m.t0) / span);
  const a = m.t0 + k * span;
  return [a, a + span];
}

export function usePlayer(model: Model | null, t: number) {
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!playing || !model) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const advance = (realMs: number) => {
      const cur = tRef.current;
      // slow down near sunrise and sunset so the moment can be read
      const near = model.events.some((e) => e.target === "sun" && (e.kind === "first_light" || e.kind === "last_light") && Math.abs(e.t - cur) < 2.5 * HOUR);
      const next = cur + realMs * (near ? 1.2 : 9) * 3600; // sim hours per real second
      if (next >= model.tEnd) {
        setState({ t: model.tEnd });
        setPlaying(false);
      } else setState({ t: next });
    };
    if (reduced) {
      const id = setInterval(() => advance(700), 700);
      return () => clearInterval(id);
    }
    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      advance(Math.min(100, ts - last));
      last = ts;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, model]);
  return [playing, setPlaying] as const;
}

interface TimeProps {
  model: Model;
  t: number;
  live: boolean;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  zoom: number;
}

function useGo(model: Model, setPlaying: (p: boolean) => void) {
  return (tt: number) => {
    setPlaying(false);
    setState({ t: clampT(model, tt) });
  };
}

function NowButton({ model, live, setPlaying }: Pick<TimeProps, "model" | "live" | "setPlaying">) {
  const nowOk = Date.now() >= model.t0 && Date.now() <= model.tEnd;
  return (
    <button
      className="btn"
      disabled={live || !nowOk}
      onClick={() => {
        setPlaying(false);
        setState({ t: null });
      }}
      title={nowOk ? "Follow the real clock" : "The real clock is outside the precomputed window"}
    >
      Now
    </button>
  );
}

function DateInput({ model, t, setPlaying, id }: Pick<TimeProps, "model" | "t" | "setPlaying"> & { id: string }) {
  const go = useGo(model, setPlaying);
  return (
    <input
      id={id}
      type="datetime-local"
      className="input"
      value={new Date(t).toISOString().slice(0, 16)}
      min={new Date(model.t0).toISOString().slice(0, 16)}
      max={new Date(model.tEnd).toISOString().slice(0, 16)}
      onChange={(e) => {
        const v = Date.parse(e.target.value + "Z");
        if (isFinite(v)) go(v);
      }}
    />
  );
}

function StepButtons({ model, t, setPlaying }: Pick<TimeProps, "model" | "t" | "setPlaying">) {
  const go = useGo(model, setPlaying);
  const prev = prevEvent(model, "sun", ["first_light", "last_light"], t - 1000);
  const next = nextEvent(model, "sun", ["first_light", "last_light"], t + 1000);
  return (
    <div className="seg" role="group" aria-label="Step time">
      <button onClick={() => prev && go(prev.t)} disabled={!prev} title="Previous sunrise or sunset">
        ⏮ event
      </button>
      <button onClick={() => go(t - DAY)}>−1 d</button>
      <button onClick={() => go(t - HOUR)}>−1 h</button>
      <button onClick={() => go(t + HOUR)}>+1 h</button>
      <button onClick={() => go(t + DAY)}>+1 d</button>
      <button onClick={() => next && go(next.t)} disabled={!next} title="Next sunrise or sunset">
        event ⏭
      </button>
    </div>
  );
}

function ZoomButtons({ zoom }: { zoom: number }) {
  return (
    <div className="seg" role="group" aria-label="Timeline span">
      {[
        [30, "30 days"],
        [90, "90 days"],
        [0, "14 months"],
      ].map(([d, l]) => (
        <button key={d} aria-pressed={zoom === d} onClick={() => setState({ zoom: d as number })}>
          {l}
        </button>
      ))}
    </div>
  );
}

function LiveChip({ live }: { live: boolean }) {
  return live ? <span className="chip chip-live">● live</span> : <span className="chip chip-quiet">pinned</span>;
}

/** Everything about time in one block (used by Compare). */
export function TimeControls({ model, t, live, playing, setPlaying, zoom }: TimeProps) {
  return (
    <div className="time-controls">
      <div className="time-readout" aria-live="off">
        <span className="time-big">{fmtDateTime(t)}</span>
        <LiveChip live={live} />
      </div>
      <div className="row-controls">
        <NowButton model={model} live={live} setPlaying={setPlaying} />
        <StepButtons model={model} t={t} setPlaying={setPlaying} />
        <button className="btn btn-primary" onClick={() => setPlaying(!playing)} aria-pressed={playing}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <label className="ctl-label" htmlFor="dt-input">
          Date (UTC)
        </label>
        <DateInput id="dt-input" model={model} t={t} setPlaying={setPlaying} />
        <label className="ctl-label">Show</label>
        <ZoomButtons zoom={zoom} />
      </div>
    </div>
  );
}

/** The scrubber's own buttons, sitting between the sky and the timeline they both follow. */
function ScrubControls({ model, t, live, playing, setPlaying, zoom }: TimeProps) {
  return (
    <div className="scrub-controls" data-hl="scrub">
      <button className="btn btn-primary" onClick={() => setPlaying(!playing)} aria-pressed={playing} title="Run time forward and watch the Sun move along the horizon">
        {playing ? "❚❚ Pause" : "▶ Play"}
      </button>
      <span className="time-big" aria-live="off">
        {fmtDateTime(t)}
      </span>
      <LiveChip live={live} />
      <span className="scrub-right">
        <StepButtons model={model} t={t} setPlaying={setPlaying} />
        <ZoomButtons zoom={zoom} />
      </span>
    </div>
  );
}

/** Great-circle distance on the Moon, km. */
function moonKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 1737.4 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearestPreset(sites: SiteHeadline[] | undefined, lat: number | null, lon: number | null): { site: SiteHeadline; km: number } | null {
  if (!sites?.length || lat == null || lon == null) return null;
  let best: { site: SiteHeadline; km: number } | null = null;
  for (const h of sites) {
    const km = moonKm(lat, lon, h.lat, h.lon);
    if (!best || km < best.km) best = { site: h, km };
  }
  return best;
}

const TABS: [string, string][] = [
  ["plan", "Plan & slip"],
  ["longterm", "Long-term & mast"],
  ["horizon", "Horizon source"],
  ["sure", "How sure"],
  ["events", "Events"],
];

export default function SiteView() {
  const s = useAppState();
  const idx = useAsync(loadIndex, "index");
  const custom = s.site === "custom";
  const customOk = custom && s.lat != null && s.lon != null;
  // bumped by "Try again" and "Reset to hosted engine" so the request is made afresh
  const [attempt, setAttempt] = useState(0);
  const key = custom ? `custom:${s.lat},${s.lon},${s.mast},${getApiBase()},${attempt}` : `site:${s.site}`;
  const siteA = useAsync(custom ? (customOk ? () => loadCustom(s.lat!, s.lon!, s.mast) : null) : () => loadSite(s.site), key);
  const site = siteA.data;
  const model = useMemo(() => (site ? buildModel(site, s.mast) : null), [site, s.mast]);
  const now = useNow(s.t == null);
  const nowInWindow = model ? now >= model.t0 && now <= model.tEnd : true;
  const live = s.t == null && nowInWindow;
  const t = model ? clampT(model, s.t ?? now) : now;
  const [playing, setPlaying] = usePlayer(model, t);
  const head = idx.data?.sites.find((h) => h.id === s.site) ?? null;
  // Live engine fell back to coarser bundled terrain (dem.degraded), or, on an engine that does not
  // send the note yet, a polar point came back far coarser than the 20 m the curated sites use.
  const degraded = custom && site ? degradedNote(site) : null;
  const coarse = !!degraded || (custom && !!site && site.requested.lat <= -60 && site.dem.near_res_m >= 100);
  const near = custom ? nearestPreset(idx.data?.sites, s.lat, s.lon) : null;
  const drawer = useRef<HTMLElement>(null);

  const openTab = (id: string) => {
    setState({ tab: id });
    requestAnimationFrame(() => drawer.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const openPreset = (id: string) => setState({ site: id, lat: null, lon: null, mast: "2" }, { push: true });

  const currentName = custom ? (customOk ? `Custom point ${fmtLat(s.lat!)}, ${fmtLon(s.lon!)}` : "Custom point") : site?.name ?? head?.name ?? s.site;
  const bar = (
    <div className="site-bar">
      <SitePicker sites={idx.data?.sites ?? []} current={currentName} />
      <div className="site-pick">
        <span className="ctl-label" id="mast-l">
          Mast height
        </span>
        <div className="seg" role="group" aria-labelledby="mast-l" data-hl="mast">
          {(custom || !site ? ["0", "2", "10"] : mastKeys(site)).map((k) => (
            <button key={k} aria-pressed={(model?.mast ?? s.mast) === k} onClick={() => setState({ mast: k })} title={`Solar panel or antenna ${k} m above the ground`}>
              {k} m
            </button>
          ))}
        </div>
      </div>
      {model && (
        <div className="site-pick">
          <label className="ctl-label" htmlFor="when-input">
            Date and time (UTC)
          </label>
          <div className="when-row" data-hl="when">
            <DateInput id="when-input" model={model} t={t} setPlaying={setPlaying} />
            <NowButton model={model} live={live} setPlaying={setPlaying} />
          </div>
        </div>
      )}
      {site && (
        <div className="site-meta">
          <span>
            {fmtLat(site.requested.lat)}, {fmtLon(site.requested.lon)}
          </span>
          {site.country && <span className="chip chip-quiet">{site.country}</span>}
          {head?.far_side && <span className="chip chip-alert">far side: no Earth</span>}
          {head?.earth_blocked_by_terrain && <span className="chip chip-alert">Earth hidden by terrain</span>}
          {custom && <span className="chip chip-live">computed live{site.meta.compute_s != null ? ` in ${site.meta.compute_s} s` : ""}</span>}
          {custom && <span className={`chip ${coarse ? "chip-alert" : "chip-quiet"}`}>{degraded ? "fallback " : ""}terrain {site.dem.near_res_m} m/px near the site</span>}
          <a className="meta-link" href={quickmapLink(site.requested.lat, site.requested.lon).href} target="_blank" rel="noreferrer" title="See this spot in LROC QuickMap (new tab)">
            QuickMap ↗
          </a>
          <a className="meta-link" href={moonTrekLink(site.requested.lat, site.requested.lon).href} target="_blank" rel="noreferrer" title="See this spot in NASA Moon Trek (new tab)">
            Moon Trek ↗
          </a>
        </div>
      )}
    </div>
  );

  if (custom && !customOk) {
    return (
      <div className="stack">
        {bar}
        <div className="card">
          <h2>No point chosen yet</h2>
          <p>
            Type a latitude and longitude in the box above (for example −89.45, 222.84), or <button className="linkish" onClick={() => setState({ view: "sites" })}>pick a point on the map</button>.
          </p>
        </div>
      </div>
    );
  }

  if (siteA.error) {
    const er: ApiErrorInfo = custom
      ? describeApiError(siteA.error)
      : { title: "This site could not be loaded", detail: `There is no data file for "${s.site}". It may have been renamed.`, unreachable: false, retry: false };
    const hosted = isDefaultApi();
    return (
      <div className="stack">
        {bar}
        <div className="card card-alert" role="alert">
          <h2>{custom ? (er.unreachable ? "The live engine is not answering yet" : "This point could not be computed just now") : er.title}</h2>
          <p>
            {custom
              ? er.unreachable
                ? "Your own coordinates are computed on request by a small server that sleeps when nobody is using it. It can take about 15 seconds to wake. The preset sites never need it."
                : "The live engine could not get terrain for this exact point. This is usually temporary. The preset sites are precomputed and always work."
              : er.detail}
          </p>
          <div className="row-controls">
            {er.retry && (
              <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            )}
            {near ? (
              <button className={`btn${er.retry ? "" : " btn-primary"}`} onClick={() => openPreset(near.site.id)}>
                Try a preset: {near.site.name} ({fmtKm(near.km)} away)
              </button>
            ) : (
              <button className={`btn${er.retry ? "" : " btn-primary"}`} onClick={() => openPreset(DEFAULTS.site)}>
                Try a preset: Shackleton rim
              </button>
            )}
            {custom && (
              <button className="btn" onClick={() => setState({ view: "sites" })}>
                Move the point
              </button>
            )}
          </div>
          {custom && (
            <details className="explain">
              <summary>Advanced: what went wrong</summary>
              <p>
                <b>{er.title}.</b> {er.detail}
              </p>
              {er.hint && <p>{er.hint}</p>}
              <p>
                Engine address: <code>{getApiBase()}</code>
                {hosted ? " (the hosted engine)." : `. This browser is set to a different engine than the hosted one (${DEFAULT_API}).`}
              </p>
              {!hosted && (
                <p>
                  <button
                    className="btn"
                    onClick={() => {
                      resetApiBase();
                      setAttempt((n) => n + 1);
                    }}
                  >
                    Reset to the hosted engine
                  </button>
                </p>
              )}
              {er.unreachable && (
                <>
                  <p>Running the engine on your own machine? Start it from the engine folder, then press Try again:</p>
                  <pre className="code">.venv/Scripts/python -m uvicorn lunarnav.api:app --app-dir src --port 8765</pre>
                </>
              )}
            </details>
          )}
        </div>
      </div>
    );
  }

  if (!site || !model) {
    return (
      <div className="stack">
        {bar}
        <div className="card loading" role="status">
          {custom ? (
            <>
              <p>
                <b>Computing the horizon for your point from NASA's LOLA terrain…</b>
              </p>
              <p>Usually a few seconds. The first request after a quiet spell takes about 15 seconds, and a new polar region can take a few minutes.</p>
              {near && (
                <p>
                  <button className="btn" onClick={() => openPreset(near.site.id)}>
                    Meanwhile, open the nearest preset: {near.site.name} ({fmtKm(near.km)} away)
                  </button>
                </p>
              )}
            </>
          ) : (
            "Loading site…"
          )}
        </div>
      </div>
    );
  }

  const jump = (tt: number) => {
    setPlaying(false);
    setState({ t: clampT(model, tt) });
  };
  const range = timelineRange(model, t, s.zoom);
  const hasEarth = model.any.earth.length > 0;
  const lanes = [
    { label: "Sun", cls: "sun" as const, any: model.any.sun, full: model.full.sun },
    ...(hasEarth
      ? [
          { label: "Earth", cls: "earth" as const, any: model.any.earth, full: model.full.earth },
          { label: "Both", cls: "both" as const, any: model.both },
        ]
      : []),
    { label: "Flat 0°", cls: "open" as const, any: openIntervals(model, "sun") },
  ];

  const tabs: [string, string][] = site.mission_replay ? [["mission", "Mission replay"], ...TABS] : TABS;
  const tab = tabs.some(([id]) => id === s.tab) ? s.tab! : tabs[0][0];
  const tabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = tabs[(tabs.findIndex(([id]) => id === tab) + d + tabs.length) % tabs.length][0];
    setState({ tab: next });
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  };

  return (
    <div className="stack">
      {bar}
      {coarse && (
        <div className="caveat" role="note">
          <strong>Coarser terrain than the preset sites.</strong>{" "}
          {degraded ??
            `This point was computed on ${site.dem.near_res_m} m/px terrain, not the 20 m/px the preset sites use. Nearby ridges are smoothed, so event times can shift by minutes to hours.`}{" "}
          Treat the times below as approximate.
        </div>
      )}
      {!nowInWindow && s.t == null && (
        <p className="note">
          The real clock is outside the precomputed window ({fmtDateTime(model.t0)} to {fmtDateTime(model.tEnd)}), so the cursor starts at its edge.
        </p>
      )}

      <div className="cockpit">
        <NowPanel model={model} t={t} live={live} lang={s.lang} head={head} onJump={jump} onTab={openTab} />

        <section className="card card-hero sky" aria-labelledby="pano-h">
          <h2 id="pano-h" className="sr-only">
            The horizon from {site.name}, mast {model.mast} m
          </h2>
          <Panorama model={model} t={t} onJump={jump} />
          <ScrubControls model={model} t={t} live={live} playing={playing} setPlaying={setPlaying} zoom={s.zoom} />
          <Timeline groups={[{ lanes }]} range={range} limits={[model.t0, model.tEnd]} t={t} onT={jump} stayMs={s.stay * DAY} slipMs={s.slip * DAY} />
          <details className="explain" lang={s.lang}>
            <summary>{tr(s.lang, "explainTitle")}</summary>
            <p>{tr(s.lang, "explain1")}</p>
            <p>{tr(s.lang, "explain2")}</p>
            <p>{tr(s.lang, "explain3")}</p>
            <p>
              <b>The coloured lanes</b> under the sky are the same story along time: drag them, or use the arrow keys (Shift for days, Page Up/Down for a lunar day). The outlined box is the planned {s.stay}-day stay
              {s.slip ? "; the dashed box is the slipped stay" : ""}.
            </p>
            <LaneLegend earth={hasEarth} open />
          </details>
        </section>
      </div>

      <section className="drawer" ref={drawer} aria-label="More about this site">
        <div className="tabs" role="tablist" aria-label="More about this site" onKeyDown={tabKey}>
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="tab-panel" tabIndex={tab === id ? 0 : -1} onClick={() => setState({ tab: id })}>
              {label}
            </button>
          ))}
        </div>
        <div className="stack" role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`}>
          {tab === "mission" && <MissionCard site={site} />}
          {tab === "plan" && <StayPlanner model={model} t={t} stay={s.stay} slip={s.slip} onStay={(d) => setState({ stay: d })} onSlip={(d) => setState({ slip: d })} onJump={jump} />}
          {tab === "longterm" && (
            <>
              <LongTermCard site={site} mast={model.mast} onMast={custom ? undefined : (k) => setState({ mast: k })} />
              {site.sensitivity && <SensitivityCard s={site.sensitivity} />}
            </>
          )}
          {tab === "horizon" && (
            <>
              <BlockerRadar model={model} t={t} />
              <ExploreLinks lat={site.requested.lat} lon={site.requested.lon} name={site.name} />
            </>
          )}
          {tab === "sure" && (
            <>
              {site.uncertainty ? <UncertaintyCard site={site} onJump={jump} /> : <NoClonesCard custom={custom} />}
              <Provenance site={site} />
            </>
          )}
          {tab === "events" && <EventsTable model={model} t={t} onJump={jump} />}
        </div>
      </section>
    </div>
  );
}
