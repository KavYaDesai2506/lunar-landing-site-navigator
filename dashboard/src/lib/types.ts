// Shapes written by the science engine. Field reference: docs/DATA_CONTRACT.md.

export type Target = "sun" | "earth";
export type EventKind = "first_light" | "full_disc" | "partial" | "last_light";

export interface SiteHeadline {
  id: string;
  name: string;
  group: "artemis" | "polar" | "mission" | "apollo" | "custom";
  country: string | null;
  lat: number;
  lon: number;
  sun_avg_pct: number;
  sun_any_pct: number;
  earth_any_pct: number;
  both_pct: number;
  max_dark_h: number;
  far_side: boolean;
  earth_blocked_by_terrain: boolean;
  has_mission: boolean;
  has_uncertainty: boolean;
}

export interface SiteIndex {
  generated_utc: string;
  sites: SiteHeadline[];
}

export interface Blocker {
  phrase: string;
  feature: string | null;
  dist_km: number;
  az_deg: number;
  lat: number;
  lon: number;
  h_m: number;
}

export interface SiteEvent {
  target: Target;
  kind: EventKind;
  utc: string;
  az_deg: number;
  el_deg: number;
  horizon_el_deg: number;
  blocker?: Blocker;
}

export interface Horizon {
  n_az: number;
  az_step_deg: number;
  el_deg: number[];
  block_dist_km?: number[];
  block_lat?: number[];
  block_lon?: number[];
  block_h_m?: number[];
  mast_m: number;
  ground_m: number;
}

export interface BodyStats {
  avg_fraction_pct: number;
  any_visible_pct: number;
  full_disc_pct: number;
  max_dark_h: number;
  max_lit_h: number;
}

export interface LongTerm {
  start_utc: string;
  stop_utc: string;
  step_s: number;
  n: number;
  sun: BodyStats;
  earth: BodyStats;
  both_any_pct: number;
}

export interface TrackBody {
  az_cdeg: number[];
  el_mdeg: number[];
  frac_pm: number[];
  ang_radius_deg: number;
}

export interface Track {
  start_utc: string;
  step_s: number;
  n: number;
  sun: TrackBody;
  earth: TrackBody;
}

export interface SensCell {
  dr: number;
  dc: number;
  avg_pct: number;
  vis_pct: number;
}

export interface SensPoint extends SensCell {
  lat: number;
  lon: number;
  ground_m: number;
  bearing_deg: number;
  dist_m: number;
}

export interface Sensitivity {
  res_m: number;
  radius_px: number;
  centre: SensPoint;
  best: SensPoint;
  gain_pp: number;
  cells: SensCell[];
}

export type MissionExpected =
  | "sunset_after_end"
  | "sunset_near_end"
  | "sunset_before_end"
  | "multi_night"
  | "negative_control"
  | "tilt_limited"
  /** added 14 Nov, not scored: landed and lifted off again in daylight (Apollo, Chang'e-6) */
  | "daylight_stay"
  /** added 14 Nov, not scored: no end of mission; end_utc only closes the replayed first day and night (Chang'e-3) */
  | "still_operating";

/** "scored" = one of the validation replays; the other two are shown as replays but never scored. */
export type MissionKind = "scored" | "visit" | "operating";
export function missionKind(r: { expected: MissionExpected }): MissionKind {
  return r.expected === "daylight_stay" ? "visit" : r.expected === "still_operating" ? "operating" : "scored";
}

export interface MissionReplay {
  landed_utc: string;
  end_utc: string;
  end_reason: string;
  end_note?: string;
  expected: MissionExpected;
  sources: string[];
  window: [string, string];
  events: SiteEvent[];
  first_terrain_sunset_after_landing: SiteEvent | null;
  sun_frac_at_end: number;
  end_minus_sunset_h: number | null;
  sunrises_after_landing: string[];
  /** added 14 Nov: height of the Sun's / Earth's centre above the real terrain horizon, degrees; negative = behind terrain */
  sun_clearance_deg_at?: { landed: number; end: number };
  earth_clearance_deg_at?: { landed: number; end: number };
  /** added 13 Nov: flat 0-degree-horizon events over the replay window (no blocker) */
  open_events?: SiteEvent[];
  first_open_sunset_after_landing?: SiteEvent | null;
  /** added 13 Nov: 30-min (SLIM: 1 h) Sun/Earth track over `window`, for the animated replay */
  track?: Track;
}

export interface UncEvent {
  target: Target;
  kind: EventKind;
  utc: string;
  p10_utc: string;
  p50_utc: string;
  p90_utc: string;
  spread_p10_p90_h: number;
  n_clones_matched: number;
  /** share of clones in which the event happens at all (0-1); absent in older files */
  present_frac?: number;
}

export interface Uncertainty {
  n_clones: number;
  inner_km: number;
  mast_m: number;
  window: [string, string];
  method: string;
  scope_note: string;
  events: UncEvent[];
  longterm_sun: {
    baseline_avg_pct: number;
    baseline_vis_pct: number;
    avg_p10_p50_p90: [number, number, number];
    vis_p10_p50_p90: [number, number, number];
    period: [string, string];
  };
}

export interface Site {
  id: string;
  name: string;
  group: SiteHeadline["group"];
  country?: string | null;
  note?: string | null;
  source?: string | null;
  requested: { lat: number; lon: number };
  snapped: { lat: number; lon: number; ground_m: number };
  dem: {
    near: string;
    near_res_m: number;
    far: string;
    far_res_m: number;
    far_km: number;
    /** set by the live engine when it had to fall back to coarser bundled terrain (plain-language note) */
    degraded?: string | null;
  };
  default_mast_m: number;
  horizons: Record<string, Horizon>;
  longterm: Record<string, LongTerm>;
  window: { start_utc: string; stop_utc: string };
  events: Record<string, SiteEvent[]>;
  /** added 13 Nov: events against a flat 0-degree horizon (what a tool without terrain assumes); absent in older files and API builds */
  open_events?: SiteEvent[] | null;
  track: Track;
  sensitivity: Sensitivity | null;
  mission_replay: MissionReplay | null;
  uncertainty?: Uncertainty | null;
  meta: { engine: string; spice?: string; generated_utc?: string; build_s?: number; compute_s?: number };
}

export type ValidationReport = {
  generated_utc: string;
  tests: Record<string, Record<string, Record<string, any>>>;
};

export interface PolarFeature {
  n: string;
  lat: number;
  lon: number;
  d: number;
  t: "c" | "m";
}
