// Everything the views derive from a per-site file. No ephemeris is computed
// here: positions come from the engine's 3-hourly track (interpolated), event
// times come from the engine's refined event list, and the visible fraction is
// re-evaluated against the horizon of the chosen mast height.

import { parseUtc } from "./format";
import type { Blocker, EventKind, Site, SiteEvent, Target, UncEvent } from "./types";

export type Iv = [number, number];

export interface Ev extends SiteEvent {
  t: number;
  unc?: UncEvent;
}

export interface BodyModel {
  az: Float64Array; // unwrapped, continuous
  el: Float64Array;
  frac: Float32Array; // visible fraction at this mast
  r: number; // angular radius, deg
}

export interface OpenEv {
  t: number;
  kind: "rise" | "set";
}

export interface OpenSet {
  sun: OpenEv[];
  earth: OpenEv[];
  /** true: the engine's stored open_events (~1 s); false: estimated from the 3-hourly track */
  exact: boolean;
}

export interface NamedDir {
  az: number;
  dist: number;
  phrase: string;
  feature: string | null;
}

export interface Model {
  site: Site;
  mast: string;
  t0: number;
  step: number;
  n: number;
  tEnd: number;
  hor: number[];
  /** blocker arrays (from this mast if present, else the default mast: approximate) */
  blk: { dist?: number[]; lat?: number[]; lon?: number[]; h?: number[]; approx: boolean };
  sun: BodyModel;
  earth: BodyModel;
  events: Ev[];
  any: Record<Target, Iv[]>;
  full: Record<Target, Iv[]>;
  both: Iv[];
  open: OpenSet;
  named: NamedDir[];
}

export function wrap360(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** Signed smallest difference a - b in degrees, in (-180, 180]. */
export function angDiff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

export function horizonAt(el: number[], az: number): number {
  const n = el.length;
  const x = (wrap360(az) / 360) * n;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return el[i] * (1 - f) + el[(i + 1) % n] * f;
}

/** Fraction of a disc (radius r, centre elevation el) above a flat horizon at elevation hor. */
export function discFrac(el: number, hor: number, r: number): number {
  const d = (el - hor) / r;
  if (d >= 1) return 1;
  if (d <= -1) return 0;
  return 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
}

export function decodeBody(az_cdeg: number[], el_mdeg: number[], r: number, hor: number[]): BodyModel {
  const n = az_cdeg.length;
  const az = new Float64Array(n);
  const el = new Float64Array(n);
  const frac = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let a = az_cdeg[i] / 100;
    if (i > 0) a = prev + angDiff(a, prev);
    az[i] = a;
    prev = a;
    el[i] = el_mdeg[i] / 1000;
    frac[i] = discFrac(el[i], horizonAt(hor, a), r);
  }
  return { az, el, frac, r };
}

export function intervals(evs: Ev[], target: Target, open: EventKind, close: EventKind, t0: number, tEnd: number, startsOpen: boolean): Iv[] {
  const out: Iv[] = [];
  const list = evs.filter((e) => e.target === target && (e.kind === open || e.kind === close));
  let cur: number | null = list.length ? (list[0].kind === close ? t0 : null) : startsOpen ? t0 : null;
  for (const e of list) {
    if (e.kind === open) {
      if (cur == null) cur = e.t;
    } else if (cur != null) {
      out.push([cur, e.t]);
      cur = null;
    }
  }
  if (cur != null) out.push([cur, tEnd]);
  return out;
}

