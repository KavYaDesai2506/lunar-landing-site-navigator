import { useEffect, useMemo, useRef, useState } from "react";
import { MissionCard } from "../components/Mission";
import NowPanel from "../components/NowPanel";
import Panorama from "../components/Panorama";
import { BlockerRadar, EventsTable, LongTermCard, Provenance, SensitivityCard, UncertaintyCard } from "../components/SiteDetails";
import StayPlanner from "../components/StayPlanner";
import Timeline, { LaneLegend } from "../components/Timeline";
import { buildModel, clampT, mastKeys, nextEvent, openIntervals, prevEvent } from "../lib/astro";
import type { Model } from "../lib/astro";
import { DEFAULT_API, degradedNote, describeApiError, getApiBase, isDefaultApi, loadCustom, loadIndex, loadSite, resetApiBase, useAsync } from "../lib/data";
import { ExploreLinks } from "../components/ExternalMaps";
import { DAY, HOUR, fmtDateTime, fmtLat, fmtLon } from "../lib/format";
import { tr } from "../lib/i18n";
import { setState, useAppState } from "../lib/state";
import type { ApiErrorInfo } from "../lib/data";
import type { SiteHeadline } from "../lib/types";

const GROUPS: [SiteHeadline["group"], string][] = [
  ["artemis", "Artemis III candidate regions"],
  ["polar", "South-polar candidates"],
  ["mission", "Robotic missions"],
  ["apollo", "Apollo"],
];

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

