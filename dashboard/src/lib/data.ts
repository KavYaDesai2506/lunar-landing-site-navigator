import { useEffect, useState } from "react";
import { fmtLat, fmtLon } from "./format";
import type { PolarFeature, Site, SiteIndex, ValidationReport } from "./types";

const DATA = `${import.meta.env.BASE_URL}data`;

async function getJson<T>(url: string, timeoutMs = 0): Promise<T> {
  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) {
      let detail = "";
      try {
        const j = await r.json();
        detail = typeof j?.detail === "string" ? j.detail : JSON.stringify(j?.detail ?? "");
      } catch {
        /* not JSON */
      }
      throw new HttpError(r.status, detail || r.statusText);
    }
    return (await r.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Promise cache: each file is fetched once per session; failures are not cached. */
const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export const loadIndex = () => cached("index", () => getJson<SiteIndex>(`${DATA}/sites/index.json`));
export const loadSite = (id: string) => cached(`site:${id}`, () => getJson<Site>(`${DATA}/sites/${encodeURIComponent(id)}.json`));
export const loadValidation = () => cached("validation", () => getJson<ValidationReport>(`${DATA}/validation_report.json`));
export const loadFeatures = () => cached("features", () => getJson<PolarFeature[]>(`${DATA}/features_south.json`).catch(() => [] as PolarFeature[]));

// ---- optional live engine (custom coordinates) ----

const API_KEY = "lunarnav.apiBase";
// Hosted engine (Vercel Python function, project lunar-navigator-api). Override with VITE_API_BASE,
// ?api=<url>, or the Sites page (e.g. http://127.0.0.1:8765 for a local engine).
export const DEFAULT_API = (import.meta.env.VITE_API_BASE as string | undefined) || "https://lunar-navigator-api.vercel.app";

export function getApiBase(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get("api");
    if (fromUrl) return fromUrl.replace(/\/+$/, "");
    return (localStorage.getItem(API_KEY) || DEFAULT_API).replace(/\/+$/, "");
  } catch {
    return DEFAULT_API;
  }
}

export const isDefaultApi = () => getApiBase() === DEFAULT_API.replace(/\/+$/, "");

/** Forget any engine override (saved address and ?api=) so custom points use the hosted engine again. */
export function resetApiBase() {
  try {
    localStorage.removeItem(API_KEY);
  } catch {
    /* nothing was stored */
  }
  try {
    const u = new URL(location.href);
    if (u.searchParams.has("api")) {
      u.searchParams.delete("api");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch {
    /* leave the URL alone */
  }
}

export function setApiBase(url: string) {
  try {
    if (url.trim()) localStorage.setItem(API_KEY, url.trim());
    else localStorage.removeItem(API_KEY);
  } catch {
    /* storage unavailable: the value just will not persist */
  }
}

export async function apiHealth(): Promise<{ ok: boolean; engine?: string }> {
  // generous timeout: a cold hosted engine takes ~15 s to start
  return getJson(`${getApiBase()}/health`, 90000);
}

export function loadCustom(lat: number, lon: number, mast: string): Promise<Site> {
  const base = getApiBase();
  const url = `${base}/site?lat=${lat}&lon=${lon}&mast=${mast}`;
  return cached(`custom:${url}`, async () => {
    let site: Site;
    try {
      site = await getJson<Site>(url, 300000);
    } catch (e) {
      if (e instanceof HttpError || (e instanceof DOMException && e.name === "AbortError")) throw e;
      // A crashed request (HTTP 500 from the host) carries no CORS header, so the browser reports it
      // as a network failure. If /health answers, the engine is up and it is this point that failed.
      const up = await getJson<{ ok: boolean }>(`${base}/health`, 20000).then(
        (h) => !!h.ok,
        () => false,
      );
      if (!up) throw e;
      // One silent retry: on the hosted engine this is almost always a fresh instance that lost a
      // flaky NASA terrain read (seen 13 Nov); the retry normally succeeds.
      try {
        site = await getJson<Site>(url, 300000);
      } catch (e2) {
        if (e2 instanceof HttpError || (e2 instanceof DOMException && e2.name === "AbortError")) throw e2;
        throw new HttpError(500, "");
      }
    }
    // one label everywhere, in the same style as the curated sites' coordinates
    return { ...site, name: `Custom point ${fmtLat(lat)}, ${fmtLon(lon)}` };
  });
}

/** The live engine's "I had to use coarser terrain" note, if any (DATA_CONTRACT: dem.degraded). */
export function degradedNote(site: Site): string | null {
  const d = site.dem?.degraded;
  return typeof d === "string" && d.trim() ? d.trim() : null;
}

export interface ApiErrorInfo {
  title: string;
  detail: string;
  /** what the user can do about it, when there is something */
  hint?: string;
  /** no answer at all (network, CORS, wrong address) */
  unreachable: boolean;
  /** worth trying the same request again */
  retry: boolean;
}

const COVERAGE_HINT = "Points within about 16° of the south pole (latitude −74° or lower), every curated site, and latitudes 60° S to 60° N are served from terrain the engine already holds.";

export function describeApiError(e: unknown): ApiErrorInfo {
  const base = getApiBase();
  if (e instanceof HttpError) {
    // FastAPI sends {detail}; a crashed serverless function sends plain text or a generic status line
    const generic = !e.message || /^(internal server error|service unavailable|bad gateway|gateway timeout)$/i.test(e.message.trim());
    if (e.status === 503 || e.status === 502 || e.status === 504) {
      return {
        title: "Terrain for this point is not available right now",
        detail: generic ? "The engine could not fetch NASA terrain for this point, and the terrain bundled with it does not reach this far." : e.message,
        // the engine's own 503 message already says which points still work
        hint: generic ? `${COVERAGE_HINT} Try again in a moment, or move the point.` : "Try again in a moment, or move the point.",
        unreachable: false,
        retry: true,
      };
    }
    if (e.status >= 500) {
      return {
        title: `The engine failed on this point (HTTP ${e.status})`,
        detail: generic ? "The engine stopped without an explanation. The usual cause is that it could not download NASA terrain for a region it has not cached." : e.message,
        hint: "Try again in a moment. If it keeps failing, move the point closer to a curated site, or open a curated site: those are precomputed and never need the live engine.",
        unreachable: false,
        retry: true,
      };
    }
    return {
      title: e.status === 422 ? "The engine does not cover this point" : `The engine could not compute this point (HTTP ${e.status})`,
      detail: generic ? "The point may be outside the terrain data the engine has (south-polar and mid-latitude DEMs only; the north pole is not covered yet)." : e.message,
      unreachable: false,
      retry: false,
    };
  }
  const timedOut = e instanceof DOMException && e.name === "AbortError";
  return {
    title: timedOut ? "The live engine did not answer in time" : "Live engine not reachable",
    detail: `Custom coordinates need the engine API at ${base}. The curated sites work without it.`,
    unreachable: true,
    retry: true,
  };
}

// ---- tiny async hook ----

export interface Async<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
}

export function useAsync<T>(make: (() => Promise<T>) | null, key: string): Async<T> {
  const [st, setSt] = useState<Async<T> & { key: string }>({ data: null, error: null, loading: !!make, key });
  useEffect(() => {
    if (!make) {
      setSt({ data: null, error: null, loading: false, key });
      return;
    }
    let live = true;
    setSt((s) => ({ data: s.key === key ? s.data : null, error: null, loading: true, key }));
    make().then(
      (data) => live && setSt({ data, error: null, loading: false, key }),
      (error) => live && setSt({ data: null, error, loading: false, key }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (st.key !== key) return { data: null, error: null, loading: !!make };
  return st;
}
