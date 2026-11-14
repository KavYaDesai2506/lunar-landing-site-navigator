const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const LUNAR_DAY = 29.530589 * DAY;

/** Engine times are UTC, with or without a trailing Z. */
export function parseUtc(s: string): number {
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function fmtDate(ms: number, withYear = true): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? " " + d.getUTCFullYear() : ""}`;
}

export function fmtTime(ms: number, seconds = false): string {
  const d = new Date(ms);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${seconds ? ":" + p2(d.getUTCSeconds()) : ""}`;
}

/** "13 Nov 2026, 16:10 UTC" */
export function fmtDateTime(ms: number, withYear = true): string {
  return `${fmtDate(ms, withYear)}, ${fmtTime(ms)} UTC`;
}

export function isoMinute(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16) + "Z";
}

/** Duration in words: "1 d 5 h 12 min", "3 h 04 min 09 s". */
export function fmtDur(ms: number, withSeconds = false): string {
  let s = Math.max(0, Math.round(Math.abs(ms) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} d`);
  if (d || h) parts.push(`${h} h`);
  if (d < 2) parts.push(`${d || h ? p2(m) : m} min`);
  if (withSeconds && !d) parts.push(`${p2(s)} s`);
  return parts.join(" ");
}

/** Short span for tables: "4.7 h", "12.7 d", "2 min". Input in hours. */
export function fmtSpan(hours: number): string {
  const a = Math.abs(hours);
  if (a < 1 / 60) return "< 1 min";
  if (a < 1) return `${Math.round(a * 60)} min`;
  if (a < 48) return `${a.toFixed(1)} h`;
  return `${(a / 24).toFixed(1)} d`;
}

const WINDS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compass(az: number): string {
  return WINDS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

export function fmtAz(az: number): string {
  return `${Math.round(((az % 360) + 360) % 360) % 360}° ${compass(az)}`;
}

export function fmtDeg(v: number, digits = 2): string {
  return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}°`;
}

export function fmtPct(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`;
}

export function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 20 ? km.toFixed(1) : Math.round(km)} km`;
}

export function fmtLat(lat: number, digits = 4): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? "S" : "N"}`;
}

export function fmtLon(lon: number, digits = 4): string {
  return `${lon.toFixed(digits)}° E`;
}

/** Coordinates are carried at 4 decimals (about 3 m on the Moon): no float noise in URLs or labels. */
export function roundCoord(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** Longitude wrapped to [0, 360) and rounded. */
export function normLon(lon: number): number {
  const v = roundCoord(((lon % 360) + 360) % 360);
  return v >= 360 ? 0 : v;
}

export function downloadText(name: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      const s = c == null ? "" : String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

/** Host name of a URL for link text; null when the string is not a URL (some sources are plain notes). */
export function hostOf(u: string): string | null {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www./, "") : null;
  } catch {
    return null;
  }
}
