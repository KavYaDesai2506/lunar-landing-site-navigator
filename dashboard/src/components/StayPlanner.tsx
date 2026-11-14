import { useMemo, useState } from "react";
import { slipCurve, stayStats } from "../lib/astro";
import type { Model, StayStats } from "../lib/astro";
import { DAY, fmtDate, fmtDateTime, fmtSpan } from "../lib/format";
import { useWidth } from "./Panorama";

export const STAYS = [
  { d: 1, label: "1 day" },
  { d: 6, label: "6 days", hint: "Artemis III surface stay is about 6 days" },
  { d: 14, label: "14 days", hint: "one lunar daytime at mid-latitudes" },
  { d: 29.5, label: "29.5 days", hint: "one full lunar day" },
];
export const SLIPS = [
  { d: 0, label: "On time" },
  { d: 7, label: "+1 week" },
  { d: 14, label: "+2 weeks" },
  { d: 30, label: "+1 month" },
  { d: 365, label: "+1 year" },
];

interface Props {
  model: Model;
  t: number;
  stay: number;
  slip: number;
  onStay: (d: number) => void;
  onSlip: (d: number) => void;
  onJump: (t: number) => void;
}

export default function StayPlanner({ model: m, t, stay, slip, onStay, onSlip, onJump }: Props) {
  const stayMs = stay * DAY;
  const base = stayStats(m, t, stayMs);
  const slipT = t + slip * DAY;
  const slipOut = slip > 0 && slipT + stayMs > m.tEnd;
  const slipped = slip > 0 && !slipOut ? stayStats(m, slipT, stayMs) : null;
  const curve = useMemo(() => slipCurve(m, stayMs), [m, stayMs]);

  // best start in the 60 days after the cursor
  const best = useMemo(() => {
    let bi = -1;
    for (let i = 0; i < curve.t.length; i++) {
      if (curve.t[i] < t || curve.t[i] > t + 60 * DAY) continue;
      if (bi < 0 || curve.sun[i] > curve.sun[bi] + 1e-9) bi = i;
    }
    return bi < 0 ? null : { t: curve.t[bi], v: curve.sun[bi] };
  }, [curve, Math.floor(t / DAY)]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = (v: number, st: StayStats) => (st.hours > 0 ? v / st.hours : 0);
  const rows: { label: string; cls: string; get: (s: StayStats) => number; fmt: (v: number) => string; frac: (v: number, s: StayStats) => number | null; better: 1 | -1 }[] = [
    { label: "Sunlight (any part of the Sun)", cls: "sun", get: (s) => s.sunH, fmt: fmtSpan, frac: share, better: 1 },
    { label: "Full Sun disc", cls: "sun", get: (s) => s.sunFullH, fmt: fmtSpan, frac: share, better: 1 },
    { label: "Earth in view (any part)", cls: "earth", get: (s) => s.earthH, fmt: fmtSpan, frac: share, better: 1 },
    { label: "Sun and Earth together", cls: "both", get: (s) => s.bothH, fmt: fmtSpan, frac: share, better: 1 },
    { label: "Longest darkness", cls: "dark", get: (s) => s.longestDarkH, fmt: (v) => (v < 1 / 60 ? "none" : fmtSpan(v)), frac: () => null, better: -1 },
  ];
  const slipLabel = SLIPS.find((x) => x.d === slip)?.label ?? `+${slip} d`;

  return (
    <section className="card" aria-labelledby="plan-h">
      <div className="plan-head">
        <h2 id="plan-h">
          {stay}-day stay from {fmtDateTime(t, false)}
        </h2>
        <div className="row-controls">
          <label className="ctl-label">Stay</label>
          <div className="seg" role="group" aria-label="Stay length">
            {STAYS.map((s) => (
              <button key={s.d} aria-pressed={stay === s.d} onClick={() => onStay(s.d)} title={s.hint}>
                {s.label}
              </button>
            ))}
          </div>
          <label className="ctl-label">Launch slips</label>
          <div className="seg" role="group" aria-label="Schedule slip">
            {SLIPS.map((s) => (
              <button key={s.d} aria-pressed={slip === s.d} onClick={() => onSlip(s.d)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ul className="stay-tiles" aria-label={`During the ${stay}-day stay, landing ${fmtDate(base.a, false)}${slip > 0 ? `, and slipped ${slipLabel}` : ""}`}>
        {rows.map((r) => {
          const v0 = r.get(base);
          const f0 = r.frac(v0, base);
          const v1 = slipped ? r.get(slipped) : null;
          const d = v1 != null ? v1 - v0 : 0;
          const good = d * r.better > 0;
          return (
            <li key={r.label} className={`stay-tile ${r.cls}`}>
              <div className="tile-label">{r.label}</div>
              <div className="stay-value">
                {r.fmt(v0)}
                {f0 != null && <span className="stay-pct">{Math.round(f0 * 100)}%</span>}
              </div>
              {f0 != null && (
                <div className="stay-bar" aria-hidden>
                  <i style={{ width: `${Math.round(f0 * 100)}%` }} />
                </div>
              )}
              {slip > 0 && (
                <div className="stay-slip">
                  <span className="muted">{slipLabel}:</span>{" "}
                  {slipped && v1 != null ? (
                    <>
                      <b>{r.fmt(v1)}</b>{" "}
                      {Math.abs(d) < 0.05 ? <span className="muted">no change</span> : <span className={good ? "delta good" : "delta bad"}>{good ? "▲" : "▼"} {fmtSpan(Math.abs(d))}</span>}
                    </>
                  ) : (
                    "beyond the data"
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {base.clipped && <p className="note">The stay runs past the end of the precomputed window ({fmtDate(m.tEnd)}); numbers cover the part inside it.</p>}
      {slipOut && <p className="note">A slip of {slip} days from this date lands outside the precomputed window (ends {fmtDate(m.tEnd)}). Pick an earlier landing date to compare a one-year slip.</p>}

      <h3>Every landing date: click one to land then</h3>
      <div data-hl="window">
        <SlipChart model={m} t={t} slipT={slipped ? slipT : null} stay={stay} curve={curve} onJump={onJump} />
      </div>
      {best && best.t - t > DAY && best.v - curve.sun[Math.max(0, curve.t.findIndex((x) => x >= t))] > 2 && (
        <p className="note">
          Best start in the next 60 days: <button className="linkish" onClick={() => onJump(best.t)}>{fmtDateTime(best.t, false)}</button> ({best.v.toFixed(0)}% average illumination over the stay).
        </p>
      )}
    </section>
  );
}

function SlipChart({ model: m, t, slipT, stay, curve, onJump }: { model: Model; t: number; slipT: number | null; stay: number; curve: ReturnType<typeof slipCurve>; onJump: (t: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(width, 260);
  const H = 190;
  const L = 40;
  const R = 12;
  const T = 12;
  const B = 24;
  const a = m.t0;
  const b = m.tEnd;
  const X = (tt: number) => L + ((tt - a) / (b - a)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const hasEarth = m.any.earth.length > 0;
  const d = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${X(curve.t[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const at = (tt: number) => {
    const i = Math.min(curve.t.length - 1, Math.max(0, Math.round((tt - curve.t[0]) / (curve.t[1] - curve.t[0]))));
    return { i, t: curve.t[i], sun: curve.sun[i], both: curve.both[i] };
  };
  const months: number[] = [];
  for (let d0 = new Date(a), y = d0.getUTCFullYear(), mo = d0.getUTCMonth(); Date.UTC(y, mo, 1) <= b; mo++) if (Date.UTC(y, mo, 1) >= a) months.push(Date.UTC(y, mo, 1));
  const cur = curve.t.length ? at(t) : null;
  const ghost = slipT != null && curve.t.length ? at(slipT) : null;
  const hv = hover != null && curve.t.length ? at(hover) : null;
  const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fromX = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return a + Math.min(1, Math.max(0, (e.clientX - r.left - L) / (W - L - R))) * (b - a);
  };
  return (
    <div ref={ref} className="chart-wrap">
      {width > 0 && (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`Average illumination over a ${stay}-day stay for every landing date in the planning window. Click to move the landing date.`}
          onPointerMove={(e) => setHover(fromX(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onJump(fromX(e as unknown as React.PointerEvent<SVGSVGElement>))}
          className="clickable"
        >
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="pano-grid" />
              <text x={L - 6} y={Y(v) + 4} textAnchor="end" className="axis-text">
                {v}%
              </text>
            </g>
          ))}
          {months.map((mt, i) => (
            <text key={mt} x={X(mt) + 2} y={H - 7} className="axis-text" display={X(mt) > W - R - 26 ? "none" : undefined}>
              {W < 560 && i % 2 ? "" : MN[new Date(mt).getUTCMonth()]}
              {new Date(mt).getUTCMonth() === 0 ? ` ${new Date(mt).getUTCFullYear()}` : ""}
            </text>
          ))}
          {hasEarth && <path d={d(curve.both)} className="line-both" />}
          <path d={d(curve.sun)} className="line-sun" />
          {ghost && (
            <g>
              <line x1={X(ghost.t)} x2={X(ghost.t)} y1={T} y2={H - B} className="cursor-line ghost" />
              <circle cx={X(ghost.t)} cy={Y(ghost.sun)} r={5} className="mark-ghost" />
            </g>
          )}
          {cur && (
            <g>
              <line x1={X(cur.t)} x2={X(cur.t)} y1={T} y2={H - B} className="cursor-line" />
              <circle cx={X(cur.t)} cy={Y(cur.sun)} r={5} className="mark-sun" />
            </g>
          )}
          {hv && (
            <g pointerEvents="none">
              <line x1={X(hv.t)} x2={X(hv.t)} y1={T} y2={H - B} className="crosshair" />
              <circle cx={X(hv.t)} cy={Y(hv.sun)} r={4} className="cross-dot" />
            </g>
          )}
        </svg>
      )}
      {hv && (
        <div className="tip" style={{ left: Math.min(W - 230, Math.max(4, X(hv.t) + 12)), top: 4 }}>
          <div className="tip-h">Land {fmtDateTime(hv.t, false)}</div>
          <div>
            <i className="sw sw-line sun" /> Average illumination <b>{hv.sun.toFixed(0)}%</b>
          </div>
          {hasEarth && (
            <div>
              <i className="sw sw-line both" /> Sun and Earth together <b>{hv.both.toFixed(0)}%</b>
            </div>
          )}
        </div>
      )}
      <div className="pano-legend">
        <span>
          <i className="sw sw-line sun" /> average illumination during the stay
        </span>
        {hasEarth && (
          <span>
            <i className="sw sw-line both" /> share of the stay with Sun and Earth both in view
          </span>
        )}
        <span className="muted">Click the chart to land on that date.</span>
      </div>
    </div>
  );
}
