// South-polar stereographic frame shared by the pole map, the site locator and the shaded-relief
// images in public/img (x right = 90° E, y up = 0° E, pole at the centre, R = 1737.4 km).
export const R_MOON = 1737.4;

export function proj(lat: number, lon: number): [number, number] {
  const r = 2 * R_MOON * Math.tan(((90 + lat) * Math.PI) / 360);
  const l = (lon * Math.PI) / 180;
  return [r * Math.sin(l), r * Math.cos(l)];
}

export function unproj(x: number, y: number): [number, number] {
  const r = Math.hypot(x, y);
  const lat = -90 + (Math.atan(r / (2 * R_MOON)) * 360) / Math.PI;
  const lon = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return [lat, lon];
}

/** Half-widths (km) of the three shaded-relief images rendered from NASA LOLA elevation. */
export const RELIEF_KM = [40, 200, 360] as const;
export const RELIEF_CREDIT = "Shaded relief from NASA LOLA elevation (PGDA)";

/** The smallest relief image that covers a map of the given half-width. */
export function reliefFor(halfKm: number): number {
  return RELIEF_KM.find((k) => k >= halfKm) ?? 360;
}

export function reliefUrl(km: number, small = false): string {
  return `${import.meta.env.BASE_URL}img/pole_${km}km${small ? "_480" : ""}.jpg`;
}

/** Great-circle distance on the Moon, km. */
export function moonKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R_MOON * Math.asin(Math.min(1, Math.sqrt(a)));
}
