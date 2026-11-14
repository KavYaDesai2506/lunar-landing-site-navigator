// The selling point on the first screen: a small looping replay of a real landing losing the Sun
// behind named terrain, with what a flat-horizon tool would have said. It links to the full replay
// on the Missions page. Positions and event times come from the same decoded replay the full
// player uses (buildReplay / sunAt); only the framing here is its own.
import { useEffect, useMemo, useRef, useState } from "react";
import { angDiff, discFrac, horizonAt, inIntervals } from "../lib/astro";
import { loadSite, useAsync } from "../lib/data";
import { HOUR, fmtDate, fmtDur, fmtKm, fmtSpan, fmtTime } from "../lib/format";
import { verdict } from "./Mission";
import { linkFor, setState } from "../lib/state";
import { buildReplay, sunAt } from "./MissionReplayPlayer";
import { useWidth } from "./Panorama";
import { Stars, SunDisc } from "./SpaceArt";

const RATE = 1.6 * HOUR; // mission time per second
const HOLD = 1400; // ms to rest on the last frame before looping

export default function MiniReplay({ id = "chandrayaan3", short = "Chandrayaan-3" }: { id?: string; short?: string }) {
  const siteA = useAsync(() => loadSite(id), `site:${id}`);
  const site = siteA.data;
  const R = useMemo(() => (site?.mission_replay ? buildReplay(site, site.mission_replay) : null), [site]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const box = useRef<HTMLElement>(null);

  // the loop: the approach to the terrain sunset, then on to the sunset a flat horizon would give
  const span = useMemo(() => {
    if (!R || R.tSet == null) return null;
    const first = Math.min(R.tSet, R.oSet ?? R.tSet);
    const last = Math.max(R.tSet, R.oSet ?? R.tSet);
    const a = Math.max(R.a, first - 5 * HOUR);
    const b = Math.min(R.b, Math.min(last + 1.5 * HOUR, first + 30 * HOUR));
    return b > a ? ([a, b] as const) : null;
  }, [R]);

  const calm = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [playing, setPlaying] = useState(!calm);
  const [seen, setSeen] = useState(true);
  const [t, setT] = useState(0);
  const tRef = useRef(0);

  useEffect(() => {
    if (!span || !R) return;
    // at rest (reduced motion): the moment the terrain has just taken the Sun
    const start = calm ? Math.min(span[1], (R.tSet ?? span[0]) + 0.5 * HOUR) : span[0];
    tRef.current = start;
    setT(start);
  }, [span, R, calm]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [site]);

  useEffect(() => {
    if (!playing || !seen || !span) return;
    let raf = 0;
    let last = performance.now();
    let held = 0;
    const tick = (now: number) => {
      const dt = Math.min(120, now - last);
      last = now;
      if (tRef.current >= span[1]) {
        held += dt;
        if (held >= HOLD) {
          held = 0;
          tRef.current = span[0];
          setT(span[0]);
        }
      } else {
        tRef.current = Math.min(span[1], tRef.current + (dt / 1000) * RATE);
        setT(tRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, seen, span]);

  if (siteA.error) return null;
  const full = linkFor({ view: "missions", open: id, hl: `mission-${id}` });
  const openFull = (e: React.MouseEvent) => {
    e.preventDefault();
    setState({ view: "missions", open: id, hl: `mission-${id}` });
  };

  if (!site || !R || !span || !t) {
    return (
      <section className="mini" ref={box} aria-label={`Mission replay: ${short}`}>
        <div className="mini-head">
          <span className="mini-title">Watch the light end: {short}</span>
        </div>
        <div className="mini-stage loading" ref={ref} />
      </section>
    );
  }

  const r = site.mission_replay!;
  const sun = sunAt(R, t);
  const horAtSun = horizonAt(R.hor, sun.az);
  const lit = !!inIntervals(R.lit, t);
  const openIv = inIntervals(R.open, t);
  const gapH = R.oSet != null && R.tSet != null ? (R.oSet - R.tSet) / HOUR : null;
  const clash = !lit && !!openIv;
  const pct = Math.max(1, Math.round(discFrac(sun.el, horAtSun, R.r) * 100));
  const v = verdict(r);

  // ---- frame: follow the Sun, same close-up idea as the full player, smaller ----
  const W = Math.max(width, 240);
  const H = Math.round(Math.min(190, Math.max(132, W * 0.42)));
  const yMax = Math.min(R.yMax, 4.2);
  const yMin = Math.max(R.yMin, -1);
  const ypx = H / (yMax - yMin);
  const view = Math.min(60, Math.max(14, W / (ypx / 2.5)));
  const xpx = W / view;
  const X = (az: number) => (angDiff(az, sun.az) + view / 2) * xpx;
  const Y = (el: number) => (yMax - el) * ypx;
  let terr = "";
  for (let d = -view / 2 - 1; d <= view / 2 + 1; d += 0.25) terr += `${terr ? "L" : "M"}${((d + view / 2) * xpx).toFixed(1)},${Y(horizonAt(R.hor, sun.az + d)).toFixed(1)}`;
  const terrFill = `${terr}L${W + xpx},${H}L${-xpx},${H}Z`;
  const rp = Math.max(5, R.r * ypx);
  const setEv = R.setEv && Math.abs(angDiff(R.setEv.az_deg, sun.az)) < view / 2 ? R.setEv : null;
  const ridge = R.setEv?.blocker ? (R.setEv.blocker.dist_km < 1 ? "ground slope at the site" : R.setEv.blocker.phrase) : null;
  const P = (x: number) => ((x - span[0]) / (span[1] - span[0])) * 100;

  return (
    <section className="mini" ref={box} aria-label={`Mission replay: ${short}`}>
      <div className="mini-head">
        <a className="mini-title" href={full} onClick={openFull} title="Open the full replay on the Missions page">
          Watch the light end: {short}
        </a>
        <button className="mini-btn" onClick={() => setPlaying(!playing)} aria-pressed={playing} aria-label={playing ? "Pause the replay" : "Play the replay"} title={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
      </div>
      <div className="mini-stage" ref={ref} onClick={openFull} title="Open the full replay on the Missions page" aria-hidden>
        {width > 0 && (
          <svg width={W} height={H} className="replay-svg">
            <rect width={W} height={H} className={lit ? "pano-sky" : "pano-sky replay-night"} />
            <Stars x={0} y={0} width={W} height={H} />
            {sun.el - R.r < yMax && <SunDisc cx={X(sun.az)} cy={Y(sun.el)} r={rp} />}
            <path d={terrFill} className={lit ? "terrain-fill" : "terrain-fill terrain-night"} />
            <path d={terrFill} className="terrain-tex" />
            <path d={terr} className="terrain-line mid" />
            <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} className="open-line" />
            <text x={W - 6} y={Y(0) - 5} textAnchor="end" className="open-label halo">
              0° flat horizon
            </text>
            {!lit && sun.el - R.r < yMax && <circle cx={X(sun.az)} cy={Y(sun.el)} r={rp} className="disc-ghost sun" />}
            {setEv && (
              <>
                <circle cx={X(setEv.az_deg)} cy={Y(setEv.horizon_el_deg)} r={3.5} className="ev-sun ev-set" />
                {ridge && Y(setEv.horizon_el_deg) + 17 < H - 3 && (
                  <text x={Math.min(W - 84, Math.max(84, X(setEv.az_deg)))} y={Y(setEv.horizon_el_deg) + 17} textAnchor="middle" className="terrain-label">
                    {ridge} · {fmtKm(setEv.blocker!.dist_km)}
                  </text>
                )}
              </>
            )}
            <text x={8} y={17} className="mini-clock">
              {fmtDate(t)} {fmtTime(t)} UTC
            </text>
          </svg>
        )}
      </div>
      <div className="mini-track" aria-hidden>
        <i className="mini-fill" style={{ width: `${P(t).toFixed(2)}%` }} />
        {R.tSet != null && <i className="mini-mk sun" style={{ left: `${P(R.tSet)}%` }} title="Terrain sunset" />}
        {R.oSet != null && R.oSet <= span[1] && <i className="mini-mk open" style={{ left: `${P(R.oSet)}%` }} title="Flat-horizon sunset" />}
      </div>
      <div className="mini-state">
        <span className={lit ? "on" : ""}>
          <i className={`dot ${lit ? "dot-sun" : "dot-dark"}`} aria-hidden />
          <b>Terrain</b> {lit ? (pct >= 100 ? "full Sun" : `${pct}% showing`) : "Sun gone"}
        </span>
        <span className={clash ? "clash" : ""}>
          <i className={`dot ${openIv ? "dot-open" : "dot-dark"}`} aria-hidden />
          <b>Flat-horizon tool</b> {openIv ? (clash ? `still day, ${fmtDur(openIv[1] - t)} more` : "Sun up") : "Sun down"}
        </span>
      </div>
      <p className="mini-foot">
        <span className={`tag tag-${v.tone}`}>
          {v.tone === "match" ? "✓ " : v.tone === "honest" ? "◆ " : "○ "}
          {v.tag}
        </span>
        {gapH != null && Math.abs(gapH) >= 0.1 && <span className="mini-gap">flat horizon {fmtSpan(Math.abs(gapH))} {gapH > 0 ? "late" : "early"}</span>}
        <a href={full} onClick={openFull}>
          Full replay →
        </a>
      </p>
    </section>
  );
}
