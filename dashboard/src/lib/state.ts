// App state lives in the URL hash, so every view is a shareable deep link:
//   #/site?site=shackleton_rim_s&t=2026-11-13T16:10Z&m=10&stay=6&slip=14&tab=plan
// The route names (#/site, #/sites, #/compare, #/missions, #/evidence) are in the README and the
// slides, so they never change; the nav labels do (Explore, Map & custom, ...). #/explore and #/map
// are accepted as aliases.
import { useSyncExternalStore } from "react";
import { isoMinute, normLon, parseUtc, roundCoord } from "./format";
import { UPCOMING } from "./upcoming";

export type View = "site" | "compare" | "missions" | "evidence" | "sites";
export type Lang = "en";

export interface AppState {
  view: View;
  site: string; // curated id, or "custom"
  lat: number | null; // custom point
  lon: number | null;
  mast: string;
  t: number | null; // null = follow the real clock
  stay: number; // days on the surface
  slip: number; // schedule slip in days (0 = none)
  cmp: string[];
  zoom: number; // timeline span in days, 0 = whole planning window
  lang: Lang;
  tab: string | null; // drawer tab on the site view; null = the site's own default
  open: string | null; // expanded mission on the Missions view
  hl: string | null; // control to pulse once (set by the Start here jobs), then dropped
}

export const DEFAULTS: AppState = {
  view: "site",
  site: "shackleton_rim_s",
  lat: null,
  lon: null,
  mast: "2",
  t: null,
  stay: 6,
  slip: 0,
  cmp: ["shackleton_rim_s", "connecting_ridge_c1", "malapert_region"],
  zoom: 90,
  lang: "en",
  tab: null,
  open: null,
  hl: null,
};

const VIEWS: View[] = ["site", "compare", "missions", "evidence", "sites"];
const ALIAS: Record<string, View> = { explore: "site", map: "sites", custom: "sites" };

/**
 * The site a bare link opens on: the south-polar site whose next terrain sunrise or sunset is
 * closest, so the countdown on the first screen is visibly ticking. Links that name a site are
 * never affected. Falls back to Shackleton rim once the precomputed window has run out.
 */
export function liveDefaultSite(now = Date.now()): string {
  const from = now / 60000 + 10; // skip an event that is about to pass
  let best = DEFAULTS.site;
  let bt = Infinity;
  for (const [id, evs] of Object.entries(UPCOMING)) {
    for (const v of evs) {
      const t = Math.abs(v);
      if (t >= from && t < bt) {
        bt = t;
        best = id;
      }
    }
  }
  return best;
}

const cleanLat = (v: number | null) => (v == null ? null : roundCoord(v));
const cleanLon = (v: number | null) => (v == null ? null : normLon(v));

function parse(hash: string): AppState {
  const m = /^#\/?([a-z]*)\??(.*)$/.exec(hash || "");
  const q = new URLSearchParams(m?.[2] ?? "");
  const s: AppState = { ...DEFAULTS, cmp: [...DEFAULTS.cmp] };
  if (m && (VIEWS as string[]).includes(m[1])) s.view = m[1] as View;
  else if (m && ALIAS[m[1]]) s.view = ALIAS[m[1]];
  const num = (k: string) => (q.has(k) && q.get(k) !== "" && isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  if (q.get("site")) s.site = q.get("site")!;
  else s.site = liveDefaultSite();
  s.lat = cleanLat(num("lat"));
  s.lon = cleanLon(num("lon"));
  if (q.get("m")) s.mast = q.get("m")!;
  if (q.get("t")) {
    const t = parseUtc(q.get("t")!);
    if (isFinite(t)) s.t = t;
  }
  s.stay = num("stay") ?? s.stay;
  s.slip = num("slip") ?? s.slip;
  s.zoom = num("z") ?? s.zoom;
  if (q.get("cmp")) s.cmp = q.get("cmp")!.split(",").filter(Boolean).slice(0, 4);
  const word = (k: string) => (/^[a-z0-9_-]{1,40}$/i.test(q.get(k) ?? "") ? q.get(k)! : null);
  s.tab = word("tab");
  s.open = word("open");
  s.hl = word("hl");
  return s;
}

function serialise(s: AppState): string {
  const q: string[] = [];
  const add = (k: string, v: string | number) => q.push(`${k}=${encodeURIComponent(String(v)).replace(/%3A/g, ":").replace(/%2C/g, ",")}`);
  if (s.view === "site" || s.site !== DEFAULTS.site) add("site", s.site);
  if (s.site === "custom" && s.lat != null && s.lon != null) {
    add("lat", s.lat);
    add("lon", s.lon);
  }
  if (s.mast !== DEFAULTS.mast) add("m", s.mast);
  if (s.t != null) add("t", isoMinute(s.t));
  if (s.stay !== DEFAULTS.stay) add("stay", s.stay);
  if (s.slip) add("slip", s.slip);
  if (s.zoom !== DEFAULTS.zoom) add("z", s.zoom);
  if (s.view === "compare" || s.cmp.join() !== DEFAULTS.cmp.join()) add("cmp", s.cmp.join(","));
  if (s.view === "site" && s.tab) add("tab", s.tab);
  if (s.view === "missions" && s.open) add("open", s.open);
  if (s.hl) add("hl", s.hl);
  return `#/${s.view}${q.length ? "?" + q.join("&") : ""}`;
}

let state = parse(location.hash);
let written = "";
let timer: number | undefined;
const subs = new Set<() => void>();

function flush() {
  timer = undefined;
  const h = serialise(state);
  if (h !== location.hash) {
    written = h;
    history.replaceState(null, "", location.pathname + location.search + h);
  }
}

export function setState(patch: Partial<AppState>, opts: { push?: boolean } = {}) {
  const next = { ...state, ...patch };
  // 222.84 % 360 is 222.84000000000003 in floating point: keep such noise out of the URL and labels
  next.lat = cleanLat(next.lat);
  next.lon = cleanLon(next.lon);
  const navigates = opts.push || (patch.view != null && patch.view !== state.view);
  state = next;
  subs.forEach((f) => f());
  if (navigates) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const h = serialise(state);
    written = h;
    history.pushState(null, "", location.pathname + location.search + h);
    window.scrollTo(0, 0);
  } else if (!timer) {
    timer = window.setTimeout(flush, 250);
  }
}

/** A pasted or hand-edited custom link may carry float noise (lon=222.84000000000003): tidy the address bar. */
function tidyCustom() {
  if (state.site === "custom" && state.lat != null && !timer) timer = window.setTimeout(flush, 250);
}
tidyCustom();

window.addEventListener("hashchange", () => {
  if (location.hash === written) return;
  state = parse(location.hash);
  subs.forEach((f) => f());
  tidyCustom();
});
window.addEventListener("popstate", () => {
  state = parse(location.hash);
  subs.forEach((f) => f());
});

export function useAppState(): AppState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

export function linkFor(patch: Partial<AppState>): string {
  return serialise({ ...state, ...patch });
}
