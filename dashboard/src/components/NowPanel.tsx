import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { bodyAt, eventBlocker, inIntervals, nextEvent, nextOpen, openUpAt, presentFrac } from "../lib/astro";
import type { Ev, Model } from "../lib/astro";
import { DAY, HOUR, fmtAz, fmtDate, fmtDateTime, fmtDeg, fmtDur, fmtKm, fmtSpan, fmtTime } from "../lib/format";
import { tr } from "../lib/i18n";
import type { Lang } from "../lib/state";
import type { SiteHeadline } from "../lib/types";
import Info from "./Info";

interface Props {
  model: Model;
  t: number;
  live: boolean;
  lang: Lang;
  head?: SiteHeadline | null;
  onJump: (t: number) => void;
  /** open a drawer tab on the site view */
  onTab?: (tab: string) => void;
  /** placed straight after the sunset tile (the first-screen mission replay) */
  extra?: ReactNode;
}

export function whereText(m: Model, e: Ev): string {
  const b = eventBlocker(m, e);
  if (!b) return `azimuth ${fmtAz(e.az_deg)}`;
  const what = b.local ? "the ground slope right at the site" : b.phrase ?? "terrain";
  return `${what}, ${fmtKm(b.dist_km)} away, azimuth ${fmtAz(e.az_deg)}${b.approx && !b.local ? " (ridge taken from the 2 m horizon)" : ""}`;
}

/** How far the event time moves across NASA's 100 alternative terrains: a chip that opens the How sure tab, with the working behind a "?". */
function Sure({ e, onTab }: { e: Ev; onTab?: (tab: string) => void }) {
  const u = e.unc;
  if (!u) return null;
  const fragile = presentFrac(u) < 0.995;
  return (
    <span className="sure">
      <button type="button" className="chip chip-btn" onClick={() => onTab?.("sure")} title="How sure is this time? Opens the How sure tab">
        ± {fmtSpan(u.spread_p10_p90_h)}
        {fragile ? ` · in ${Math.round(presentFrac(u) * 100)}% of terrains` : ""}
      </button>
      <Info label="How sure is this time?">
        Recomputed on {u.n_clones_matched} of NASA's 100 alternative terrains (the elevation model shifted within its measurement error), 8 in 10 results fall between {fmtTime(Date.parse(u.p10_utc), true)} and{" "}
        {fmtTime(Date.parse(u.p90_utc), true)} UTC. {u.spread_p10_p90_h < 0.1 ? "Terrain error near the site barely moves this event." : "A grazing event: metre-scale terrain error moves it."}
        {fragile ? " In the other terrains it does not happen at all." : ""}
      </Info>
    </span>
  );
}

const ICON = {
  sun: (
    <svg viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="3.4" />
      <path d="M8 .8v2.2M8 13v2.2M.8 8H3M13 8h2.2M2.9 2.9l1.6 1.6M11.5 11.5l1.6 1.6M2.9 13.1l1.6-1.6M11.5 4.5l1.6-1.6" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8.6" r="5.6" />
      <path d="M8 5.4v3.4l2.2 1.4M6.2 1h3.6" />
    </svg>
  ),
  ridge: (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M.8 13.6 5.6 4.4l2.6 4 1.9-2.6 5.1 7.8z" />
    </svg>
  ),
};

