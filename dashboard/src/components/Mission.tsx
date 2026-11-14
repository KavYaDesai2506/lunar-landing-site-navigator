import { horizonAt } from "../lib/astro";
import SourceLink from "./SourceLink";
import { DAY, fmtAz, fmtDate, fmtDateTime, fmtDeg, fmtDur, fmtKm, fmtSpan, fmtTime, parseUtc } from "../lib/format";
import { missionKind } from "../lib/types";
import type { MissionReplay, Site } from "../lib/types";
import MissionReplayPlayer, { hasReplayTrack } from "./MissionReplayPlayer";
import { useWidth } from "./Panorama";

export interface Verdict {
  tag: string;
  /** "visit" = replayed but not scored (Apollo, Chang'e-3, Chang'e-6) */
  tone: "match" | "honest" | "info" | "visit";
  text: string;
}

/** The marker in front of a verdict tag. Unscored replays carry none. */
export function toneMark(tone: Verdict["tone"]): string {
  return tone === "match" ? "✓ " : tone === "honest" ? "◆ " : tone === "info" ? "○ " : "";
}

/** "4.3°": height of the Sun's or Earth's centre above the terrain horizon. */
export function fmtClear(deg: number | undefined): string {
  return deg == null || !isFinite(deg) ? "n/a" : fmtDeg(deg, 1);
}

/** Earth (the radio link) at landing and at the end of the stay, in a few words. */
export function earthText(r: MissionReplay, farSide?: boolean): { main: string; sub: string } | null {
  const e = r.earth_clearance_deg_at;
  if (!e) return null;
  if (e.landed > 0 && e.end > 0) return { main: "In view", sub: `${fmtClear(e.landed)} above the terrain at landing` };
  if (e.landed <= 0 && e.end <= 0) return { main: farSide ? "Never (far side)" : "Not in view", sub: `${fmtClear(-e.landed)} below the terrain horizon at landing` };
  return { main: e.landed > 0 ? "In view at landing only" : "Not in view at landing", sub: `${fmtClear(e.landed)} at landing, ${fmtClear(e.end)} at the end` };
}

export interface OpenGap {
  terrain: number;
  open: number;
  /** flat-horizon sunset minus terrain sunset, hours: positive = terrain ends the light first */
  h: number;
  horizonEl: number;
}

/** Terrain sunset against the flat-horizon one, when the file carries both (added 13 Nov). */
export function openGap(r: MissionReplay): OpenGap | null {
  const a = r.first_terrain_sunset_after_landing;
  const o = r.first_open_sunset_after_landing;
  if (!a || !o) return null;
  const terrain = parseUtc(a.utc);
  const open = parseUtc(o.utc);
  if (!isFinite(terrain) || !isFinite(open)) return null;
  return { terrain, open, h: (open - terrain) / 3600e3, horizonEl: a.horizon_el_deg };
}

export function gapText(g: OpenGap): string {
  return `${fmtSpan(g.h)} ${g.h >= 0 ? "later" : "earlier"}`;
}

export function verdict(r: MissionReplay): Verdict {
  const d = r.end_minus_sunset_h;
  const pct = Math.round(r.sun_frac_at_end * 100);
  const sunset = r.first_terrain_sunset_after_landing;
  const c = r.sun_clearance_deg_at;
  const landed = parseUtc(r.landed_utc);
  const up = c ? ` with the Sun ${fmtClear(c.landed)} above the terrain` : "";
  switch (r.expected) {
    case "daylight_stay":
      return {
        tag: "Left in daylight",
        tone: "visit",
        text: `Not a scored test: light did not end this visit. It landed${up} and lifted off ${fmtDur(parseUtc(r.end_utc) - landed)} later${c ? `, with the Sun ${fmtClear(c.end)} up` : ""}.${
          sunset && d != null && d < 0 ? ` The first terrain sunset came ${fmtSpan(d)} after lift-off.` : ""
        }`,
      };
    case "still_operating":
      return {
        tag: "Still operating",
        tone: "visit",
        text: `Not a scored test: this lander has no end of mission to compare with. It landed${up}. The replay covers its first lunar day and night${
          sunset ? `: predicted terrain sunset ${fmtSpan((parseUtc(sunset.utc) - landed) / 3600e3)} after landing` : ""
        }${sunset && r.sunrises_after_landing.length ? `, next sunrise ${fmtDate(parseUtc(r.sunrises_after_landing[0]))}` : ""}.`,
      };
    case "sunset_after_end":
    case "sunset_near_end":
      return {
        tag: d != null ? `Prediction within ${fmtSpan(d)} of the record` : "Prediction near the record",
        tone: "match",
        text: `The mission was ended ${d != null ? fmtSpan(d) : ""} before the predicted terrain sunset, with ${pct}% of the Sun's disc still above the terrain.`,
      };
    case "sunset_before_end":
      return {
        tag: d != null ? `Prediction within ${fmtSpan(d)} of the record` : "Prediction near the record",
        tone: "match",
        text: `Predicted terrain sunset came ${d != null ? fmtSpan(d) : ""} before the reported end: the lander ran on into the night on stored power.`,
      };
    case "negative_control":
      return {
        tag: "Light was not the limit",
        tone: "honest",
        text: `The site still had sunlight when the mission ended${d != null ? `, and kept it for another ${fmtSpan(d)}` : ""}. Lander orientation is outside this model, and the tool says so instead of claiming a match.`,
      };
    case "tilt_limited":
      return {
        tag: "Tilt, not terrain, ended it",
        tone: "honest",
        text: `Terrain sunlight remained for ${d != null ? fmtSpan(d) : "days"} after power was lost. The tipped lander's one lit panel lost the low Sun first. We did not loosen the pass threshold to count this as a match.`,
      };
    case "multi_night":
      return {
        tag: "Survived several nights",
        tone: "info",
        text: `The lander woke after more than one lunar night. ${r.sunrises_after_landing.length} terrain sunrises are predicted in the mission window${sunset ? "; the first sunset is shown below" : ""}. Wake-up dates from the agency have not been compared yet.`,
      };
  }
}

