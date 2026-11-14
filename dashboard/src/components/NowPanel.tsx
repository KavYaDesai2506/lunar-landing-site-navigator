import { useEffect, useRef, useState } from "react";
import { bodyAt, eventBlocker, inIntervals, nextEvent, nextOpen, openUpAt, presentFrac } from "../lib/astro";
import type { Ev, Model } from "../lib/astro";
import { DAY, HOUR, fmtAz, fmtDateTime, fmtDeg, fmtDur, fmtKm, fmtSpan, fmtTime } from "../lib/format";
import { tr } from "../lib/i18n";
import type { Lang } from "../lib/state";
import type { SiteHeadline } from "../lib/types";

interface Props {
  model: Model;
  t: number;
  live: boolean;
  lang: Lang;
  head?: SiteHeadline | null;
  onJump: (t: number) => void;
}

export function whereText(m: Model, e: Ev): string {
  const b = eventBlocker(m, e);
  if (!b) return `azimuth ${fmtAz(e.az_deg)}`;
  const what = b.local ? "the ground slope right at the site" : b.phrase ?? "terrain";
  return `${what}, ${fmtKm(b.dist_km)} away, azimuth ${fmtAz(e.az_deg)}${b.approx && !b.local ? " (ridge taken from the 2 m horizon)" : ""}`;
}

function Band({ e }: { e: Ev }) {
  const u = e.unc;
  if (!u) return null;
  const narrow = u.spread_p10_p90_h < 0.1;
  return (
    <div className="tile-band" title={`From ${u.n_clones_matched} of NASA's 100 DEM error clones (PGDA product 78)`}>
      <span className="chip chip-quiet">P10–P90</span> {fmtTime(Date.parse(u.p10_utc), true)} to {fmtTime(Date.parse(u.p90_utc), true)} UTC ({fmtSpan(u.spread_p10_p90_h)} spread)
      {narrow ? ": DEM error near the site barely matters" : ": a grazing event, sensitive to metre-scale terrain error"}
      {presentFrac(u) < 0.995 ? `. A fragile event: it happens in ${Math.round(presentFrac(u) * 100)}% of terrain versions` : ""}
    </div>
  );
}