export default function NowPanel({ model: m, t, live, lang, head, onJump, onTab, extra }: Props) {
  const sun = bodyAt(m, "sun", t);
  const earth = bodyAt(m, "earth", t);
  const sunUp = sun.frac > 0;
  const earthUp = earth.frac > 0;
  const name = m.site.name;

  const sunEv = nextEvent(m, "sun", [sunUp ? "last_light" : "first_light"], t);
  const sunBack = sunEv && sunUp ? nextEvent(m, "sun", ["first_light"], sunEv.t) : null;
  const sunGone = sunEv && !sunUp ? nextEvent(m, "sun", ["last_light"], sunEv.t) : null;
  const earthEv = nextEvent(m, "earth", [earthUp ? "last_light" : "first_light"], t);
  const farSide = head ? head.far_side : m.site.longterm[m.mast]?.earth.any_visible_pct === 0 && m.earth.el.every((v) => v + m.earth.r < 0);
  const earthNever = m.any.earth.length === 0;
  const bothNow = inIntervals(m.both, t);
  const nextBoth = bothNow ? null : m.both.find((iv) => iv[0] > t) ?? null;

  // open-horizon (no terrain) counterpart of the Sun event
  // (exact to ~1 s when the file carries open_events, else estimated from the 3-hourly track)
  const exact = m.open.exact;
  const openUp = openUpAt(m, "sun", t);
  const openEv = sunEv ? nextOpen(m, "sun", sunUp ? "set" : "rise", t) : null;
  const openWhen = (x: number) => (exact ? fmtDateTime(x, false) : `about ${fmtDateTime(Math.round(x / 600e3) * 600e3, false)}`);
  let openLine: string | null = null;
  if (sunEv) {
    if (sunUp && !openUp) {
      const back = nextOpen(m, "sun", "rise", t);
      openLine = `already calls it night${back && exact ? `, until ${fmtDateTime(back.t, false)}` : ""}`;
    } else if (!sunUp && openUp) {
      const gone = nextOpen(m, "sun", "set", t);
      openLine = `calls this spot lit now${gone && exact ? `, until ${fmtDateTime(gone.t, false)}` : ""}`;
    } else if (openEv) {
      const gap = (openEv.t - sunEv.t) / HOUR;
      openLine = `${openWhen(openEv.t)} · ${fmtSpan(Math.abs(gap))} ${gap >= 0 ? "too late" : "too early"}`;
    } else openLine = `no ${sunUp ? "sunset" : "sunrise"} before the data ends`;
  }

  const ridge = sunEv ? eventBlocker(m, sunEv) : null;
  const secs = live && sunEv != null && sunEv.t - t < DAY;
  const dur = (e: Ev | null) => (e ? fmtDur(e.t - t, live && e.t - t < DAY) : "");

  let headline: string;
  if (sunUp) {
    headline = sunEv
      ? tr(lang, sun.frac < 0.999 ? "hSunPartial" : "hSunUp", {
          p: Math.max(1, Math.round(sun.frac * 100)), site: name, deg: fmtDeg(sun.clearance), dur: fmtDur(sunEv.t - t), cause: tr(lang, "causeSet", { where: whereText(m, sunEv) }) })
      : tr(lang, "hSunUpNoSet", { site: name, deg: fmtDeg(sun.clearance) });
  } else {
    headline = sunEv ? tr(lang, "hSunDown", { site: name, dur: fmtDur(sunEv.t - t), cause: tr(lang, "causeRise", { where: whereText(m, sunEv) }) }) : tr(lang, "hSunDownNoRise", { site: name });
  }

  // throttled live region: screen readers hear the answer at most once a minute
  const [spoken, setSpoken] = useState(headline);
  const last = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - last.current > 60000 || !live) {
      last.current = now;
      setSpoken(headline);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headline]);

  const sunState = !sunUp ? tr(lang, "sunHidden") : sun.frac >= 0.999 ? tr(lang, "fullSun") : tr(lang, "partialSun", { p: Math.max(1, Math.round(sun.frac * 100)) });
  let earthState: string;
  if (farSide) earthState = tr(lang, "farSide");
  else if (earthNever) earthState = head?.earth_blocked_by_terrain ? tr(lang, "earthBlocked") : tr(lang, "earthHidden");
  else if (!earthUp) earthState = tr(lang, "earthHidden");
  else if (earth.frac >= 0.999) earthState = tr(lang, "fullEarth");
  else if (earth.frac < 0.25) earthState = tr(lang, "earthLimb", { p: Math.max(1, Math.round(earth.frac * 100)) });
  else earthState = tr(lang, "partialEarth", { p: Math.round(earth.frac * 100) });

  const pin = (x: number, withYear = false) => (
    <button className="linkish" onClick={() => onJump(x)} title="Move the time cursor to this moment">
      {fmtDateTime(x, withYear)}
    </button>
  );

  return (
    <section aria-label="Current conditions" className="now">
      <div className="status" lang={lang}>
        <span className={`stat-chip ${sunUp ? "sun" : "dark"}`}>
          {ICON.sun}
          {!sunUp ? "Sun behind terrain" : sun.frac < 0.999 ? `${Math.max(1, Math.round(sun.frac * 100))}% of Sun visible` : `Full Sun, ${fmtDeg(sun.clearance)} above terrain`}
        </span>
        <span className="stat-chip">
          {ICON.clock}
          {sunEv ? `${sunUp ? "last light" : "first light"} in ${fmtDur(sunEv.t - t)}` : sunUp ? "no sunset in this period" : "no sunrise before the data ends"}
        </span>
        {sunEv && ridge && (
          <button type="button" className="stat-chip ridge" data-hl="ridge" onClick={() => onTab?.("horizon")} title={`The terrain that ${sunUp ? "ends" : "returns"} the light. Opens Horizon source.`}>
            {ICON.ridge}
            <b>{ridge.local ? "ground slope at the site" : ridge.phrase ?? "terrain"}</b>
            <span>
              {fmtKm(ridge.dist_km)} · {fmtAz(sunEv.az_deg)}
            </span>
            <i className="go" aria-hidden>
              ›
            </i>
          </button>
        )}
      </div>
      <div className="sr-only" aria-live="polite">
        {spoken}
      </div>
      <div className="tiles">
        <div className="tile tile-wide">
          <div className="tile-label">{sunEv ? (sunUp ? "Terrain sunset in" : "Terrain sunrise in") : sunUp ? "Sunlight" : "Darkness"}</div>
          {sunEv ? (
            <>
              <div className="tile-value">{fmtDur(sunEv.t - t, secs)}</div>
              <div className="tile-state">
                {pin(sunEv.t, true)} <Sure e={sunEv} onTab={onTab} />
              </div>
              <dl className="tile-facts">
                {openLine && (
                  <>
                    <dt>Flat-horizon tool</dt>
                    <dd>{openLine}</dd>
                  </>
                )}
                {(sunBack || sunGone) && (
                  <>
                    <dt>{sunBack ? "Then dark for" : "Then lit for"}</dt>
                    <dd>{fmtDur((sunBack ?? sunGone)!.t - sunEv.t)}</dd>
                  </>
                )}
              </dl>
            </>
          ) : (
            <div className="tile-state big" lang={lang}>
              {tr(lang, sunUp ? "noSunset" : "noSunrise")} ({fmtDateTime(m.tEnd)})
            </div>
          )}
        </div>

        {extra}

        <div className="tile">
          <div className="tile-label">{sun.clearance >= 0 ? "Sun clears the terrain by" : sunUp ? "Sun is slipping behind terrain" : "Sun is below the terrain by"}</div>
          <div className={`tile-value ${sun.clearance < 0 ? "neg" : ""}`}>{sun.clearance < 0 && sunUp ? `${Math.max(1, Math.round(sun.frac * 100))}% showing` : `${Math.abs(sun.clearance).toFixed(2)}°`}</div>
          <div className="tile-state" lang={lang}>
            <span className={`dot ${sunUp ? "dot-sun" : "dot-dark"}`} aria-hidden />
            {sunState}{" "}
            <Info label="How the Sun's height is worked out">
              The Sun's centre is {fmtDeg(sun.el)} above a perfectly smooth Moon. Toward {fmtAz(sun.az)} the terrain horizon sits at {fmtDeg(sun.hor)}, so the Sun's centre is {fmtDeg(Math.abs(sun.clearance))}{" "}
              {sun.clearance >= 0 ? "above" : "below"} the terrain. The disc is 0.53° wide.
            </Info>
          </div>
        </div>

        <div className="tile">
          {earthEv ? (
            <>
              <div className="tile-label">{earthUp ? "Earthset in" : "Earthrise in"}</div>
              <div className="tile-value">{dur(earthEv)}</div>
              <div className="tile-state" lang={lang}>
                <span className={`dot ${earthUp ? "dot-earth" : "dot-dark"}`} aria-hidden />
                {pin(earthEv.t)}{" "}
                <Info label="Earth and the radio link">
                  {earthState}. {earthUp ? "It sets behind" : "It rises over"} {whereText(m, earthEv)}. Earth in view means a direct radio link is possible.
                </Info>
              </div>
            </>
          ) : (
            <>
              <div className="tile-label">Earth (radio link)</div>
              <div className="tile-state big" lang={lang}>
                <span className={`dot ${earthUp ? "dot-earth" : "dot-dark"}`} aria-hidden />
                {earthUp && !farSide ? tr(lang, "earthAlways") : earthState}
              </div>
              {earthUp && (
                <div className="tile-sub">
                  {fmtDeg(earth.clearance, 1)} above the terrain toward {fmtAz(earth.az)}.
                </div>
              )}
            </>
          )}
        </div>

        <div className="tile">
          {bothNow ? (
            <>
              <div className="tile-label">Sun + Earth both visible for</div>
              <div className="tile-value">{bothNow[1] >= m.tEnd ? "all the data" : fmtDur(bothNow[1] - t)}</div>
              <div className="tile-state" lang={lang}>
                <span className="dot dot-both" aria-hidden />
                {bothNow[1] >= m.tEnd ? `to ${fmtDate(m.tEnd)}` : <>until {pin(bothNow[1])}</>}{" "}
                <Info label="Why this window matters">Power and a direct link at the same time: the usable operations window.</Info>
              </div>
            </>
          ) : nextBoth ? (
            <>
              <div className="tile-label">Sun + Earth both visible from</div>
              <div className="tile-value">{fmtDate(nextBoth[0], false)}</div>
              <div className="tile-state" lang={lang}>
                <span className="dot dot-dark" aria-hidden />
                <button className="linkish" onClick={() => onJump(nextBoth[0])} title="Move the time cursor to this moment">
                  {fmtTime(nextBoth[0])} UTC
                </button>{" "}
                · lasts {fmtDur(nextBoth[1] - nextBoth[0])}{" "}
                <Info label="Why this window matters">
                  Power and a direct link at the same time: the usable operations window. It opens in {fmtDur(nextBoth[0] - t)}.
                </Info>
              </div>
            </>
          ) : (
            <>
              <div className="tile-label">Sun + Earth together</div>
              <div className="tile-state big" lang={lang}>
                <span className="dot dot-dark" aria-hidden />
                {farSide ? tr(lang, "farSide") : tr(lang, "noBoth")}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