function litIntervals(r: MissionReplay): [number, number][] {
  const [w0, w1] = r.window.map(parseUtc);
  const evs = r.events.filter((e) => e.target === "sun" && (e.kind === "first_light" || e.kind === "last_light")).map((e) => ({ t: parseUtc(e.utc), up: e.kind === "first_light" }));
  const out: [number, number][] = [];
  let cur: number | null = evs.length ? (evs[0].up ? null : w0) : r.sun_frac_at_end > 0 ? w0 : null;
  for (const e of evs) {
    if (e.up) {
      if (cur == null) cur = e.t;
    } else if (cur != null) {
      out.push([cur, e.t]);
      cur = null;
    }
  }
  if (cur != null) out.push([cur, w1]);
  return out;
}

function Strip({ r }: { r: MissionReplay }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const W = Math.max(width, 260);
  const [w0, w1] = r.window.map(parseUtc);
  const landed = parseUtc(r.landed_utc);
  const end = parseUtc(r.end_utc);
  const sunset = r.first_terrain_sunset_after_landing ? parseUtc(r.first_terrain_sunset_after_landing.utc) : null;
  const L = 8;
  const R = 8;
  const X = (t: number) => L + ((t - w0) / (w1 - w0)) * (W - L - R);
  const lit = litIntervals(r);
  const gap = openGap(r);
  const kind = missionKind(r);
  const endWord = kind === "visit" ? "Lift-off" : "Reported end";
  const days = (w1 - w0) / DAY;
  const every = days > 60 ? 14 : days > 25 ? 7 : 2;
  const ticks: number[] = [];
  for (let t = Math.ceil(w0 / DAY) * DAY; t < w1; t += DAY) if (Math.round(t / DAY) % every === 0) ticks.push(t);
  // keep the three labels from colliding: stack them on separate rows
  const marks = [
    { t: landed, label: `Landed ${fmtDate(landed, false)}`, cls: "mk-land", row: 0 },
    // Chang'e-3: end_utc only closes the replayed first day and night, so it gets no "end" marker
    ...(kind === "operating" ? [] : [{ t: end, label: `${endWord} ${fmtDate(end, false)} ${fmtTime(end)}`, cls: kind === "visit" ? "mk-land" : "mk-end", row: 1 }]),
    ...(sunset ? [{ t: sunset, label: `Predicted terrain sunset ${fmtDate(sunset, false)} ${fmtTime(sunset)}`, cls: "mk-sunset", row: 2 }] : []),
    ...(gap ? [{ t: gap.open, label: `Flat-horizon sunset ${fmtDate(gap.open, false)} ${fmtTime(gap.open)}`, cls: "mk-open", row: 3 }] : []),
  ];
  const top = gap ? 16 : 0;
  const H = 118 + top;
  const laneY = 62 + top;
  return (
    <div ref={ref} className="chart-wrap">
      {width > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Mission timeline: landed ${fmtDateTime(landed)}, ${kind === "operating" ? "replay ends" : endWord.toLowerCase()} ${fmtDateTime(end)}${sunset ? `, predicted terrain sunset ${fmtDateTime(sunset)}` : ""}.`}>
          <rect x={L} y={laneY} width={W - L - R} height={18} className="lane-bg" />
          {lit.map(([a, b], i) => (
            <rect key={i} x={X(a)} y={laneY} width={Math.max(1, X(b) - X(a))} height={18} className="lane-fill sun" />
          ))}
          <rect x={X(landed)} y={laneY - 3} width={Math.max(2, X(end) - X(landed))} height={24} className="stay-box" />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={laneY + 18} y2={laneY + 23} className="tl-grid major" />
              <text x={X(t)} y={laneY + 36} textAnchor="middle" className="axis-text">
                {fmtDate(t, false)}
              </text>
            </g>
          ))}
          {marks.map((mk) => {
            const x = X(mk.t);
            const tx = Math.max(4, Math.min(x + 8, W - mk.label.length * 6.9 - 4));
            return (
              <g key={mk.label}>
                <line x1={x} x2={x} y1={10 + mk.row * 16} y2={laneY + 18} className={`mk ${mk.cls}`} />
                <circle cx={x} cy={10 + mk.row * 16} r={3.5} className={`mk-dot ${mk.cls}`} />
                <text x={tx} y={14 + mk.row * 16} className="mk-label halo">
                  {mk.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="pano-legend">
        <span>
          <i className="sw sw-box sun" /> Sun above terrain (predicted)
        </span>
        <span>
          <i className="sw sw-box dark" /> dark
        </span>
        <span>
          <i className="sw sw-box stay" /> {kind === "visit" ? "landing to lift-off" : kind === "operating" ? "the replayed first lunar day and night" : "landing to reported end"}
        </span>
        {gap && (
          <span>
            <i className="sw sw-mk open" /> sunset on a flat 0° horizon (no terrain)
          </span>
        )}
      </div>
    </div>
  );
}

/** A slice of the horizon around the predicted sunset: the Sun's disc meeting the named ridge. */
function SunsetSlice({ site }: { site: Site }) {
  const e = site.mission_replay?.first_terrain_sunset_after_landing;
  const hor = site.horizons[String(site.default_mast_m)]?.el_deg;
  if (!e || !hor) return null;
  const W = 300;
  const H = 150;
  const half = 20;
  let lo = Infinity;
  let hi = -Infinity;
  const pts: [number, number][] = [];
  for (let d = -half; d <= half; d += 0.5) {
    const v = horizonAt(hor, e.az_deg + d);
    pts.push([d, v]);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  lo = Math.min(lo, e.el_deg - 0.4) - 0.4;
  hi = Math.max(hi, e.el_deg + 0.4) + 0.5;
  const X = (d: number) => ((d + half) / (2 * half)) * W;
  const Y = (v: number) => 8 + ((hi - v) / (hi - lo)) * (H - 16);
  const r = Math.max(4, 0.267 * ((H - 16) / (hi - lo)));
  const path = pts.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  return (
    <figure className="slice">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Horizon around azimuth ${fmtAz(e.az_deg)} at the predicted sunset: the Sun's upper limb meets the terrain.`}>
        <rect width={W} height={H} className="pano-sky" rx={6} />
        <circle cx={X(0)} cy={Y(e.el_deg)} r={r} className="disc-sun" />
        <path d={`${path}L${W},${H}L0,${H}Z`} className="terrain-fill" />
        <path d={path} className="terrain-line mid" />
        <circle cx={X(0)} cy={Y(e.el_deg)} r={r} className="disc-ghost sun" />
        <text x={6} y={H - 8} className="axis-text">
          {fmtAz(e.az_deg - half)}
        </text>
        <text x={W - 6} y={H - 8} textAnchor="end" className="axis-text">
          {fmtAz(e.az_deg + half)}
        </text>
      </svg>
      <figcaption>
        Last light at {fmtAz(e.az_deg)}: Sun centre {fmtDeg(e.el_deg)}, terrain {fmtDeg(e.horizon_el_deg)}
        {e.blocker ? `. The dashed ring is the Sun at that moment, its upper edge just touching the terrain: ${e.blocker.dist_km < 1 ? "the ground slope right at the site" : e.blocker.phrase}, ${fmtKm(e.blocker.dist_km)} away.` : "."}
      </figcaption>
    </figure>
  );
}

