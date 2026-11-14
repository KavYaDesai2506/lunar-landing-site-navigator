import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { angDiff, blockerAt, bodyAt, featureLabels, horizonAt, inIntervals, isPolar, nextEvent, posAt, wrap360 } from "../lib/astro";
import type { Ev, Model } from "../lib/astro";
import { DAY, compass, fmtAz, fmtDate, fmtDateTime, fmtDeg, fmtKm, fmtTime } from "../lib/format";
import type { Target } from "../lib/types";
import { EarthDisc, Stars, SunDisc, earthPhase } from "./SpaceArt";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface Props {
  model: Model;
  t: number;
  onJump?: (t: number) => void;
  compact?: boolean;
  /** share one vertical scale across compare panels */
  yRange?: [number, number];
  label?: string;
}

const KIND_WORD: Record<string, Record<string, string>> = {
  sun: { first_light: "Sunrise (first light)", full_disc: "Full Sun clears terrain", partial: "Sun starts to set (partial)", last_light: "Sunset (last light)" },
  earth: { first_light: "Earthrise", full_disc: "Full Earth clears terrain", partial: "Earth starts to set (partial)", last_light: "Earthset" },
};

export function defaultYRange(m: Model, fullSky: boolean): [number, number] {
  let hmin = Infinity;
  let hmax = -Infinity;
  for (const v of m.hor) {
    if (v < hmin) hmin = v;
    if (v > hmax) hmax = v;
  }
  let smax = -Infinity;
  let emax = -Infinity;
  for (let i = 0; i < m.n; i++) {
    if (m.sun.el[i] > smax) smax = m.sun.el[i];
    if (m.earth.el[i] > emax) emax = m.earth.el[i];
  }
  if (fullSky) return [Math.max(Math.min(hmin, 0) - 2, -8), Math.min(90, Math.max(smax, emax, hmax) + 4)];
  const top = Math.max(hmax, smax, emax < 15 ? emax + m.earth.r : -99) + 1;
  return [Math.max(Math.min(hmin, 0) - 0.8, -6), Math.min(top, Math.max(hmax + 3, 12))];
}