export function TimeControls({ model, t, live, playing, setPlaying, zoom }: { model: Model; t: number; live: boolean; playing: boolean; setPlaying: (p: boolean) => void; zoom: number }) {
  const go = (tt: number) => {
    setPlaying(false);
    setState({ t: clampT(model, tt) });
  };
  const nowOk = Date.now() >= model.t0 && Date.now() <= model.tEnd;
  const prev = prevEvent(model, "sun", ["first_light", "last_light"], t - 1000);
  const next = nextEvent(model, "sun", ["first_light", "last_light"], t + 1000);
  const local = new Date(t).toISOString().slice(0, 16);
  return (
    <div className="time-controls">
      <div className="time-readout" aria-live="off">
        <span className="time-big">{fmtDateTime(t)}</span>
        {live ? (
          <span className="chip chip-live">● live</span>
        ) : (
          <span className="chip chip-quiet">pinned</span>
        )}
      </div>
      <div className="row-controls">
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
        <button className="btn btn-primary" onClick={() => setPlaying(!playing)} aria-pressed={playing}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <label className="ctl-label" htmlFor="dt-input">
          Date (UTC)
        </label>
        <input
          id="dt-input"
          type="datetime-local"
          className="input"
          value={local}
          min={new Date(model.t0).toISOString().slice(0, 16)}
          max={new Date(model.tEnd).toISOString().slice(0, 16)}
          onChange={(e) => {
            const v = Date.parse(e.target.value + "Z");
            if (isFinite(v)) go(v);
          }}
        />
        <label className="ctl-label">Show</label>
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
      </div>
    </div>
  );
}

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

  const picker = (
    <div className="site-bar">
      <div className="site-pick">
        <label className="ctl-label" htmlFor="site-select">
          Landing site
        </label>
        <select
          id="site-select"
          className="input select-big"
          value={custom ? "custom" : s.site}
          onChange={(e) => {
            if (e.target.value === "custom") setState({ view: "sites" });
            else setState({ site: e.target.value, lat: null, lon: null, mast: custom ? "2" : s.mast }, { push: true });
          }}
        >
          {GROUPS.map(([g, label]) => (
            <optgroup key={g} label={label}>
              {idx.data?.sites
                .filter((h) => h.group === g)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
            </optgroup>
          ))}
          <optgroup label="Anywhere">
            <option value="custom">{custom && customOk ? `Custom point ${fmtLat(s.lat!)}, ${fmtLon(s.lon!)}` : "Custom coordinates…"}</option>
          </optgroup>
        </select>
      </div>
      <div className="site-pick">
        <span className="ctl-label" id="mast-l">
          Mast height
        </span>
        <div className="seg" role="group" aria-labelledby="mast-l">
          {(custom || !site ? ["0", "2", "10"] : mastKeys(site)).map((k) => (
            <button key={k} aria-pressed={(model?.mast ?? s.mast) === k} onClick={() => setState({ mast: k })} title={`Observer ${k} m above the ground`}>
              {k} m
            </button>
          ))}
        </div>
      </div>
      {site && (
        <div className="site-meta">
          <span>
            {fmtLat(site.requested.lat)}, {fmtLon(site.requested.lon)}
          </span>
          {site.country && <span className="chip chip-quiet">{site.country}</span>}
          {head?.far_side && <span className="chip chip-alert">far side: no Earth</span>}
          {head?.earth_blocked_by_terrain && <span className="chip chip-alert">Earth hidden by terrain</span>}
          {site.uncertainty && <span className="chip chip-quiet">P10–P90 from 100 DEM clones</span>}
          {site.mission_replay && <span className="chip chip-quiet">mission replay</span>}
          {custom && <span className="chip chip-live">computed live{site.meta.compute_s != null ? ` in ${site.meta.compute_s} s` : ""}</span>}
          {custom && <span className={`chip ${coarse ? "chip-alert" : "chip-quiet"}`}>{degraded ? "fallback " : ""}terrain {site.dem.near_res_m} m/px near the site</span>}
        </div>
      )}
    </div>
  );

  if (custom && !customOk) {
    return (
      <div className="stack">
        {picker}
        <div className="card">
          <h2>No custom point chosen</h2>
          <p>
            Pick a point on the <button className="linkish" onClick={() => setState({ view: "sites" })}>Sites page</button>.
          </p>
        </div>
      </div>
    );
  }

  if (siteA.error) {
    const er: ApiErrorInfo = custom
      ? describeApiError(siteA.error)
      : { title: "This site could not be loaded", detail: `No data file for "${s.site}". Run npm run sync-data after the engine's precompute.`, unreachable: false, retry: false };
    const hosted = isDefaultApi();
    return (
      <div className="stack">
        {picker}
        <div className="card card-alert" role="alert">
          <h2>{er.title}</h2>
          <p>{er.detail}</p>
          {er.hint && <p className="note">{er.hint}</p>}
          {er.unreachable && !hosted && (
            <p>
              This browser is set to use a different engine address than the hosted one (<code>{DEFAULT_API}</code>).
            </p>
          )}
          <div className="row-controls">
            {er.unreachable && !hosted && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  resetApiBase();
                  setAttempt((n) => n + 1);
                }}
              >
                Reset to hosted engine
              </button>
            )}
            {er.retry && (
              <button className={`btn${er.unreachable && !hosted ? "" : " btn-primary"}`} onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            )}
            {custom && (
              <button className="btn" onClick={() => setState({ view: "sites" })}>
                Change the point
              </button>
            )}
            <button className={`btn${er.retry ? "" : " btn-primary"}`} onClick={() => setState({ site: "shackleton_rim_s", lat: null, lon: null, mast: "2" })}>
              Open a curated site instead
            </button>
          </div>
          {er.unreachable && (
            <details className="explain">
              <summary>Running the engine locally?</summary>
              <p>Start it from the engine folder, then press Try again:</p>
              <pre className="code">.venv/Scripts/python -m uvicorn lunarnav.api:app --app-dir src --port 8765</pre>
              <p>
                The engine address can be changed on the <button className="linkish" onClick={() => setState({ view: "sites" })}>Sites page</button>.
              </p>
            </details>
          )}
        </div>
      </div>
    );
  }

  if (!site || !model) {
    return (
      <div className="stack">
        {picker}
        <div className="card loading" role="status">
          {custom ? "Computing the terrain horizon for this point from LOLA elevation data… (a few seconds near the south pole and for curated regions; a new polar region downloads 20 m terrain first and can take a few minutes)" : "Loading site…"}
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

  return (
    <div className="stack">
      {picker}
      {coarse && (
        <div className="caveat" role="note">
          <strong>Coarser terrain than the curated sites.</strong>{" "}
          {degraded ??
            `This point was computed on ${site.dem.near_res_m} m/px terrain, not the 20 m/px the curated sites use. Nearby ridges are smoothed, so event times can shift by minutes to hours.`}{" "}
          Treat the times below as approximate.
        </div>
      )}
      {!nowInWindow && s.t == null && <p className="note">The real clock is outside the precomputed window ({fmtDateTime(model.t0)} to {fmtDateTime(model.tEnd)}), so the cursor starts at its edge.</p>}
      <NowPanel model={model} t={t} live={live} lang={s.lang} head={head} onJump={jump} />

      <section className="card card-hero" aria-labelledby="pano-h">
        <div className="card-head">
          <h2 id="pano-h">The horizon from the site</h2>
          <span className="muted">
            {site.name} · mast {model.mast} m · {fmtDateTime(t)}
          </span>
        </div>
        <Panorama model={model} t={t} onJump={jump} />
        <details className="explain" lang={s.lang}>
          <summary>{tr(s.lang, "explainTitle")}</summary>
          <p>{tr(s.lang, "explain1")}</p>
          <p>{tr(s.lang, "explain2")}</p>
          <p>{tr(s.lang, "explain3")}</p>
        </details>
      </section>

      <section className="card" aria-labelledby="time-h">
        <h2 id="time-h" className="sr-only">
          Time
        </h2>
        <TimeControls model={model} t={t} live={live} playing={playing} setPlaying={setPlaying} zoom={s.zoom} />
        <Timeline groups={[{ lanes }]} range={range} limits={[model.t0, model.tEnd]} t={t} onT={jump} stayMs={s.stay * DAY} slipMs={s.slip * DAY} />
        <LaneLegend earth={hasEarth} open />
        <p className="note">
          Drag the lanes or use the arrow keys (Shift for days, Page Up/Down for a lunar day). The outlined box is the planned {s.stay}-day stay{ s.slip ? "; the dashed box is the slipped stay" : ""}.
        </p>
      </section>

      {site.mission_replay && <MissionCard site={site} />}

      <StayPlanner model={model} t={t} stay={s.stay} slip={s.slip} onStay={(d) => setState({ stay: d })} onSlip={(d) => setState({ slip: d })} onJump={jump} />

      <LongTermCard site={site} mast={model.mast} onMast={custom ? undefined : (k) => setState({ mast: k })} />
      <div className="grid-2">
        <BlockerRadar model={model} t={t} />
        {site.sensitivity && <SensitivityCard s={site.sensitivity} />}
        {site.uncertainty && <UncertaintyCard site={site} onJump={jump} />}
      </div>

      <EventsTable model={model} t={t} onJump={jump} />
      <ExploreLinks lat={site.requested.lat} lon={site.requested.lon} name={site.name} />
      <Provenance site={site} />
    </div>
  );
}