export function intersect(a: Iv[], b: Iv[]): Iv[] {
  const out: Iv[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

export function overlapMs(ivs: Iv[], a: number, b: number): number {
  let s = 0;
  for (const [x, y] of ivs) {
    if (y <= a) continue;
    if (x >= b) break;
    s += Math.min(y, b) - Math.max(x, a);
  }
  return s;
}

/** Longest stretch inside [a, b] not covered by the intervals. */
export function longestGapMs(ivs: Iv[], a: number, b: number): number {
  let best = 0;
  let cur = a;
  for (const [x, y] of ivs) {
    if (y <= a) continue;
    if (x >= b) break;
    if (x > cur) best = Math.max(best, x - cur);
    cur = Math.max(cur, y);
  }
  if (b > cur) best = Math.max(best, b - cur);
  return best;
}

export function inIntervals(ivs: Iv[], t: number): Iv | null {
  for (const iv of ivs) {
    if (t < iv[0]) return null;
    if (t < iv[1]) return iv;
  }
  return null;
}

function openHorizon(body: BodyModel, t0: number, step: number): OpenEv[] {
  // upper limb crossing zero elevation on an ideal sphere (what a no-terrain tool reports)
  const out: OpenEv[] = [];
  for (let i = 1; i < body.el.length; i++) {
    const a = body.el[i - 1] + body.r;
    const b = body.el[i] + body.r;
    if (a <= 0 === b <= 0) continue;
    out.push({ t: t0 + (i - 1 + a / (a - b)) * step, kind: b > 0 ? "rise" : "set" });
  }
  return out;
}

/** The engine's stored flat-horizon events: upper limb crossing 0 deg, refined to ~1 s. */
export function storedOpen(list: SiteEvent[] | null | undefined, target: Target): OpenEv[] | null {
  if (!Array.isArray(list) || !list.length) return null;
  const out: OpenEv[] = [];
  for (const e of list) {
    if (e.target !== target || (e.kind !== "first_light" && e.kind !== "last_light")) continue;
    const t = parseUtc(e.utc);
    if (isFinite(t)) out.push({ t, kind: e.kind === "first_light" ? "rise" : "set" });
  }
  return out.sort((a, b) => a.t - b.t);
}

function openSet(site: Site, sun: BodyModel, earth: BodyModel, t0: number, step: number): OpenSet {
  const s = storedOpen(site.open_events, "sun");
  const e = storedOpen(site.open_events, "earth");
  // files written before 13 Nov, and the live API until it is redeployed, do not carry the field
  if (s && e) return { sun: s, earth: e, exact: true };
  return { sun: openHorizon(sun, t0, step), earth: openHorizon(earth, t0, step), exact: false };
}

const cache = new WeakMap<Site, Map<string, Model>>();

export function mastKeys(site: Site): string[] {
  return Object.keys(site.horizons).sort((a, b) => +a - +b);
}

export function defaultMast(site: Site): string {
  const keys = mastKeys(site);
  const want = String(site.default_mast_m);
  return keys.includes(want) ? want : keys.find((k) => +k === site.default_mast_m) ?? keys[0];
}

export function buildModel(site: Site, mastWanted?: string | null): Model {
  const keys = mastKeys(site);
  const mast = mastWanted && keys.includes(mastWanted) ? mastWanted : defaultMast(site);
  let perSite = cache.get(site);
  if (!perSite) cache.set(site, (perSite = new Map()));
  const hit = perSite.get(mast);
  if (hit) return hit;

  const H = site.horizons[mast];
  const hor = H.el_deg;
  const tr = site.track;
  const t0 = parseUtc(tr.start_utc);
  const step = tr.step_s * 1000;
  const n = tr.sun.el_mdeg.length;
  const tEnd = Math.min(parseUtc(site.window.stop_utc), t0 + (n - 1) * step);
  const sun = decodeBody(tr.sun.az_cdeg, tr.sun.el_mdeg, tr.sun.ang_radius_deg, hor);
  const earth = decodeBody(tr.earth.az_cdeg, tr.earth.el_mdeg, tr.earth.ang_radius_deg, hor);

  const events: Ev[] = (site.events[mast] ?? []).map((e) => ({ ...e, t: parseUtc(e.utc) })).sort((a, b) => a.t - b.t);

  const unc = site.uncertainty;
  if (unc && String(unc.mast_m) === mast) {
    for (const u of unc.events) {
      const tu = parseUtc(u.utc);
      let best: Ev | null = null;
      let bd = 6 * 3600e3;
      for (const e of events) {
        if (e.target !== u.target || e.kind !== u.kind) continue;
        const d = Math.abs(e.t - tu);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best && !best.unc) best.unc = u;
    }
  }

  const any = {
    sun: intervals(events, "sun", "first_light", "last_light", t0, tEnd, sun.frac[0] > 0),
    earth: intervals(events, "earth", "first_light", "last_light", t0, tEnd, earth.frac[0] > 0),
  };
  const full = {
    sun: intervals(events, "sun", "full_disc", "partial", t0, tEnd, sun.frac[0] >= 0.999),
    earth: intervals(events, "earth", "full_disc", "partial", t0, tEnd, earth.frac[0] >= 0.999),
  };

  const defH = site.horizons[defaultMast(site)];
  const src = H.block_dist_km ? H : defH;
  const named: NamedDir[] = [];
  const seen = new Set<string>();
  const collect = (list?: SiteEvent[]) => {
    for (const e of list ?? []) {
      const b = e.blocker;
      if (!b) continue;
      const k = `${Math.round(b.az_deg)}|${b.phrase}`;
      if (seen.has(k)) continue;
      seen.add(k);
      named.push({ az: b.az_deg, dist: b.dist_km, phrase: b.phrase, feature: b.feature });
    }
  };
  collect(site.events[defaultMast(site)]);
  collect(site.events[mast]);
  collect(site.mission_replay?.events);

  const model: Model = {
    site,
    mast,
    t0,
    step,
    n,
    tEnd,
    hor,
    blk: { dist: src.block_dist_km, lat: src.block_lat, lon: src.block_lon, h: src.block_h_m, approx: !H.block_dist_km },
    sun,
    earth,
    events,
    any,
    full,
    both: intersect(any.sun, any.earth),
    open: openSet(site, sun, earth, t0, step),
    named,
  };
  perSite.set(mast, model);
  return model;
}

/** Stretches when the target is above a flat 0-degree horizon (no terrain). */
export function openIntervals(m: Model, target: Target): Iv[] {
  const out: Iv[] = [];
  const list = m.open[target];
  let cur: number | null = (list.length ? list[0].kind === "set" : m[target].el[0] + m[target].r > 0) ? m.t0 : null;
  for (const e of list) {
    if (e.kind === "rise") {
      if (cur == null) cur = e.t;
    } else if (cur != null) {
      out.push([cur, e.t]);
      cur = null;
    }
  }
  if (cur != null) out.push([cur, m.tEnd]);
  return out;
}

export function clampT(m: Model, t: number): number {
  return Math.min(m.tEnd, Math.max(m.t0, t));
}

export interface BodyState {
  az: number;
  el: number;
  hor: number;
  frac: number;
  /** disc centre above (+) or below (-) the terrain horizon, deg */
  clearance: number;
  r: number;
}

export function posAt(m: Model, target: Target, t: number): { az: number; el: number } {
  const b = m[target];
  const x = Math.min(m.n - 1, Math.max(0, (t - m.t0) / m.step));
  const i = Math.min(m.n - 2, Math.floor(x));
  const f = x - i;
  return { az: wrap360(b.az[i] * (1 - f) + b.az[i + 1] * f), el: b.el[i] * (1 - f) + b.el[i + 1] * f };
}

export function bodyAt(m: Model, target: Target, t: number): BodyState {
  const { az, el } = posAt(m, target, t);
  const hor = horizonAt(m.hor, az);
  const r = m[target].r;
  // The interval list (built from refined events) decides visible / not visible;
  // the interpolated geometry gives the size of the visible part.
  let frac = discFrac(el, hor, r);
  const vis = !!inIntervals(m.any[target], t);
  if (vis && frac <= 0) frac = 0.01;
  if (!vis && frac > 0) frac = 0;
  if (vis && frac < 1 && inIntervals(m.full[target], t)) frac = 1;
  return { az, el, hor, frac, clearance: el - hor, r };
}

export function nextEvent(m: Model, target: Target, kinds: EventKind[], t: number): Ev | null {
  for (const e of m.events) if (e.t > t && e.target === target && kinds.includes(e.kind)) return e;
  return null;
}

export function prevEvent(m: Model, target: Target, kinds: EventKind[], t: number): Ev | null {
  for (let i = m.events.length - 1; i >= 0; i--) {
    const e = m.events[i];
    if (e.t <= t && e.target === target && kinds.includes(e.kind)) return e;
  }
  return null;
}

export function nextOpen(m: Model, target: Target, kind: "rise" | "set", t: number): OpenEv | null {
  for (const e of m.open[target]) if (e.t > t && e.kind === kind) return e;
  return null;
}

/** Is the target above a flat 0-degree horizon at t? Stored events decide when present, else the track. */
export function openUpAt(m: Model, target: Target, t: number): boolean {
  if (m.open.exact) {
    const list = m.open[target];
    let last: OpenEv | null = null;
    for (const e of list) {
      if (e.t > t) break;
      last = e;
    }
    if (last) return last.kind === "rise";
    if (list.length) return list[0].kind === "set";
  }
  return posAt(m, target, t).el + m[target].r > 0;
}

export interface BlockInfo {
  dist_km: number;
  lat: number;
  lon: number;
  h_m: number;
  phrase: string | null;
  feature: string | null;
  local: boolean;
  approx: boolean;
}

/** What sets the horizon in a given direction. */
export function blockerAt(m: Model, az: number): BlockInfo | null {
  const d = m.blk.dist;
  if (!d) return null;
  const n = d.length;
  const i = Math.round((wrap360(az) / 360) * n) % n;
  const dist = d[i];
  let phrase: string | null = null;
  let feature: string | null = null;
  let best = 2.5;
  for (const nd of m.named) {
    const da = Math.abs(angDiff(nd.az, az));
    if (da < best && nd.dist / dist > 0.55 && nd.dist / dist < 1.8) {
      best = da;
      phrase = nd.phrase;
      feature = nd.feature;
    }
  }
  const local = dist < 1;
  return {
    dist_km: dist,
    lat: m.blk.lat?.[i] ?? NaN,
    lon: m.blk.lon?.[i] ?? NaN,
    h_m: m.blk.h?.[i] ?? NaN,
    phrase: local ? "local ground slope right at the site" : phrase,
    feature,
    local,
    approx: m.blk.approx,
  };
}

export function eventBlocker(m: Model, e: SiteEvent): BlockInfo | null {
  const b: Blocker | undefined = e.blocker;
  if (b) return { dist_km: b.dist_km, lat: b.lat, lon: b.lon, h_m: b.h_m, phrase: b.phrase, feature: b.feature, local: b.dist_km < 1, approx: false };
  return blockerAt(m, e.az_deg);
}

export interface FeatureLabel {
  name: string;
  az: number;
  dist: number;
  count: number;
}

/** Named terrain along the horizon, strongest attributions first. */
export function featureLabels(m: Model): FeatureLabel[] {
  const groups = new Map<string, { sx: number; sy: number; dist: number; count: number }>();
  for (const nd of m.named) {
    if (!nd.feature || nd.dist < 1) continue;
    // one label per feature per ~40 deg sector
    const key = `${nd.feature}|${Math.round(nd.az / 40)}`;
    const g = groups.get(key) ?? { sx: 0, sy: 0, dist: 0, count: 0 };
    g.sx += Math.cos((nd.az * Math.PI) / 180);
    g.sy += Math.sin((nd.az * Math.PI) / 180);
    g.dist += nd.dist;
    g.count++;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([k, g]) => ({ name: k.split("|")[0], az: wrap360((Math.atan2(g.sy, g.sx) * 180) / Math.PI), dist: g.dist / g.count, count: g.count }))
    .sort((a, b) => b.count - a.count);
}

export interface StayStats {
  a: number;
  b: number;
  hours: number;
  sunH: number;
  sunFullH: number;
  earthH: number;
  bothH: number;
  longestDarkH: number;
  clipped: boolean;
}

export function stayStats(m: Model, start: number, lenMs: number): StayStats {
  const a = clampT(m, start);
  const b = clampT(m, start + lenMs);
  const H = 3600e3;
  return {
    a,
    b,
    hours: (b - a) / H,
    sunH: overlapMs(m.any.sun, a, b) / H,
    sunFullH: overlapMs(m.full.sun, a, b) / H,
    earthH: overlapMs(m.any.earth, a, b) / H,
    bothH: overlapMs(m.both, a, b) / H,
    longestDarkH: longestGapMs(m.any.sun, a, b) / H,
    clipped: start + lenMs > m.tEnd || start < m.t0,
  };
}

export interface SlipCurve {
  t: number[];
  sun: number[]; // average illumination during the stay, %
  both: number[]; // % of the stay with Sun and Earth both (any part) visible
}

const curveCache = new WeakMap<Model, Map<number, SlipCurve>>();

export function slipCurve(m: Model, stayMs: number): SlipCurve {
  let per = curveCache.get(m);
  if (!per) curveCache.set(m, (per = new Map()));
  const hit = per.get(stayMs);
  if (hit) return hit;
  const k = Math.max(1, Math.round(stayMs / m.step));
  const ps = new Float64Array(m.n + 1);
  const pb = new Float64Array(m.n + 1);
  for (let i = 0; i < m.n; i++) {
    ps[i + 1] = ps[i] + m.sun.frac[i];
    pb[i + 1] = pb[i] + (m.sun.frac[i] > 0 && m.earth.frac[i] > 0 ? 1 : 0);
  }
  const out: SlipCurve = { t: [], sun: [], both: [] };
  for (let i = 0; i + k <= m.n; i += 2) {
    out.t.push(m.t0 + i * m.step);
    out.sun.push(((ps[i + k] - ps[i]) / k) * 100);
    out.both.push(((pb[i + k] - pb[i]) / k) * 100);
  }
  per.set(stayMs, out);
  return out;
}

/** Share of terrain clones in which an uncertainty event happens at all (1 = always). */
export function presentFrac(u: UncEvent, nClones = 100): number {
  return u.present_frac ?? Math.min(1, u.n_clones_matched / nClones);
}

export function isPolar(site: Site): boolean {
  return Math.abs(site.requested.lat) >= 80;
}
