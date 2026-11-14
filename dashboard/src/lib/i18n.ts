// Plain-language strings (English only; Hindi/Gujarati dropped 12 Nov 2026 by team decision).
// Kept as one table so the answer sentence, tiles and explainer wording live in one place.
import type { Lang } from "./state";

type Dict = Record<string, string>;

const en: Dict = {
  sunElev: "Sun above the terrain horizon",
  sunsetIn: "Terrain sunset in",
  sunriseIn: "Terrain sunrise in",
  earthsetIn: "Earthset in",
  earthriseIn: "Earthrise in",
  earthTitle: "Earth (radio link)",
  bothTitle: "Sun and Earth together",
  bothEndsIn: "Both stay up for",
  bothStartsIn: "Next window with both in",
  fullSun: "Full Sun",
  partialSun: "Partial Sun ({p}% of disc)",
  sunHidden: "Sun behind terrain",
  fullEarth: "Earth fully visible",
  partialEarth: "Partial Earth ({p}% of disc)",
  earthLimb: "Earth limb only ({p}%): may be optimistic for DSN links",
  earthHidden: "Earth behind terrain",
  farSide: "Earth never rises here (far side): no direct radio link",
  earthBlocked: "Earth would be up, but terrain hides it from this exact spot",
  earthAlways: "Earth never sets here in this period",
  noSunset: "Sun does not set again before the data ends",
  noSunrise: "Sun does not rise again before the data ends",
  noBoth: "No window with both before the data ends",
  hSunUp: "The Sun is up at {site}, {deg} above the terrain. It sets in {dur}, {cause}.",
  hSunPartial: "At {site} only {p}% of the Sun's disc still shows above the terrain. Last light in {dur}, {cause}.",
  hSunUpNoSet: "The Sun is up at {site}, {deg} above the terrain, and does not set again in this period.",
  hSunDown: "It is dark at {site}: the Sun is behind terrain. It returns in {dur}, {cause}.",
  hSunDownNoRise: "It is dark at {site} and the Sun does not return before the data ends.",
  causeSet: "behind terrain ({where})",
  causeRise: "over terrain ({where})",
  explainTitle: "What am I looking at?",
  explain1: "You are standing at the landing site, turning through all 360° of the horizon. The grey shape is the real lunar terrain, measured by NASA's LOLA laser altimeter.",
  explain2: "Near the Moon's poles the Sun never climbs high. It skims along the horizon, so a single ridge or crater rim decides whether the site is lit or dark.",
  explain3: "That is why moving a lander 100 m, or slipping a launch by a week, can change the hours of sunlight a mission gets.",
};

const ALL: Record<Lang, Dict> = { en };

export function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = ALL[lang][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

