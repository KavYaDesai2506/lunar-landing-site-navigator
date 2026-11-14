// Space styling drawn in code: stars, a glowing Sun, a shaded Earth with its real phase, regolith
// shading for the terrain silhouette. Nothing here is an image and nothing here changes geometry:
// the panorama and the replays keep their own maths and only fill their shapes with these paints.
import { useId } from "react";

/** Small deterministic generator, so the starfield and the regolith speckle are the same on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_W = 420;
const STAR_H = 280;
const STARS = (() => {
  const r = rng(20261114);
  return Array.from({ length: 74 }, () => {
    const big = r() > 0.9;
    return { x: r() * STAR_W, y: r() * STAR_H, r: big ? 0.9 + r() * 0.5 : 0.35 + r() * 0.45, o: big ? 0.75 + r() * 0.25 : 0.25 + r() * 0.5, tint: r() };
  });
})();

const REG = 96;
const GRAINS = (() => {
  const r = rng(1737);
  return Array.from({ length: 46 }, () => ({ x: r() * REG, y: r() * REG, r: 0.5 + r() * 1.1, light: r() > 0.5, o: 0.1 + r() * 0.16 }));
})();
const PITS = (() => {
  const r = rng(69);
  return Array.from({ length: 4 }, () => ({ x: 10 + r() * (REG - 20), y: 10 + r() * (REG - 20), r: 2.4 + r() * 3 }));
})();

/** Shared paints, mounted once by the app. Colours come from the theme variables. */
export function SpaceDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
      <defs>
        <pattern id="p-stars" width={STAR_W} height={STAR_H} patternUnits="userSpaceOnUse">
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r.toFixed(2)} fill={s.tint > 0.86 ? "#ffd9a8" : s.tint < 0.16 ? "#b9d2ff" : "#ffffff"} opacity={s.o.toFixed(2)} />
          ))}
        </pattern>
        <pattern id="p-regolith" width={REG} height={REG} patternUnits="userSpaceOnUse">
          {GRAINS.map((g, i) => (
            <circle key={i} cx={g.x.toFixed(1)} cy={g.y.toFixed(1)} r={g.r.toFixed(2)} className={g.light ? "grain-light" : "grain-dark"} opacity={g.o.toFixed(2)} />
          ))}
          {PITS.map((p, i) => (
            <g key={i} opacity="0.3">
              <ellipse cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} rx={p.r.toFixed(1)} ry={(p.r * 0.42).toFixed(1)} className="grain-dark" />
              <path d={`M${(p.x - p.r).toFixed(1)},${p.y.toFixed(1)}a${p.r.toFixed(1)},${(p.r * 0.42).toFixed(1)} 0 0 0 ${(2 * p.r).toFixed(1)},0`} className="pit-rim" />
            </g>
          ))}
        </pattern>
        <linearGradient id="g-terrain" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--terrain-hi)" }} />
          <stop offset="0.12" style={{ stopColor: "var(--terrain)" }} />
          <stop offset="1" style={{ stopColor: "var(--terrain-lo)" }} />
        </linearGradient>
        <linearGradient id="g-terrain-night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--terrain)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--terrain-lo)" }} />
          <stop offset="1" style={{ stopColor: "var(--terrain-lo)" }} />
        </linearGradient>
        <radialGradient id="g-sun">
          <stop offset="0" stopColor="#fffdf0" />
          <stop offset="0.5" style={{ stopColor: "var(--sun-fill)" }} />
          <stop offset="1" style={{ stopColor: "var(--sun)" }} />
        </radialGradient>
        <radialGradient id="g-sun-halo">
          <stop offset="0" style={{ stopColor: "var(--sun-fill)" }} stopOpacity="0.6" />
          <stop offset="0.3" style={{ stopColor: "var(--sun-fill)" }} stopOpacity="0.22" />
          <stop offset="1" style={{ stopColor: "var(--sun-fill)" }} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="g-earth" cx="0.4" cy="0.38" r="0.75">
          <stop offset="0" stopColor="#8fd0f2" />
          <stop offset="0.55" stopColor="#2f86c8" />
          <stop offset="1" stopColor="#0f4c86" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/** Stars behind a sky rectangle. Hidden in the light theme by CSS. */