export function MissionCard({ site, heading = "h2" }: { site: Site; heading?: "h2" | "h3" | "none" }) {
  const r = site.mission_replay;
  if (!r) return null;
  const v = verdict(r);
  const sunset = r.first_terrain_sunset_after_landing;
  const gap = openGap(r);
  const player = hasReplayTrack(site);
  const kind = missionKind(r);
  const c = r.sun_clearance_deg_at;
  const earth = earthText(r);
  const Hd = heading === "none" ? "h3" : heading;
  return (
    <section className={heading === "none" ? "mission" : "card mission"} aria-label={`Mission replay: ${site.name}`}>
      {heading !== "none" && (
        <div className="card-head">
          <Hd>
            {heading === "h2" ? (kind === "scored" ? "Mission replay: predicted light vs what happened" : "Mission replay: the light during the visit") : site.name}
            {site.country && heading !== "h2" ? <span className="muted"> · {site.country}</span> : null}
          </Hd>
          <span className={`tag tag-${v.tone}`}>{toneMark(v.tone)}{v.tag}</span>
        </div>
      )}
      <p className="card-lede">{v.text}</p>
      {gap && (
        <p className="gap-line">
          <span className="chip chip-why">Terrain vs flat horizon</span>{" "}
          {gap.h >= 0 ? (
            <>
              The terrain took the Sun at <b>{fmtDateTime(gap.terrain, false)}</b>. A tool with a flat 0° horizon puts that sunset at {fmtDateTime(gap.open, false)}, <b>{gapText(gap)}</b>.
            </>
          ) : (
            <>
              The reverse case: the ground falls away toward the setting Sun (horizon {fmtDeg(gap.horizonEl)} in that direction), so the Sun stayed in view until <b>{fmtDateTime(gap.terrain, false)}</b>, <b>{fmtSpan(gap.h)} after</b> the flat-horizon
              sunset at {fmtDateTime(gap.open, false)}.
            </>
          )}
        </p>
      )}
      {player && <MissionReplayPlayer site={site} />}
      <div className={player ? "mission-grid solo" : "mission-grid"}>
        <div>
          <Strip r={r} />
          <dl className="kv">
            <dt>Landed</dt>
            <dd>{fmtDateTime(parseUtc(r.landed_utc))}</dd>
            {kind === "operating" ? (
              <>
                <dt>Status</dt>
                <dd>{r.end_reason}</dd>
                <dt>Replay ends</dt>
                <dd>{fmtDateTime(parseUtc(r.end_utc))}. This is the end of the replayed first lunar day and night, not an end of mission.</dd>
              </>
            ) : (
              <>
                <dt>{kind === "visit" ? "Lifted off" : "Reported end"}</dt>
                <dd>
                  {fmtDateTime(parseUtc(r.end_utc))}: {r.end_reason}
                  {r.end_note ? ` (${r.end_note})` : ""}
                </dd>
              </>
            )}
            {kind === "visit" && (
              <>
                <dt>Time on the surface</dt>
                <dd>{fmtDur(parseUtc(r.end_utc) - parseUtc(r.landed_utc))}</dd>
              </>
            )}
            <dt>Predicted terrain sunset</dt>
            <dd>{sunset ? <b>{fmtDateTime(parseUtc(sunset.utc))}</b> : "none in the replay window"}</dd>
            {gap && (
              <>
                <dt>Flat-horizon sunset (no terrain)</dt>
                <dd>
                  {fmtDateTime(gap.open)}: {gapText(gap)} than the terrain sunset
                </dd>
              </>
            )}
            {kind === "scored" ? (
              <>
                <dt>Sun at the reported end</dt>
                <dd>{r.sun_frac_at_end > 0 ? `${Math.round(r.sun_frac_at_end * 100)}% of the disc above terrain` : "below the terrain horizon (dark)"}</dd>
              </>
            ) : (
              c && (
                <>
                  <dt>Sun above the terrain</dt>
                  <dd>
                    {fmtClear(c.landed)} at landing{kind === "visit" ? `, ${fmtClear(c.end)} at lift-off` : ""} (Sun's centre over the terrain horizon, computed here)
                  </dd>
                </>
              )
            )}
            {kind !== "scored" && earth && (
              <>
                <dt>Earth (radio link)</dt>
                <dd>
                  {earth.main}: {earth.sub}
                </dd>
              </>
            )}
            {r.sunrises_after_landing.length > 0 && (
              <>
                <dt>Predicted sunrises after landing</dt>
                <dd>{r.sunrises_after_landing.map((s) => fmtDateTime(parseUtc(s), true)).join(" · ")}</dd>
              </>
            )}
            <dt>{kind === "scored" ? "Sources for the record" : "Source for the times"}</dt>
            <dd>
              {r.sources.map((s, i) => (
                <span key={s}>
                  {i ? " · " : ""}
                  <SourceLink src={s} />
                </span>
              ))}
            </dd>
          </dl>
        </div>
        {!player && <SunsetSlice site={site} />}
      </div>
    </section>
  );
}
