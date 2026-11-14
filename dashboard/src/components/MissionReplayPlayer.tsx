import { useEffect, useMemo, useRef, useState } from "react";
import { angDiff, decodeBody, discFrac, horizonAt, inIntervals, intervals, wrap360 } from "../lib/astro";
import type { Ev, Iv } from "../lib/astro";
import { DAY, HOUR, compass, fmtAz, fmtDate, fmtDateTime, fmtDeg, fmtDur, fmtKm, fmtSpan, fmtTime, parseUtc } from "../lib/format";
import type { MissionReplay, Site, SiteEvent } from "../lib/types";
import { useWidth } from "./Panorama";
import { Stars, SunDisc } from "./SpaceArt";

/** Everything the animated replay needs, decoded once per site. */
export interface Replay {
  hor: number[];
  t0: number;
  step: number;
  n: number;
  az: Float64Array;
  el: Float64Array;
  r: number;
  /** scrub range: landing to a little past the last of (reported end, terrain sunset, flat-horizon sunset) */
  a: number;
  b: number;
  landed: number;
  end: number;
  tSet: number | null;
  oSet: number | null;
  setEv: SiteEvent | null;
  evs: Ev[];
  lit: Iv[];
  open: Iv[];
  yMin: number;
  yMax: number;
  start: number;
}

function withT(list: SiteEvent[] | undefined): Ev[] {
  return (list ?? []).map((e) => ({ ...e, t: parseUtc(e.utc) })).sort((p, q) => p.t - q.t);
}

export function buildReplay(site: Site, r: MissionReplay): Replay | null {
  const tr = r.track;
  const hor = site.horizons[String(site.default_mast_m)]?.el_deg;
  if (!tr || !hor || !tr.sun?.el_mdeg?.length || tr.sun.el_mdeg.length < 2) return null;
  const t0 = parseUtc(tr.start_utc);
  const step = tr.step_s * 1000;
  const n = tr.sun.el_mdeg.length;
  const body = decodeBody(tr.sun.az_cdeg, tr.sun.el_mdeg, tr.sun.ang_radius_deg, hor);
  const tEnd = t0 + (n - 1) * step;
  const landed = parseUtc(r.landed_utc);
  const end = parseUtc(r.end_utc);
  const setEv = r.first_terrain_sunset_after_landing;
  const tSet = setEv ? parseUtc(setEv.utc) : null;
  const oSet = r.first_open_sunset_after_landing ? parseUtc(r.first_open_sunset_after_landing.utc) : null;
  const a = Math.max(t0, landed);
  const b = Math.min(tEnd, Math.max(end, tSet ?? end, oSet ?? end) + 6 * HOUR);
  if (!(b > a)) return null;
  const evs = withT(r.events);
  const openEvs = withT(r.open_events);
  const lit = intervals(evs, "sun", "first_light", "last_light", t0, tEnd, body.frac[0] > 0);
  const open = intervals(openEvs, "sun", "first_light", "last_light", t0, tEnd, body.el[0] + body.r > 0);

  // vertical frame: the terrain the low Sun passes over during the replay, plus room for the disc
  let hmin = 0;
  let hmax = 0;
  let elMin = 0;
  const i0 = Math.max(0, Math.floor((a - t0) / step));
  const i1 = Math.min(n - 1, Math.ceil((b - t0) / step));
  for (let i = i0; i <= i1; i++) {
    if (body.el[i] > 6) continue;
    elMin = Math.min(elMin, body.el[i]);
    for (let d = -12; d <= 12; d += 2) {
      const h = horizonAt(hor, body.az[i] + d);
      hmin = Math.min(hmin, h);
      hmax = Math.max(hmax, h);
    }
  }
  const yMin = Math.max(-4, Math.min(hmin - 0.7, Math.max(elMin, -1.6) - 0.5, -1));
  const yMax = Math.min(8, Math.max(hmax + 1.6, 3.2));

  // open on the approach to the first moment the story turns: sunset (either kind) or the reported end
  const keys = [tSet, oSet, end].filter((x): x is number => x != null && x > a && x <= b);
  const start = Math.max(a, Math.min(...(keys.length ? keys : [b])) - 14 * HOUR);
  return { hor, t0, step, n, az: body.az, el: body.el, r: body.r, a, b, landed, end, tSet, oSet, setEv, evs, lit, open, yMin, yMax, start };
}

