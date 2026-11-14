import { useRef } from "react";
import type { Iv } from "../lib/astro";
import { DAY, HOUR, LUNAR_DAY, fmtDate, fmtDateTime } from "../lib/format";
import { useWidth } from "./Panorama";

export interface Lane {
  label: string;
  cls: "sun" | "earth" | "both" | "open";
  any: Iv[];
  full?: Iv[];
}

export interface LaneGroup {
  title?: string;
  lanes: Lane[];
}

interface Props {
  groups: LaneGroup[];
  range: [number, number];
  limits: [number, number];
  t: number;
  onT: (t: number) => void;
  stayMs?: number;
  slipMs?: number;
  marks?: { t: number; label: string }[];
  label?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ticks(a: number, b: number, pw: number): { t: number; label: string | null; major: boolean }[] {
  const days = (b - a) / DAY;
  const out: { t: number; label: string | null; major: boolean }[] = [];
  const d0 = new Date(a);
  const pxPerDay = pw / days;
  if (days > 150) {
    const skip = pxPerDay * 30 < 44 ? 2 : 1;
    for (let y = d0.getUTCFullYear(), mo = d0.getUTCMonth(); ; mo++) {
      const tt = Date.UTC(y, mo, 1);
      if (tt > b) break;
      if (tt >= a) {
        const d = new Date(tt);
        out.push({ t: tt, label: out.length % skip ? null : d.getUTCMonth() === 0 || out.length === 0 ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : MONTHS[d.getUTCMonth()], major: true });
      }
    }
    return out;
  }
  const every = [1, 2, 7, 14, 28].find((e) => e * pxPerDay >= 50) ?? 28;
  for (let tt = Math.ceil(a / DAY) * DAY, k = 0; tt <= b; tt += DAY, k++) {
    const d = new Date(tt);
    const first = d.getUTCDate() === 1;
    const lab = Math.round(tt / DAY) % every === 0;
    out.push({ t: tt, label: lab ? fmtDate(tt, false) : null, major: first || lab });
  }
  return out;
}

export default function Timeline({ groups, range, limits, t, onT, stayMs, slipMs, marks, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const dragging = useRef(false);
  const [a, b] = range;
  const W = Math.max(width, 260);
  const G = W < 560 ? 52 : 96;
  const R = 10;
  const PW = W - G - R;
  const laneH = 13;
  const laneGap = 3;
  const groupGap = groups.some((g) => g.title) ? 20 : 8;
  const top = groups.some((g) => g.title) ? 48 : 34;
  let y = top;
  const rows: { y: number; lane: Lane }[] = [];
  const titles: { y: number; title: string }[] = [];
  groups.forEach((g, gi) => {
    if (gi) y += groupGap;
    if (g.title) titles.push({ y: y - 5, title: g.title });
    for (const lane of g.lanes) {
      rows.push({ y, lane });
      y += laneH + laneGap;
    }
  });
  const bottom = y;
  const H = bottom + 14;
  const X = (tt: number) => G + ((tt - a) / (b - a)) * PW;
  const clampX = (x: number) => Math.min(G + PW, Math.max(G, x));
  const fromX = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left - G) / PW));
    return a + f * (b - a);
  };

  const rects = (ivs: Iv[], yy: number, cls: string) =>
    ivs
      .filter(([s, e]) => e > a && s < b)
      .map(([s, e], i) => {
        const x0 = clampX(X(s));
        const x1 = clampX(X(e));
        return <rect key={cls + i} x={x0} y={yy} width={Math.max(0.8, x1 - x0)} height={laneH} className={cls} />;
      });

  const inRange = t >= a && t <= b;
  const tk = ticks(a, b, PW);
  const stayA = t;
  const stayB = stayMs ? t + stayMs : t;

  const key = (e: React.KeyboardEvent) => {
    let d = 0;
    if (e.key === "ArrowRight") d = e.shiftKey ? DAY : HOUR;
    else if (e.key === "ArrowLeft") d = e.shiftKey ? -DAY : -HOUR;
    else if (e.key === "PageUp") d = LUNAR_DAY;
    else if (e.key === "PageDown") d = -LUNAR_DAY;
    else if (e.key === "Home") return e.preventDefault(), onT(limits[0]);
    else if (e.key === "End") return e.preventDefault(), onT(limits[1]);
    else return;
    e.preventDefault();
    onT(Math.min(limits[1], Math.max(limits[0], t + d)));
  };

  return (
    <div
      ref={ref}
      className="timeline"
      role="slider"
      tabIndex={0}
      aria-label={label ?? "Time cursor. Arrow keys move one hour, Shift plus arrow one day, Page Up and Page Down one lunar day."}
      aria-valuemin={limits[0]}
      aria-valuemax={limits[1]}
      aria-valuenow={t}
      aria-valuetext={fmtDateTime(t)}
      onKeyDown={key}
    >
      {width > 0 && (
        <svg
          width={W}
          height={H}
          className="timeline-svg"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            onT(fromX(e.clientX, e.currentTarget));
          }}
          onPointerMove={(e) => dragging.current && onT(fromX(e.clientX, e.currentTarget))}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <defs>
            <pattern id="hatch-sun" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="hatch-bg sun" />
              <line x1="0" y1="0" x2="0" y2="5" className="hatch-ln sun" />
            </pattern>
            <pattern id="hatch-earth" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <rect width="5" height="5" className="hatch-bg earth" />
              <line x1="0" y1="0" x2="0" y2="5" className="hatch-ln earth" />
            </pattern>
          </defs>
          {tk.map((k) => (
            <g key={k.t}>
              <line x1={X(k.t)} x2={X(k.t)} y1={28} y2={bottom} className={k.major ? "tl-grid major" : "tl-grid"} />
              {k.label && (
                <text x={X(k.t) + 3} y={24} className="axis-text">
                  {k.label}
                </text>
              )}
            </g>
          ))}
          {titles.map((tt) => (
            <text key={tt.title + tt.y} x={G} y={tt.y} className="tl-title">
              {tt.title}
            </text>
          ))}
          {rows.map(({ y: yy, lane }, i) => (
            <g key={i}>
              <text x={G - 6} y={yy + laneH - 3} textAnchor="end" className="axis-text">
                {lane.label}
              </text>
              <rect x={G} y={yy} width={PW} height={laneH} className="lane-bg" />
              {lane.full ? rects(lane.any, yy, `lane-part ${lane.cls}`) : null}
              {rects(lane.full ?? lane.any, yy, `lane-fill ${lane.cls}`)}
            </g>
          ))}
          {stayMs != null && stayMs > 0 && stayB > a && stayA < b && (
            <rect x={clampX(X(stayA))} y={top - 3} width={Math.max(1, clampX(X(stayB)) - clampX(X(stayA)))} height={bottom - top + 5} className="stay-box" />
          )}
          {slipMs != null && slipMs > 0 && t + slipMs < b && t + slipMs + (stayMs ?? 0) > a && (
            <g>
              <rect
                x={clampX(X(t + slipMs))}
                y={top - 3}
                width={Math.max(1, clampX(X(t + slipMs + (stayMs ?? 0))) - clampX(X(t + slipMs)))}
                height={bottom - top + 5}
                className="stay-box ghost"
              />
              <text x={clampX(X(t + slipMs)) + 3} y={bottom + 7} className="tl-ghost-label">
                slipped
              </text>
            </g>
          )}
          {marks?.filter((mk) => mk.t >= a && mk.t <= b).map((mk) => (
            <g key={mk.label + mk.t}>
              <line x1={X(mk.t)} x2={X(mk.t)} y1={top - 6} y2={bottom} className="tl-mark" />
              <text x={X(mk.t) + 3} y={bottom + 7} className="tl-ghost-label">
                {mk.label}
              </text>
            </g>
          ))}
          {inRange && (
            <g>
              <line x1={X(t)} x2={X(t)} y1={14} y2={bottom + 2} className="cursor-line" />
              <path d={`M${X(t) - 6},8 h12 v6 l-6,6 l-6,-6 z`} className="cursor-handle" />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

export function LaneLegend({ earth = true, open = false }: { earth?: boolean; open?: boolean }) {
  return (
    <div className="pano-legend">
      <span>
        <i className="sw sw-box sun" /> full Sun
      </span>
      <span>
        <i className="sw sw-box sun part" /> partial Sun
      </span>
      {earth && (
        <>
          <span>
            <i className="sw sw-box earth" /> full Earth
          </span>
          <span>
            <i className="sw sw-box earth part" /> partial Earth
          </span>
          <span>
            <i className="sw sw-box both" /> Sun and Earth both (any part)
          </span>
        </>
      )}
      <span>
        <i className="sw sw-box dark" /> hidden by terrain
      </span>
      {open && (
        <span>
          <i className="sw sw-box open" /> "Flat 0°" lane: Sun above a flat horizon, what a tool without terrain shows
        </span>
      )}
    </div>
  );
}