export default function Panorama({ model: m, t, onJump, compact, yRange, label }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const polar = isPolar(m.site);
  const narrow = width > 0 && width < 640;
  const [fullSky, setFullSky] = useState(!polar);
  const [terrain, setTerrain] = useState(true);
  const [spanSel, setSpanSel] = useState<number | null>(null);
  const [follow, setFollow] = useState<Target | null>(null);
  const [centreSel, setCentreSel] = useState<number | null>(null);
  const [hoverAz, setHoverAz] = useState<number | null>(null);
  const drag = useRef<{ x: number; c: number; moved: boolean } | null>(null);

  // new site: forget manual framing
  useEffect(() => {
    setFullSky(!isPolar(m.site));
    setCentreSel(null);
    setFollow(null);
    setSpanSel(null);
  }, [m.site]);

  const span = compact ? 360 : spanSel ?? (narrow ? 180 : 360);
  const sunNow = bodyAt(m, "sun", t);
  const earthNow = bodyAt(m, "earth", t);
  const earthEver = m.any.earth.length > 0;

  const autoCentre = useMemo(() => {
    if (!polar) return m.site.requested.lat < 0 ? 0 : 180;
    // polar: put the next sunset (or the Sun) mid-frame once, then hold still
    const e = nextEvent(m, "sun", ["last_light"], m.t0);
    return Math.round(e ? e.az_deg : posAt(m, "sun", m.t0).az);
  }, [m, polar]);
  const effFollow: Target | null = follow ?? (span < 360 && centreSel == null ? "sun" : null);
  const centre = effFollow ? (effFollow === "sun" ? sunNow.az : earthNow.az) : centreSel ?? autoCentre;

  const W = Math.max(width, 280);
  const H = compact ? 170 : narrow ? 300 : Math.round(Math.min(440, Math.max(340, W * 0.36)));
  const L = compact ? 30 : 40;
  const R = 8;
  const T = compact ? 8 : 12;
  const B = compact ? 18 : 26;
  const PW = W - L - R;
  const PH = H - T - B;
  const [yMin, yMax] = yRange ?? defaultYRange(m, fullSky);
  const ypx = PH / (yMax - yMin);
  const xpx = PW / span;
  const X = (az: number) => L + (angDiff(az, centre) + span / 2) * xpx;
  const Y = (el: number) => T + (yMax - el) * ypx;
  const inView = (az: number) => Math.abs(angDiff(az, centre)) <= span / 2;

  // ---- terrain silhouette (static per mast / framing) ----
  const terrainGeo = useMemo(() => {
    const n = m.hor.length;
    const pts: [number, number, number][] = []; // dx, el, dist
    const start = centre - 180;
    for (let k = 0; k <= n; k++) {
      const az = start + (k * 360) / n;
      const i = Math.round((wrap360(az) / 360) * n) % n;
      pts.push([az - centre, horizonAt(m.hor, az), m.blk.dist ? m.blk.dist[i] : 5]);
    }
    const px = (dx: number) => L + (dx + span / 2) * xpx;
    const line = pts.map(([dx, el], k) => `${k ? "L" : "M"}${px(dx).toFixed(1)},${Y(el).toFixed(1)}`).join("");
    const fill = `${line}L${px(180).toFixed(1)},${H - B}L${px(-180).toFixed(1)},${H - B}Z`;
    const cls = (d: number) => (d < 1 ? 0 : d < 20 ? 1 : 2);
    const strokes = ["", "", ""];
    for (let k = 1; k < pts.length; k++) {
      const c = cls(pts[k][2]);
      strokes[c] += `M${px(pts[k - 1][0]).toFixed(1)},${Y(pts[k - 1][1]).toFixed(1)}L${px(pts[k][0]).toFixed(1)},${Y(pts[k][1]).toFixed(1)}`;
    }
    return { fill, strokes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, centre, span, W, H, yMin, yMax]);

  // ---- Sun / Earth paths for the coming lunar day ----
  const tq = Math.floor(t / m.step) * m.step;
  const paths = useMemo(() => {
    const a = Math.max(m.t0, tq - DAY);
    const b = Math.min(m.tEnd, tq + 29.6 * DAY);
    const build = (target: Target) => {
      const times: number[] = [];
      for (let x = a; x <= b; x += m.step) times.push(x);
      for (const e of m.events) if (e.target === target && e.t > a && e.t < b) times.push(e.t);
      times.sort((p, q) => p - q);
      const r = m[target].r;
      let vis = "";
      let hid = "";
      let prev: { x: number; y: number; dx: number } | null = null;
      let prevT = 0;
      for (const tt of times) {
        const p = posAt(m, target, tt);
        const dx = angDiff(p.az, centre);
        const cur = { x: L + (dx + span / 2) * xpx, y: Y(p.el), dx };
        if (prev && Math.abs(dx - prev.dx) < 120) {
          const mid = (tt + prevT) / 2;
          const up = terrain ? !!inIntervals(m.any[target], mid) : posAt(m, target, mid).el + r > 0;
          const seg = `M${prev.x.toFixed(1)},${prev.y.toFixed(1)}L${cur.x.toFixed(1)},${cur.y.toFixed(1)}`;
          if (up) vis += seg;
          else hid += seg;
        }
        prev = cur;
        prevT = tt;
      }
      return { vis, hid };
    };
    const ticks: { x: number; y: number; label: string | null; t: number }[] = [];
    if (!compact) {
      const every = polar ? 3 : 2;
      let k = 0;
      for (let d = Math.ceil((tq + 1) / DAY) * DAY; d < b; d += DAY, k++) {
        const p = posAt(m, "sun", d);
        if (!inView(p.az) || p.el > yMax || p.el < yMin) continue;
        ticks.push({ x: X(p.az), y: Y(p.el), label: k % every === 0 ? fmtDate(d, false) : null, t: d });
      }
    }
    const evs = m.events.filter((e) => e.t >= a && e.t <= b && inView(e.az_deg));
    return { sun: build("sun"), earth: earthEver || !terrain ? build("earth") : null, ticks, evs, a, b };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, tq, centre, span, W, H, yMin, yMax, terrain, compact]);

  const labels = useMemo(() => {
    if (compact) return [];
    const out: { x: number; y: number; text: string }[] = [];
    for (const f of featureLabels(m)) {
      if (!inView(f.az)) continue;
      const x = X(f.az);
      const y = Y(horizonAt(m.hor, f.az)) + 16;
      if (y > H - B - 4 || x < L + 40 || x > W - R - 40) continue;
      if (out.some((o) => Math.abs(o.x - x) < 110 && Math.abs(o.y - y) < 14)) continue;
      out.push({ x, y, text: `${f.name} · ${fmtKm(f.dist)}` });
      if (out.length >= (narrow ? 3 : 7)) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, centre, span, W, H, yMin, yMax, compact]);

  // axis ticks
  const yStep = yMax - yMin <= 6 ? 1 : yMax - yMin <= 16 ? 2 : yMax - yMin <= 40 ? 5 : 15;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);
  const azStep = [15, 30, 45, 90].find((st) => st * xpx >= 58 && (span > 180 ? st >= 45 : span > 90 ? st >= 30 : true)) ?? 90;
  const azTicks: number[] = [];
  for (let a = 0; a < 360; a += azStep) if (inView(a)) azTicks.push(a);

  const disc = (target: Target, st: typeof sunNow) => {
    if (!inView(st.az)) return null;
    const rp = Math.max(target === "sun" ? 5 : 6, st.r * ypx);
    const x = X(st.az);
    const off = st.el > yMax;
    const y = off ? T + 4 : Y(st.el);
    return { x, y, rp, off };
  };
  const sunD = disc("sun", sunNow);
  const earthD = earthEver || !terrain ? disc("earth", earthNow) : null;
  const sunUp = terrain ? sunNow.frac > 0 : sunNow.el + sunNow.r > 0;
  const earthUp = terrain ? earthNow.frac > 0 : earthNow.el + earthNow.r > 0;

  const nextSet = nextEvent(m, "sun", ["last_light"], t);
  const nextRise = nextEvent(m, "sun", ["first_light"], t);
  const labelled = new Set<Ev>();
  if (!compact) {
    const first = [nextSet, nextRise].filter((e): e is Ev => !!e && e.t <= paths.b).sort((p, q) => p.t - q.t);
    first.slice(0, narrow ? 1 : 2).forEach((e) => labelled.add(e));
  }

  const hover = hoverAz != null && !compact ? { az: hoverAz, hor: horizonAt(m.hor, hoverAz), b: blockerAt(m, hoverAz) } : null;
  const exag = ypx / xpx;

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (drag.current && e.buttons) {
      const dx = e.clientX - drag.current.x;
      if (Math.abs(dx) > 4 && !drag.current.moved) {
        drag.current.moved = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (drag.current.moved) {
        setFollow(null);
        setCentreSel(wrap360(drag.current.c - dx / xpx));
        setHoverAz(null);
        return;
      }
    }
    if (x < L || x > W - R) return setHoverAz(null);
    setHoverAz(wrap360(centre + (x - L) / xpx - span / 2));
  };

  const pan = (d: number) => {
    setFollow(null);
    setCentreSel(wrap360(Math.round(centre) + d));
  };

  const desc = `Horizon panorama at ${m.site.name}, mast ${m.mast} m. Sun at azimuth ${fmtAz(sunNow.az)}, ${fmtDeg(sunNow.clearance)} ${sunNow.clearance >= 0 ? "above" : "below"} the terrain horizon, ${sunNow.frac > 0 ? Math.round(sunNow.frac * 100) + "% of the disc visible" : "hidden by terrain"}.`;

  return (
    <div className={`pano ${compact ? "pano-compact" : ""}`}>
      {!compact && (
        <div className="pano-controls" role="group" aria-label="Panorama framing">
          <div className="seg" role="group" aria-label="Terrain">
            <button aria-pressed={terrain} onClick={() => setTerrain(true)} title="Use the measured LOLA terrain horizon">
              With terrain
            </button>
            <button aria-pressed={!terrain} onClick={() => setTerrain(false)} title="Ideal sphere, as tools without terrain assume">
              No terrain (ideal sphere)
            </button>
          </div>
          <div className="seg" role="group" aria-label="Vertical range">
            <button aria-pressed={!fullSky} onClick={() => setFullSky(false)}>
              Horizon close-up
            </button>
            <button aria-pressed={fullSky} onClick={() => setFullSky(true)}>
              Full sky
            </button>
          </div>
          <div className="seg" role="group" aria-label="Field of view">
            {[360, 180, 90].map((s) => (
              <button key={s} aria-pressed={span === s} onClick={() => setSpanSel(s)}>
                {s}°
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Look direction">
            <button onClick={() => pan(-30)} aria-label="Pan left 30 degrees">
              ◀
            </button>
            <button aria-pressed={effFollow === "sun"} onClick={() => setFollow(effFollow === "sun" ? null : "sun")}>
              Follow Sun
            </button>
            {earthEver && (
              <button
                onClick={() => {
                  setFollow(null);
                  setCentreSel(Math.round(earthNow.az));
                }}
              >
                Face Earth
              </button>
            )}
            <button onClick={() => pan(30)} aria-label="Pan right 30 degrees">
              ▶
            </button>
          </div>
        </div>
      )}
      <div ref={wrapRef} className="pano-wrap">
        {width > 0 && (
          <svg
            width={W}
            height={H}
            role="img"
            aria-label={desc}
            className="pano-svg"
            onPointerMove={onPointer}
            onPointerLeave={() => setHoverAz(null)}
            onPointerDown={(e) => {
              if (compact) return;
              drag.current = { x: e.clientX, c: centre, moved: false };
            }}
            onPointerUp={() => (drag.current = null)}
          >
            <defs>
              <clipPath id={`clip-${m.site.id}-${compact ? "c" : "f"}`}>
                <rect x={L} y={T} width={PW} height={PH} />
              </clipPath>
            </defs>
            <rect x={L} y={T} width={PW} height={PH} className={sunUp || !terrain ? "pano-sky" : "pano-sky sky-night"} />
            <Stars x={L} y={T} width={PW} height={PH} />
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v === 0 ? "pano-zero" : "pano-grid"} />
                <text x={L - 6} y={Y(v) + 4} textAnchor="end" className="axis-text">
                  {v > 0 ? "+" : v < 0 ? "−" : ""}
                  {Math.abs(v)}°
                </text>
              </g>
            ))}
            {azTicks.map((a) => (
              <g key={a}>
                <line x1={X(a)} x2={X(a)} y1={T} y2={H - B} className="pano-grid" />
                <text x={X(a)} y={H - B + (compact ? 13 : 16)} textAnchor="middle" className="axis-text">
                  {a % 90 === 0 || span <= 180 ? `${compass(a)} ` : ""}
                  {a}°
                </text>
              </g>
            ))}
            <g clipPath={`url(#clip-${m.site.id}-${compact ? "c" : "f"})`}>
              {/* visible paths and discs sit behind the terrain */}
              {paths.earth && <path d={paths.earth.vis} className="path-earth" />}
              <path d={paths.sun.vis} className="path-sun" />
              {earthD && !earthD.off && <EarthDisc cx={earthD.x} cy={earthD.y} r={earthD.rp} phase={earthPhase(sunNow, earthNow)} />}
              {sunD && !sunD.off && <SunDisc cx={sunD.x} cy={sunD.y} r={sunD.rp} />}

              <path d={terrainGeo.fill} className={terrain ? (sunUp ? "terrain-fill" : "terrain-fill terrain-night") : "terrain-fill terrain-off"} />
              {terrain && <path d={terrainGeo.fill} className="terrain-tex" />}
              {terrain ? (
                <>
                  <path d={terrainGeo.strokes[2]} className="terrain-line far" />
                  <path d={terrainGeo.strokes[1]} className="terrain-line mid" />
                  <path d={terrainGeo.strokes[0]} className="terrain-line local" />
                </>
              ) : (
                <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} className="open-line" />
              )}

              {/* hidden parts of the paths are drawn over the terrain, pale and dashed */}
              {paths.earth && <path d={paths.earth.hid} className="path-earth hidden" />}
              <path d={paths.sun.hid} className="path-sun hidden" />

              {terrain && labels.map((f) => (
                <text key={f.text + f.x} x={f.x} y={f.y} textAnchor="middle" className="terrain-label">
                  {f.text}
                </text>
              ))}

              {paths.ticks.map((k) => (
                <g key={k.t}>
                  <circle cx={k.x} cy={k.y} r={1.8} className="day-tick" />
                  {k.label && (
                    <text x={k.x} y={k.y - 8} textAnchor="middle" className="day-label">
                      {k.label}
                    </text>
                  )}
                </g>
              ))}

              {terrain &&
                paths.evs.map((e) => {
                  const major = e.kind === "first_light" || e.kind === "last_light";
                  if (compact && !major) return null;
                  const x = X(e.az_deg);
                  const y = Y(e.horizon_el_deg);
                  const lab = labelled.has(e);
                  return (
                    <g key={e.utc + e.kind + e.target} className={onJump ? "ev-dot clickable" : "ev-dot"} onClick={() => onJump?.(e.t)}>
                      <title>{`${KIND_WORD[e.target][e.kind]} · ${fmtDateTime(e.t)}${e.blocker ? " · " + e.blocker.phrase + ", " + fmtKm(e.blocker.dist_km) : ""}`}</title>
                      <circle cx={x} cy={y} r={9} fill="transparent" />
                      <circle cx={x} cy={y} r={major ? 4 : 2.5} className={`ev-${e.target} ${e.kind === "last_light" || e.kind === "partial" ? "ev-set" : "ev-rise"}`} />
                      {lab && (
                        <g>
                          <line x1={x} x2={x} y1={y - 6} y2={Math.max(T + 30, y - 46)} className="ev-leader" />
                          <text x={Math.min(W - R - 70, Math.max(L + 70, x))} y={Math.max(T + 24, y - 52)} textAnchor="middle" className="ev-label">
                            {e.kind === "last_light" ? "Sunset" : "Sunrise"} {fmtDate(e.t, false)} {fmtTime(e.t)}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {/* current positions on top: ring when hidden, bracket to the terrain when up */}
              {earthD && !earthD.off && !earthUp && <circle cx={earthD.x} cy={earthD.y} r={earthD.rp} className="disc-ghost earth" />}
              {sunD && !sunD.off && !sunUp && <circle cx={sunD.x} cy={sunD.y} r={sunD.rp} className="disc-ghost sun" />}
              {sunD && !sunD.off && terrain && !compact && sunNow.clearance > 0 && (
                <g>
                  <line x1={sunD.x} x2={sunD.x} y1={sunD.y} y2={Y(sunNow.hor)} className="clear-line" />
                  <line x1={sunD.x - 4} x2={sunD.x + 4} y1={Y(sunNow.hor)} y2={Y(sunNow.hor)} className="clear-line" />
                </g>
              )}
              {sunD && sunD.off && (
                <text x={sunD.x} y={T + 14} textAnchor="middle" className="disc-tag">
                  ▲ Sun {Math.round(sunNow.el)}° up
                </text>
              )}
              {earthD && earthD.off && (
                <text x={earthD.x} y={T + 28} textAnchor="middle" className="disc-tag">
                  ▲ Earth {Math.round(earthNow.el)}° up
                </text>
              )}
              {sunD && !sunD.off && (
                <text x={sunD.x + sunD.rp + 5} y={sunD.y + 4} className="disc-tag">
                  Sun{!compact && terrain ? (!sunUp ? " (behind terrain)" : sunNow.frac < 0.999 ? ` ${Math.max(1, Math.round(sunNow.frac * 100))}% showing` : ` ${fmtDeg(sunNow.clearance)} above terrain`) : ""}
                </text>
              )}
              {earthD && !earthD.off && (
                <text x={earthD.x} y={earthD.y - earthD.rp - 5} textAnchor="middle" className="disc-tag">
                  Earth{!earthUp && terrain ? " (hidden)" : ""}
                </text>
              )}

              {hover && (
                <g pointerEvents="none">
                  <line x1={X(hover.az)} x2={X(hover.az)} y1={T} y2={H - B} className="crosshair" />
                  <circle cx={X(hover.az)} cy={Y(hover.hor)} r={4} className="cross-dot" />
                </g>
              )}
            </g>
            {!terrain && !compact && (
              <text x={L + 8} y={Y(0) - 6} className="open-label">
                {narrow ? "0° open horizon (no terrain)" : "0° open horizon: what a tool without terrain assumes"}
              </text>
            )}
            {label && (
              <text x={L + 8} y={T + 16} className="pano-title">
                {label}
              </text>
            )}
          </svg>
        )}
        {hover && (
          <div className="tip" style={{ left: Math.min(W - 250, Math.max(4, X(hover.az) + 12)), top: 8 }} role="status">
            <div className="tip-h">Looking {fmtAz(hover.az)}</div>
            <div>
              Terrain horizon <b>{fmtDeg(hover.hor)}</b>
            </div>
            {hover.b && (
              <div>
                set by {hover.b.local ? "the ground slope at the site" : "terrain"} <b>{fmtKm(hover.b.dist_km)}</b> away
                {hover.b.phrase && !hover.b.local ? ` (${hover.b.phrase})` : ""}
                {isFinite(hover.b.h_m) ? `, height ${Math.round(hover.b.h_m).toLocaleString("en")} m` : ""}
                {hover.b.approx ? " · from the 2 m mast horizon" : ""}
              </div>
            )}
          </div>
        )}
      </div>
      {!compact && (
        <div className="pano-legend">
          <span>
            <i className="sw sw-line sun" /> Sun path, next lunar day
          </span>
          {paths.earth && (
            <span>
              <i className="sw sw-line earth" /> Earth path
            </span>
          )}
          <span>
            <i className="sw sw-dash" /> hidden behind terrain
          </span>
          <span>
            <i className="sw sw-dot rise" /> rises
          </span>
          <span>
            <i className="sw sw-dot set" /> sets
          </span>
          <span>
            <i className="sw sw-terr local" /> ground slope at site (&lt; 1 km)
          </span>
          <span>
            <i className="sw sw-terr mid" /> ridge within 20 km
          </span>
          <span>
            <i className="sw sw-terr far" /> distant terrain
          </span>
          <span className="muted">
            Vertical scale stretched ×{exag >= 10 ? Math.round(exag) : exag.toFixed(1)}; discs are to scale on the elevation axis. Drag to pan, hover for the blocking terrain.
          </span>
        </div>
      )}
    </div>
  );
}