export default function NowPanel({ model: m, t, live, lang, head, onJump }: Props) {
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
      openLine = `On a flat 0° horizon the Sun is already down${back && exact ? ` until ${fmtDateTime(back.t, false)}` : ""}: this site sees it only because it stands above its surroundings.`;
    } else if (!sunUp && openUp) {
      const gone = nextOpen(m, "sun", "set", t);
      openLine = `On a flat 0° horizon the Sun is up right now${gone && exact ? `, until ${fmtDateTime(gone.t, false)}` : ""}. A tool that ignores terrain calls this spot lit.`;
    } else if (openEv) {
      const gap = (openEv.t - sunEv.t) / HOUR;
      openLine = `A tool without terrain (flat 0° horizon) says ${openWhen(openEv.t)}: ${fmtSpan(gap)} ${gap >= 0 ? "later" : "earlier"}.`;
    } else openLine = `On a flat 0° horizon the Sun would not ${sunUp ? "set" : "rise"} before the data ends.`;
  }

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

  return (
    <section aria-label="Current conditions">
      <p className="headline" lang={lang}>
        {headline}
      </p>
      <div className="sr-only" aria-live="polite">
        {spoken}
      </div>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label" lang={lang}>
            {tr(lang, "sunElev")}
          </div>
          <div className={`tile-value ${sun.clearance < 0 ? "neg" : ""}`}>
            {sun.clearance >= 0 ? "+" : "−"}
            {Math.abs(sun.clearance).toFixed(2)}°
          </div>
          <div className="tile-state" lang={lang}>
            <span className={`dot ${sunUp ? "dot-sun" : "dot-dark"}`} aria-hidden />
            {sunState}
          </div>
          <div className="tile-sub">
            Disc centre {fmtDeg(sun.el)} above the ideal sphere; terrain horizon {fmtDeg(sun.hor)} toward {fmtAz(sun.az)}. Sun disc is 0.53° wide.
          </div>
        </div>

        <div className="tile tile-wide">
          <div className="tile-label" lang={lang}>
            {tr(lang, sunUp ? "sunsetIn" : "sunriseIn")}
          </div>
          {sunEv ? (
            <>
              <div className="tile-value">{fmtDur(sunEv.t - t, secs)}</div>
              <div className="tile-state">
                <button className="linkish" onClick={() => onJump(sunEv.t)} title="Move the time cursor to this event">
                  {fmtDateTime(sunEv.t)}
                </button>
              </div>
              <div className="tile-cause">
                <span className="chip chip-why">Why here</span> {sunUp ? "Sets behind terrain" : "Rises over terrain"}: {whereText(m, sunEv)}.
              </div>
              <Band e={sunEv} />
              {sunBack && <div className="tile-sub">Then dark for {fmtDur(sunBack.t - sunEv.t)}.</div>}
              {sunGone && <div className="tile-sub">Then lit for {fmtDur(sunGone.t - sunEv.t)}.</div>}
              {openLine && <div className="tile-open">{openLine}</div>}
            </>
          ) : (
            <div className="tile-state big" lang={lang}>
              {tr(lang, sunUp ? "noSunset" : "noSunrise")} ({fmtDateTime(m.tEnd)})
            </div>
          )}
        </div>

        <div className="tile">
          <div className="tile-label" lang={lang}>
            {tr(lang, "earthTitle")}
          </div>
          {earthEv ? (
            <>
              <div className="tile-value">{dur(earthEv)}</div>
              <div className="tile-state" lang={lang}>
                <span className={`dot ${earthUp ? "dot-earth" : "dot-dark"}`} aria-hidden />
                {tr(lang, earthUp ? "earthsetIn" : "earthriseIn")}:{" "}
                <button className="linkish" onClick={() => onJump(earthEv.t)}>
                  {fmtDateTime(earthEv.t, false)}
                </button>
              </div>
              <div className="tile-sub" lang={lang}>
                {earthState}. {earthUp ? "Sets behind terrain" : "Rises over terrain"}: {whereText(m, earthEv)}.
              </div>
            </>
          ) : (
            <>
              <div className="tile-state big" lang={lang}>
                <span className={`dot ${earthUp ? "dot-earth" : "dot-dark"}`} aria-hidden />
                {earthUp && !farSide ? tr(lang, "earthAlways") : earthState}
              </div>
              {earthUp && <div className="tile-sub">Earth is {fmtDeg(earth.clearance, 1)} above the terrain toward {fmtAz(earth.az)}; it only wobbles with libration.</div>}
            </>
          )}
        </div>

        <div className="tile">
          <div className="tile-label" lang={lang}>
            {tr(lang, "bothTitle")}
          </div>
          {bothNow ? (
            <>
              <div className="tile-value">{bothNow[1] >= m.tEnd ? "to end of data" : fmtDur(bothNow[1] - t)}</div>
              <div className="tile-state" lang={lang}>
                <span className="dot dot-both" aria-hidden />
                {tr(lang, "bothEndsIn")}
              </div>
              <div className="tile-sub">Power and a direct link at the same time: the usable operations window.</div>
            </>
          ) : nextBoth ? (
            <>
              <div className="tile-value">{fmtDur(nextBoth[0] - t)}</div>
              <div className="tile-state" lang={lang}>
                <span className="dot dot-dark" aria-hidden />
                {tr(lang, "bothStartsIn")}
              </div>
              <div className="tile-sub">
                Opens{" "}
                <button className="linkish" onClick={() => onJump(nextBoth[0])}>
                  {fmtDateTime(nextBoth[0], false)}
                </button>{" "}
                and lasts {fmtDur(nextBoth[1] - nextBoth[0])}.
              </div>
            </>
          ) : (
            <div className="tile-state big" lang={lang}>
              <span className="dot dot-dark" aria-hidden />
              {farSide ? tr(lang, "farSide") : tr(lang, "noBoth")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
