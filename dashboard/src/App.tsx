import { Component, Suspense, lazy, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { SpaceDefs } from "./components/SpaceArt";
import GuidePanel, { guideDismissed, rememberGuide, useHighlight } from "./components/GuidePanel";
import { loadIndex, loadValidation, useAsync } from "./lib/data";
import { fmtDate, parseUtc } from "./lib/format";
import { DEFAULTS, linkFor, setState, useAppState } from "./lib/state";
import type { View } from "./lib/state";
import SiteView from "./views/SiteView";

const CompareView = lazy(() => import("./views/CompareView"));
const MissionsView = lazy(() => import("./views/MissionsView"));
const EvidenceView = lazy(() => import("./views/EvidenceView"));
const SitesView = lazy(() => import("./views/SitesView"));
const AboutView = lazy(() => import("./views/AboutView"));

// Labels changed in the 14 Nov redesign; the route names behind them did not (see lib/state.ts).
const NAV: [View, string, string][] = [
  ["site", "Explore", "One site: when the light ends, which ridge ends it, how sure we are"],
  ["sites", "Map & custom", "The south-pole map, every preset site, and your own coordinates"],
  ["compare", "Compare", "Up to four sites on one timeline"],
  ["missions", "Missions", "Five real landings replayed against the record"],
  ["evidence", "Evidence", "Every claim tested against a published answer"],
];

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card card-alert" role="alert">
        <h2>This view could not be drawn</h2>
        <p>The data for it has a value the dashboard did not expect: {this.state.error.message}. The other views still work.</p>
        <button className="btn btn-primary" onClick={() => setState({ view: "site", site: DEFAULTS.site, lat: null, lon: null, mast: "2", t: null, tab: null })}>
          Open Shackleton rim
        </button>
      </div>
    );
  }
}

/** Dark unless the visitor chose light: index.html applies the stored choice before first paint. */
function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("lunarnav.theme.v2") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("lunarnav.theme.v2", next);
    } catch {
      /* not persisted */
    }
  };
  return [theme, toggle];
}

/** Two facts a newcomer can check in one click each, read from the engine's own report. */
function TrustBadges() {
  const rep = useAsync(loadValidation, "validation");
  const idx = useAsync(loadIndex, "index");
  const t1 = rep.data?.tests?.T1_ephemeris_vs_horizons;
  const worst = t1 ? Math.max(...Object.values(t1).map((c) => Number(c.max_sep_arcsec)).filter(isFinite)) : NaN;
  const missions = idx.data?.sites.filter((h) => h.has_mission).length ?? 0;
  if (!isFinite(worst) && !missions) return null;
  return (
    <div className="badges">
      {isFinite(worst) && (
        <a className="badge" href={linkFor({ view: "evidence" })} title="Largest difference between this engine's Sun and Earth directions and NASA JPL Horizons. Opens Evidence.">
          ✓ {worst < 0.001 ? worst.toFixed(4) : worst.toFixed(3)}″ vs JPL Horizons
        </a>
      )}
      {missions > 0 && (
        <a className="badge" href={linkFor({ view: "missions" })} title="Real landings replayed against the published record. Opens Missions.">
          ✓ {missions} real missions replayed
        </a>
      )}
    </div>
  );
}

export default function App() {
  const s = useAppState();
  const [theme, toggleTheme] = useTheme();
  const idx = useAsync(loadIndex, "index");
  const [guide, setGuide] = useState(() => !guideDismissed());
  useHighlight(s.hl);

  const showGuide = (open: boolean) => {
    setGuide(open);
    rememberGuide(open);
  };

  useEffect(() => {
    document.documentElement.lang = "en";
    const names: Record<View, string> = { site: "Explore", compare: "Compare", missions: "Missions", evidence: "Evidence", sites: "Map & custom", about: "About us" };
    document.title = `${names[s.view]} · Lunar Landing Site Navigator`;
  }, [s.view]);

  return (
    <>
      <SpaceDefs />
      <header className="topbar">
        <div className="brand">
          <strong>Lunar Landing Site Navigator</strong>
          <TrustBadges />
        </div>
        <nav className="nav" aria-label="Views">
          {NAV.map(([v, label, what]) => (
            <a
              key={v}
              href={linkFor({ view: v })}
              title={what}
              aria-current={s.view === v ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setState({ view: v });
              }}
            >
              {label}
            </a>
          ))}
          <a
            className="nav-quiet"
            href="#/about"
            aria-current={s.view === "about" ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setState({ view: "about" });
            }}
          >
            About
          </a>
        </nav>
        <div className="top-tools">
          <button className="btn" onClick={() => showGuide(!guide)} aria-expanded={guide} aria-controls="guide" title="Five common jobs, one click each">
            Start here
          </button>
          <button className="btn" onClick={toggleTheme} aria-pressed={theme === "dark"} title="Switch between the dark and the light (projector) theme">
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </div>
      </header>
      {guide && <GuidePanel onClose={() => showGuide(false)} />}
      <main>
        {idx.error ? (
          <div className="card card-alert" role="alert">
            <h2>No site data found</h2>
            <p>
              The dashboard reads static files from <code>data/sites/</code>. Run <code>npm run sync-data</code> after the engine's precompute, then reload.
            </p>
          </div>
        ) : (
          <Boundary resetKey={`${s.view}|${s.site}|${s.lat}|${s.lon}|${s.mast}|${s.cmp.join()}|${s.tab}|${s.open}`}>
            <Suspense
              fallback={
                <div className="card loading" role="status">
                  Loading…
                </div>
              }
            >
              {s.view === "site" && <SiteView />}
              {s.view === "compare" && <CompareView />}
              {s.view === "missions" && <MissionsView />}
              {s.view === "evidence" && <EvidenceView />}
              {s.view === "sites" && <SitesView />}
              {s.view === "about" && <AboutView />}
            </Suspense>
          </Boundary>
        )}
      </main>
      {s.view !== "about" && <footer className="footer">
        Terrain: LOLA elevation models from NASA Goddard's PGDA (products 69, 78, 90) and SLDEM2015. Geometry: NAIF SPICE. Feature names: IAU Gazetteer of Planetary Nomenclature. All times UTC.
        {idx.data ? ` Site data computed ${fmtDate(parseUtc(idx.data.generated_utc))}.` : ""} Built for NASA Space Apps 2026; not an official NASA product.{" "}
        <a
          href="#/about"
          onClick={(e) => {
            e.preventDefault();
            setState({ view: "about" });
          }}
        >
          About us
        </a>
      </footer>}
    </>
  );
}