export function sunAt(R: Replay, t: number): { az: number; el: number } {
  const x = Math.min(R.n - 1, Math.max(0, (t - R.t0) / R.step));
  const i = Math.min(R.n - 2, Math.floor(x));
  const f = x - i;
  return { az: R.az[i] * (1 - f) + R.az[i + 1] * f, el: R.el[i] * (1 - f) + R.el[i + 1] * f };
}

const SPEEDS: { label: string; rate: number; title: string }[] = [
  { label: "30 min/s", rate: 0.5 * HOUR, title: "Half an hour of mission time per second" },
  { label: "2 h/s", rate: 2 * HOUR, title: "Two hours of mission time per second" },
  { label: "12 h/s", rate: 12 * HOUR, title: "Half a day of mission time per second" },
];

export function hasReplayTrack(site: Site): boolean {
  const tr = site.mission_replay?.track;
  return !!tr && Array.isArray(tr.sun?.el_mdeg) && tr.sun.el_mdeg.length > 1;
}

/**
 * Animated replay: the Sun moving along the measured horizon up to the end of the mission,
 * with the terrain answer and the flat-horizon answer side by side.
 */
export default function MissionReplayPlayer({ site }: { site: Site }) {
  const r = site.mission_replay;
  const R = useMemo(() => (r ? buildReplay(site, r) : null), [site, r]);
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [t, setT] = useState(() => R?.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const tRef = useRef(t);
  tRef.current = t;
  const dragging = useRef(false);

  useEffect(() => {
    if (R) setT(R.start);
    setPlaying(false);
  }, [R]);

  useEffect(() => {
    if (!playing || !R) return;
    let raf = 0;
    let last = performance.now();
    const rate = SPEEDS[speed].rate;
    const tick = (now: number) => {
      const dt = Math.min(120, now - last);
      last = now;
      const next = tRef.current + (dt / 1000) * rate;
      if (next >= R.b) {
        setT(R.b);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, R]);

  if (!r || !R) return null;

  const go = (x: number) => {
    setPlaying(false);
    setT(Math.min(R.b, Math.max(R.a, x)));
  };
  const toggle = () => {
    if (!playing && t >= R.b - 1000) setT(R.start);
    setPlaying(!playing);
  };

  // ---- state at t ----
  const sun = sunAt(R, t);
  const horAtSun = horizonAt(R.hor, sun.az);
  const litIv = inIntervals(R.lit, t);
  const openIv = inIntervals(R.open, t);
  let frac = discFrac(sun.el, horAtSun, R.r);
  // the refined event list decides lit / dark; the 30-min track gives the size of the visible part
  if (litIv && frac <= 0) frac = 0.01;
  if (!litIv && frac > 0) frac = 0;
  const alive = t < R.end;
  const nextLit = !litIv ? R.lit.find((iv) => iv[0] > t) ?? null : null;
  const nextOpen = !openIv ? R.open.find((iv) => iv[0] > t) ?? null : null;
  let darkBy: SiteEvent | null = null;
  if (!litIv) for (const e of R.evs) if (e.target === "sun" && e.kind === "last_light" && e.t <= t) darkBy = e;
  const blockName = (e: SiteEvent | null) => (e?.blocker ? (e.blocker.dist_km < 1 ? "the ground slope right at the site" : e.blocker.phrase) : "the horizon");

  const terrText = litIv
    ? frac >= 0.999
      ? `Full Sun, ${fmtDeg(sun.el - horAtSun)} above the terrain`
      : `Partial Sun: ${Math.max(1, Math.round(frac * 100))}% of the disc above the terrain`
    : `Dark: terrain hides the Sun (${blockName(darkBy)})`;
  const terrSub = litIv ? (litIv[1] < R.b + DAY ? `sets in ${fmtDur(litIv[1] - t)}` : "") : nextLit ? `back in ${fmtDur(nextLit[0] - t)}` : "";
  const openText = openIv ? "Sun up" : "Sun down";
  const openSub = openIv ? (openIv[1] < R.b + DAY ? `sets in ${fmtDur(openIv[1] - t)}` : "") : nextOpen ? `back in ${fmtDur(nextOpen[0] - t)}` : "";

  let clash: string | null = null;
  if (!litIv && openIv) clash = `The terrain has taken the Sun. A tool with a flat horizon still shows daylight here for another ${fmtDur(openIv[1] - t)}.`;
  else if (litIv && !openIv) clash = `A tool with a flat horizon says the Sun is down. From this spot it is still in view for another ${fmtDur(litIv[1] - t)}, because the ground falls away toward it.`;

  // ---- frame ----
  const W = Math.max(width, 260);
  const narrow = W < 560;
  const H = narrow ? 236 : 300;
  const L = 38;
  const Rm = 8;
  const T = 10;
  const B = 24;
  const PW = W - L - Rm;
  const PH = H - T - B;
  const ypx = PH / (R.yMax - R.yMin);
  const STRETCH = 2.5;
  const span = Math.min(60, Math.max(14, PW / (ypx / STRETCH)));
  const xpx = PW / span;
  const centre = sun.az;
  const X = (az: number) => L + (angDiff(az, centre) + span / 2) * xpx;
  const Y = (el: number) => T + (R.yMax - el) * ypx;
  const inView = (az: number) => Math.abs(angDiff(az, centre)) <= span / 2 + 1;

  let terr = "";
  for (let d = -span / 2 - 1; d <= span / 2 + 1; d += 0.25) {
    terr += `${terr ? "L" : "M"}${(L + (d + span / 2) * xpx).toFixed(1)},${Y(horizonAt(R.hor, centre + d)).toFixed(1)}`;
  }
  const terrFill = `${terr}L${(L + PW + xpx).toFixed(1)},${H - B}L${(L - xpx).toFixed(1)},${H - B}Z`;

  // Sun path two days either side of the cursor: solid where terrain lets it through, dashed where hidden
  let pVis = "";
  let pHid = "";
  {
    const k0 = Math.max(0, Math.floor((t - 2 * DAY - R.t0) / R.step));
    const k1 = Math.min(R.n - 1, Math.ceil((t + 2 * DAY - R.t0) / R.step));
    for (let k = k0 + 1; k <= k1; k++) {
      const d0 = R.az[k - 1] - centre;
      const d1 = R.az[k] - centre;
      if (Math.abs(d0) > span / 2 + 2 && Math.abs(d1) > span / 2 + 2) continue;
      const seg = `M${(L + (d0 + span / 2) * xpx).toFixed(1)},${Y(R.el[k - 1]).toFixed(1)}L${(L + (d1 + span / 2) * xpx).toFixed(1)},${Y(R.el[k]).toFixed(1)}`;
      if (inIntervals(R.lit, R.t0 + (k - 0.5) * R.step)) pVis += seg;
      else pHid += seg;
    }
  }

  const yStep = R.yMax - R.yMin <= 7 ? 1 : 2;
  const yTicks: number[] = [];
  for (let v = Math.ceil(R.yMin / yStep) * yStep; v <= R.yMax; v += yStep) yTicks.push(v);
  const azStep = [2, 5, 10, 15].find((s) => s * xpx >= 56) ?? 15;
  const azTicks: number[] = [];
  for (let k = Math.ceil((centre - span / 2) / azStep); k * azStep <= centre + span / 2; k++) azTicks.push(k * azStep);

  const rp = Math.max(5, R.r * ypx);
  const off = sun.el - R.r > R.yMax;
  const sx = X(sun.az);
  const sy = Y(sun.el);
  const clip = `rp-clip-${site.id}`;
  const setAz = R.setEv && inView(R.setEv.az_deg) ? R.setEv : null;
  const oEv = r.first_open_sunset_after_landing && inView(r.first_open_sunset_after_landing.az_deg) ? r.first_open_sunset_after_landing : null;

  // ---- scrub strip ----
  const SH = 78;
  const G = narrow ? 52 : 92;
  const SW = W - G - 10;
  const SX = (x: number) => G + ((Math.min(R.b, Math.max(R.a, x)) - R.a) / (R.b - R.a)) * SW;
  const fromX = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    return R.a + Math.min(1, Math.max(0, (clientX - rect.left - G) / SW)) * (R.b - R.a);
  };
  const lane = (ivs: Iv[], y: number, cls: string) =>
    ivs
      .filter(([s, e]) => e > R.a && s < R.b)
      .map(([s, e], i) => <rect key={cls + i} x={SX(s)} y={y} width={Math.max(1, SX(e) - SX(s))} height={12} className={cls} />);
  const days = (R.b - R.a) / DAY;
  const every = [1, 2, 7, 14, 28].find((e) => (e * SW) / days >= 54) ?? 28;
  const dayTicks: number[] = [];
  for (let d = Math.ceil(R.a / DAY) * DAY; d < R.b; d += DAY) if (Math.round(d / DAY) % every === 0) dayTicks.push(d);
  const gapH = R.tSet != null && R.oSet != null ? (R.oSet - R.tSet) / HOUR : null;
  const gx0 = R.tSet != null && R.oSet != null ? SX(Math.min(R.tSet, R.oSet)) : 0;
  const gx1 = R.tSet != null && R.oSet != null ? SX(Math.max(R.tSet, R.oSet)) : 0;
  const gapLabel = gapH != null ? `flat horizon ${fmtSpan(gapH)} ${gapH >= 0 ? "late" : "early"}` : "";
  const gapLeft = gx0 - 6 - gapLabel.length * 6.2 > G;

  const key = (e: React.KeyboardEvent) => {
    let d = 0;
    if (e.key === "ArrowRight") d = e.shiftKey ? 6 * HOUR : 0.5 * HOUR;
    else if (e.key === "ArrowLeft") d = e.shiftKey ? -6 * HOUR : -0.5 * HOUR;
    else if (e.key === "Home") return e.preventDefault(), go(R.a);
    else if (e.key === "End") return e.preventDefault(), go(R.b);
    else if (e.key === " ") return e.preventDefault(), toggle();
    else return;
    e.preventDefault();
    go(t + d);
  };

  const jumps: { label: string; t: number; cls: string }[] = [
    { label: "Landing", t: R.a, cls: "mk-land" },
    ...(R.tSet != null && R.tSet >= R.a && R.tSet <= R.b ? [{ label: "Terrain sunset", t: R.tSet, cls: "mk-sunset" }] : []),
    ...(R.oSet != null && R.oSet >= R.a && R.oSet <= R.b ? [{ label: "Flat-horizon sunset", t: R.oSet, cls: "mk-open" }] : []),
    { label: "Reported end", t: R.end, cls: "mk-end" },
  ].sort((p, q) => p.t - q.t);

  const desc = `Replay at ${fmtDateTime(t)}: ${terrText}. Flat horizon: ${openText}. Lander ${alive ? "operating" : "past its reported end"}.`;

  return (
    <div className="replay">
      <div className="replay-bar">
        <button className="btn btn-primary replay-play" onClick={toggle} aria-pressed={playing}>
          {playing ? "❚❚ Pause" : t >= R.b - 1000 ? "↺ Replay" : "▶ Play"}
        </button>
        <div className="seg" role="group" aria-label="Replay speed">
          {SPEEDS.map((s, i) => (
            <button key={s.label} aria-pressed={speed === i} onClick={() => setSpeed(i)} title={s.title}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="replay-clock" aria-hidden>
          {fmtDate(t)} <b>{fmtTime(t)}</b> UTC
        </span>
      </div>

      <div ref={wrapRef} className="pano-wrap">
        {width > 0 && (
          <svg width={W} height={H} role="img" aria-label={desc} className="replay-svg">
            <defs>
              <clipPath id={clip}>
                <rect x={L} y={T} width={PW} height={PH} />
              </clipPath>
            </defs>
            <rect x={L} y={T} width={PW} height={PH} className={litIv ? "pano-sky" : "pano-sky replay-night"} />
            <Stars x={L} y={T} width={PW} height={PH} />
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={L} x2={W - Rm} y1={Y(v)} y2={Y(v)} className="pano-grid" />
                <text x={L - 6} y={Y(v) + 4} textAnchor="end" className="axis-text">
                  {v > 0 ? "+" : v < 0 ? "−" : ""}
                  {Math.abs(v)}°
                </text>
              </g>
            ))}
            {azTicks.map((a) => (
              <g key={a}>
                <line x1={X(a)} x2={X(a)} y1={T} y2={H - B} className="pano-grid" />
                <text x={X(a)} y={H - B + 16} textAnchor="middle" className="axis-text">
                  {wrap360(a) % 45 === 0 ? `${compass(wrap360(a))} ` : ""}
                  {wrap360(a)}°
                </text>
              </g>
            ))}
            <g clipPath={`url(#${clip})`}>
              <path d={pVis} className="path-sun" />
              {!off && <SunDisc cx={sx} cy={sy} r={rp} />}
              <path d={terrFill} className={litIv ? "terrain-fill" : "terrain-fill terrain-night"} />
              <path d={terrFill} className="terrain-tex" />
              <path d={terr} className="terrain-line mid" />
              <line x1={L} x2={W - Rm} y1={Y(0)} y2={Y(0)} className="open-line" />
              <path d={pHid} className="path-sun hidden" />
              {setAz && (
                <g>
                  <title>{`Terrain sunset ${fmtDateTime(R.tSet!)}`}</title>
                  <circle cx={X(setAz.az_deg)} cy={Y(setAz.horizon_el_deg)} r={4} className="ev-sun ev-set" />
                  {setAz.blocker && Y(setAz.horizon_el_deg) + 18 < H - B - 2 && (
                    <text x={Math.min(W - Rm - 90, Math.max(L + 90, X(setAz.az_deg)))} y={Y(setAz.horizon_el_deg) + 18} textAnchor="middle" className="terrain-label">
                      {setAz.blocker.dist_km < 1 ? "ground slope at the site" : setAz.blocker.phrase} · {fmtKm(setAz.blocker.dist_km)}
                    </text>
                  )}
                </g>
              )}
              {oEv && (
                <g>
                  <title>{`Flat-horizon sunset ${fmtDateTime(R.oSet!)}`}</title>
                  <rect x={X(oEv.az_deg) - 4} y={Y(0) - 4} width={8} height={8} className="ev-open" transform={`rotate(45 ${X(oEv.az_deg)} ${Y(0)})`} />
                </g>
              )}
              {!off && frac <= 0 && <circle cx={sx} cy={sy} r={rp} className="disc-ghost sun" />}
              {!off && litIv && sun.el - horAtSun > R.r && (
                <g>
                  <line x1={sx} x2={sx} y1={sy + rp} y2={Y(horAtSun)} className="clear-line" />
                  <line x1={sx - 4} x2={sx + 4} y1={Y(horAtSun)} y2={Y(horAtSun)} className="clear-line" />
                </g>
              )}
              {off && (
                <text x={sx} y={T + 16} textAnchor="middle" className="disc-tag">
                  ▲ Sun {Math.round(sun.el)}° up, above this close-up
                </text>
              )}
            </g>
            <text x={narrow ? W - Rm - 6 : L + 8} y={Y(0) - 6} textAnchor={narrow ? "end" : "start"} className="open-label halo">
              {narrow ? "0° flat horizon" : "0° flat horizon: what a tool without terrain assumes"}
            </text>
          </svg>
        )}
      </div>

      <div
        className="replay-scrub"
        role="slider"
        tabIndex={0}
        aria-label="Replay time. Arrow keys move 30 minutes, Shift plus arrow 6 hours, Space plays or pauses."
        aria-valuemin={R.a}
        aria-valuemax={R.b}
        aria-valuenow={Math.round(t)}
        aria-valuetext={fmtDateTime(t)}
        onKeyDown={key}
      >
        {width > 0 && (
          <svg
            width={W}
            height={SH}
            className="timeline-svg"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              go(fromX(e.clientX, e.currentTarget));
            }}
            onPointerMove={(e) => dragging.current && go(fromX(e.clientX, e.currentTarget))}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <text x={G - 6} y={31} textAnchor="end" className="axis-text">
              {narrow ? "Terrain" : "With terrain"}
            </text>
            <rect x={G} y={21} width={SW} height={12} className="lane-bg" />
            {lane(R.lit, 21, "lane-fill sun")}
            <text x={G - 6} y={47} textAnchor="end" className="axis-text">
              {narrow ? "Flat 0°" : "Flat 0° horizon"}
            </text>
            <rect x={G} y={37} width={SW} height={12} className="lane-bg" />
            {lane(R.open, 37, "lane-fill open")}
            <rect x={SX(R.landed)} y={18} width={Math.max(2, SX(R.end) - SX(R.landed))} height={34} className="stay-box" />
            {R.tSet != null && R.tSet <= R.b && <line x1={SX(R.tSet)} x2={SX(R.tSet)} y1={17} y2={35} className="mk mk-sunset" />}
            {R.oSet != null && R.oSet <= R.b && <line x1={SX(R.oSet)} x2={SX(R.oSet)} y1={17} y2={51} className="mk mk-open" />}
            <line x1={SX(R.end)} x2={SX(R.end)} y1={16} y2={54} className="mk mk-end" />
            {dayTicks.map((d) => (
              <g key={d}>
                <line x1={SX(d)} x2={SX(d)} y1={52} y2={57} className="tl-grid major" />
                <text x={SX(d)} y={70} textAnchor="middle" className="axis-text">
                  {fmtDate(d, false)}
                </text>
              </g>
            ))}
            <line x1={SX(t)} x2={SX(t)} y1={10} y2={56} className="cursor-line" />
            <path d={`M${SX(t) - 6},4 h12 v6 l-6,6 l-6,-6 z`} className="cursor-handle" />
            {gapH != null && gx1 - gx0 >= 1 && (
              <g>
                <path d={`M${gx0},17v-5H${gx1}v5`} className="gap-bracket" />
                <text x={gapLeft ? gx0 - 6 : gx1 + 6} y={15} textAnchor={gapLeft ? "end" : "start"} className="gap-label halo">
                  {gapLabel}
                </text>
              </g>
            )}
          </svg>
        )}
      </div>

      <div className="replay-jumps" role="group" aria-label="Jump to a moment">
        <span className="ctl-label">Jump to</span>
        {jumps.map((j) => (
          <button key={j.label} className="pick" onClick={() => go(j.t)} title={fmtDateTime(j.t)}>
            <i className={`jump-key ${j.cls}`} aria-hidden /> {j.label}
            <span className="jump-time"> {fmtDate(j.t, false)} {fmtTime(j.t)}</span>
          </button>
        ))}
      </div>

      <div className="replay-state">
        <div className="rs">
          <div className="tile-label">With terrain (this tool)</div>
          <div className="rs-main">
            <span className={`dot ${litIv ? "dot-sun" : "dot-dark"}`} aria-hidden />
            {terrText}
          </div>
          <div className="rs-sub">{terrSub || " "}</div>
        </div>
        <div className="rs">
          <div className="tile-label">Flat 0° horizon (no terrain)</div>
          <div className="rs-main">
            <span className={`dot ${openIv ? "dot-open" : "dot-dark"}`} aria-hidden />
            {openText}
          </div>
          <div className="rs-sub">{openSub || " "}</div>
        </div>
        <div className="rs">
          <div className="tile-label">Lander (public record)</div>
          <div className="rs-main">
            <span className={`dot ${alive ? "dot-both" : "dot-ended"}`} aria-hidden />
            {alive ? "Operating" : "Mission ended"}
          </div>
          <div className="rs-sub">{alive ? `reported end in ${fmtDur(R.end - t)}` : `${fmtDur(t - R.end)} after the reported end`}</div>
        </div>
      </div>
      <p className={`replay-clash ${clash ? "on" : ""}`} role="status" aria-live="off">
        {clash ?? (litIv && openIv ? "Both agree right now: the Sun is up." : "Both agree right now: the Sun is down.")}
      </p>
      <p className="note">
        The view follows the Sun along the horizon measured from LOLA terrain at this site. Vertical scale stretched ×{STRETCH}; the disc is to scale on the elevation axis. Positions come from the engine's {Math.round(R.step / 60000)}-minute replay
        track; the lit and dark bands use its event times, refined to about a second.
        {R.setEv ? ` Last light at ${fmtAz(R.setEv.az_deg)}: Sun centre ${fmtDeg(R.setEv.el_deg)}, terrain ${fmtDeg(R.setEv.horizon_el_deg)}.` : ""}
      </p>
    </div>
  );
}