export function Stars({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return <rect x={x} y={y} width={width} height={height} className="stars" />;
}

/** The Sun's disc with a soft glow. Drawn before the terrain, so a ridge cuts both. */
export function SunDisc({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={Math.max(r * 4.5, 26)} className="sun-halo" />
      <circle cx={cx} cy={cy} r={r} className="disc-sun" />
    </g>
  );
}

const D2R = Math.PI / 180;

/**
 * How Earth is lit as seen from the Moon: the lit share of the disc and the screen angle of its
 * bright side. Earth is "new" when the Sun stands next to it in the lunar sky and full when the
 * Sun is opposite. Positions are azimuth and elevation in degrees.
 */
export function earthPhase(sun: { az: number; el: number }, earth: { az: number; el: number }): { lit: number; angle: number } {
  const dAz = ((sun.az - earth.az + 540) % 360) - 180;
  const cosSep = Math.sin(sun.el * D2R) * Math.sin(earth.el * D2R) + Math.cos(sun.el * D2R) * Math.cos(earth.el * D2R) * Math.cos(dAz * D2R);
  const lit = (1 - Math.max(-1, Math.min(1, cosSep))) / 2;
  // screen: azimuth grows to the right, elevation grows upward (y down)
  const angle = (Math.atan2(-(sun.el - earth.el), dAz * Math.cos(earth.el * D2R)) * 180) / Math.PI;
  return { lit, angle };
}

/** Earth: ocean, a hint of land and cloud, and the night side where the Sun does not reach. */
export function EarthDisc({ cx, cy, r, phase }: { cx: number; cy: number; r: number; phase?: { lit: number; angle: number } }) {
  const id = "earth-" + useId().replace(/[^a-z0-9]/gi, "");
  const detail = r >= 9;
  let shadow: string | null = null;
  if (phase && phase.lit < 0.985) {
    const a = Math.abs(1 - 2 * phase.lit).toFixed(3);
    // dark half on the left, then back along the terminator: bulging right for a crescent, left when gibbous
    shadow = `M0,-1A1,1 0 0 0 0,1A${a},1 0 0 ${phase.lit < 0.5 ? 0 : 1} 0,-1Z`;
  }
  return (
    <g transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${r.toFixed(2)})`} pointerEvents="none">
      <clipPath id={id}>
        <circle r="1" />
      </clipPath>
      <circle r="1" fill="url(#g-earth)" />
      <g clipPath={`url(#${id})`}>
        {detail && (
          <>
            <path d="M-0.62,-0.38c0.2,-0.2 0.52,-0.2 0.6,0.02c0.07,0.2 -0.08,0.3 -0.02,0.5c0.06,0.2 -0.1,0.42 -0.28,0.3c-0.16,-0.12 -0.1,-0.34 -0.24,-0.46c-0.12,-0.1 -0.2,-0.2 -0.06,-0.36z" fill="#5f9f6e" opacity="0.85" />
            <path d="M0.2,0.02c0.18,-0.12 0.46,-0.06 0.5,0.14c0.04,0.2 -0.12,0.44 -0.32,0.44c-0.2,0 -0.34,-0.42 -0.18,-0.58z" fill="#6aa56f" opacity="0.8" />
            <path d="M-0.9,-0.08c0.4,-0.22 0.8,-0.2 1.2,-0.02M-0.5,0.5c0.34,-0.14 0.7,-0.1 1.0,0.06M-0.2,-0.68c0.3,-0.1 0.56,-0.06 0.8,0.06" fill="none" stroke="#ffffff" strokeWidth="0.11" strokeLinecap="round" opacity="0.72" />
          </>
        )}
        {shadow && <path d={shadow} transform={`rotate(${phase!.angle.toFixed(1)})`} fill="#04070d" opacity="0.8" />}
      </g>
      <circle r="1" className="earth-limb" />
    </g>
  );
}
