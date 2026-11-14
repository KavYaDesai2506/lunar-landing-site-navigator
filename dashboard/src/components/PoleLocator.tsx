// The site on NASA's shaded relief, seen from above: where it stands, which terrain sets its
// horizon in each direction (the engine's own blocking points), and the terrain that ends the light.
import { bodyAt, eventBlocker, nextEvent } from "../lib/astro";
import type { Model } from "../lib/astro";
import { fmtKm } from "../lib/format";
import { RELIEF_CREDIT, RELIEF_KM, proj, reliefUrl } from "../lib/polar";

const S = 480;

/** Can this site be drawn on the south-pole relief at all? */
export function onRelief(lat: number, lon: number): boolean {
  const [x, y] = proj(lat, lon);
  return lat < -60 && Math.max(Math.abs(x), Math.abs(y)) < 330;
}

export default function PoleLocator({ model: m, t }: { model: Model; t: number }) {
  const { lat, lon } = m.site.requested;
  const [sx, sy] = proj(lat, lon);
  const reach = Math.max(Math.abs(sx), Math.abs(sy));
  const sun = bodyAt(m, "sun", t);
  const sunUp = sun.frac > 0;
  const ev = nextEvent(m, "sun", [sunUp ? "last_light" : "first_light"], t);
  const b = ev ? eventBlocker(m, ev) : null;
  let need = reach + 6;
  if (b && isFinite(b.lat) && !b.local) {
    const [bx, by] = proj(b.lat, b.lon);
    need = Math.max(need, Math.abs(bx) + 4, Math.abs(by) + 4);
  }
  const km = RELIEF_KM.find((k) => k * 0.92 >= need) ?? 360;
  const k = S / 2 / km;
  const P = (la: number, lo: number): [number, number] => {
    const [x, y] = proj(la, lo);
    return [S / 2 + x * k, S / 2 - y * k];
  };
  const [px, py] = P(lat, lon);
  // local north points away from the pole, east toward growing longitude; the projection keeps angles
  const l = (lon * Math.PI) / 180;
  const dir = (az: number): [number, number] => {
    const a = (az * Math.PI) / 180;
    return [Math.sin(l) * Math.cos(a) + Math.cos(l) * Math.sin(a), -(Math.cos(l) * Math.cos(a) - Math.sin(l) * Math.sin(a))];
  };
  const ray = (az: number, len: number) => {
    const [dx, dy] = dir(az);
    return { x1: px + dx * 9, y1: py + dy * 9, x2: px + dx * len, y2: py + dy * len };
  };
  const dots: [number, number][] = [];
  const bl = m.blk.lat;
  const bo = m.blk.lon;
  if (bl && bo) {
    for (let i = 0; i < bl.length; i += 4) {
      if (!isFinite(bl[i]) || !isFinite(bo[i])) continue;
      const [x, y] = P(bl[i], bo[i]);
      if (x > 2 && x < S - 2 && y > 2 && y < S - 2) dots.push([x, y]);
    }
  }
  const blockXY = b && isFinite(b.lat) && !b.local ? P(b.lat, b.lon) : null;
  const earth = bodyAt(m, "earth", t);
  const earthEver = m.any.earth.length > 0;
  const sr = ray(sun.az, 74);
  const er = ray(earth.az, 60);
  const labelLeft = blockXY ? blockXY[0] > S * 0.6 : false;
  return (
    <figure className="locator">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${m.site.name} on a shaded-relief map of the lunar south pole, ${km * 2} km across, with the terrain that sets its horizon.`}>
        <image href={reliefUrl(km, true)} width={S} height={S} className="relief" preserveAspectRatio="none" />
        <rect width={S} height={S} className="relief-tint" />
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={2.1} className="loc-dot" />
        ))}
        <line {...sr} className={`loc-ray sun${sunUp ? "" : " hidden"}`} />
        <circle cx={sr.x2} cy={sr.y2} r={7} className={sunUp ? "disc-sun" : "disc-ghost sun"} />
        {earthEver && (
          <>
            <line {...er} className={`loc-ray earth${earth.frac > 0 ? "" : " hidden"}`} />
            <circle cx={er.x2} cy={er.y2} r={6} className={earth.frac > 0 ? "disc-earth" : "disc-ghost earth"} />
          </>
        )}
        {blockXY && (
          <g>
            <line x1={px} y1={py} x2={blockXY[0]} y2={blockXY[1]} className="loc-link" />
            <circle cx={blockXY[0]} cy={blockXY[1]} r={6.5} className="loc-block" />
            <text x={blockXY[0] + (labelLeft ? -11 : 11)} y={blockXY[1] + 4} textAnchor={labelLeft ? "end" : "start"} className="loc-label">
              {b!.feature ?? "ridge"} · {fmtKm(b!.dist_km)}
            </text>
          </g>
        )}
        <circle cx={px} cy={py} r={6} className="loc-site" />
        <text x={8} y={S - 10} className="loc-scale">
          {km * 2} km across · 0° E (toward Earth) is up
        </text>
      </svg>
      <figcaption>
        <span>
          <i className="sw loc-key site" /> site
        </span>
        <span>
          <i className="sw loc-key block" /> terrain that {sunUp ? "ends" : "returns"} the light next
        </span>
        <span>
          <i className="sw loc-key dot" /> terrain setting the horizon
        </span>
        <span className="muted">{RELIEF_CREDIT}</span>
      </figcaption>
    </figure>
  );
}
