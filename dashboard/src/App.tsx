import { Component, Suspense, lazy, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loadIndex, useAsync } from "./lib/data";
import { fmtDate, parseUtc } from "./lib/format";
import { linkFor, setState, useAppState } from "./lib/state";
import type { Lang, View } from "./lib/state";
import SiteView from "./views/SiteView";

const CompareView = lazy(() => import("./views/CompareView"));
const MissionsView = lazy(() => import("./views/MissionsView"));
const EvidenceView = lazy(() => import("./views/EvidenceView"));
const SitesView = lazy(() => import("./views/SitesView"));

const NAV: [View, string][] = [
  ["site", "Site"],
  ["compare", "Compare"],
  ["missions", "Missions"],
  ["evidence", "Evidence"],
  ["sites", "All sites + custom"],
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
        <button className="btn btn-primary" onClick={() => setState({ view: "site", site: "shackleton_rim_s", lat: null, lon: null, mast: "2", t: null })}>
          Open Shackleton rim
        </button>
      </div>
    );
  }
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("lunarnav.theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("lunarnav.theme", theme);
    } catch {
      /* not persisted */
    }
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")];
}

export default function App() {
  const s = useAppState();
  const [theme, toggleTheme] = useTheme();
  const idx = useAsync(loadIndex, "index");

  useEffect(() => {
    document.documentElement.lang = "en";
    const names: Record<View, string> = { site: "Site", compare: "Compare", missions: "Missions", evidence: "Evidence", sites: "Sites" };
    document.title = `${names[s.view]} · Lunar Landing Site Navigator`;
  }, [s.view]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <strong>Lunar Landing Site Navigator</strong>
          <span>when the light ends, which ridge ends it, how sure we are</span>
        </div>
        <nav className="nav" aria-label="Views">
          {NAV.map(([v, label]) => (
            <a
              key={v}
              href={linkFor({ view: v })}
              aria-current={s.view === v ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setState({ view: v });
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="top-tools">
          <button className="btn" onClick={toggleTheme} aria-pressed={theme === "dark"} title="Switch between the light (projector) and dark theme">
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </div>
      </header>
      <main>
        {idx.error ? (
          <div className="card card-alert" role="alert">
            <h2>No site data found</h2>
            <p>
              The dashboard reads static files from <code>data/sites/</code>. Run <code>npm run sync-data</code> after the engine's precompute, then reload.
            </p>
          </div>
        ) : (
          <Boundary resetKey={`${s.view}|${s.site}|${s.lat}|${s.lon}|${s.mast}|${s.cmp.join()}`}>
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
          </Suspense>
          </Boundary>
        )}
      </main>
      <footer className="footer">
        Terrain: LOLA elevation models from NASA Goddard's PGDA (products 69, 78, 90) and SLDEM2015. Geometry: NAIF SPICE. Feature names: IAU Gazetteer of Planetary Nomenclature. All times UTC.
        {idx.data ? ` Site data computed ${fmtDate(parseUtc(idx.data.generated_utc))}.` : ""} Built for NASA Space Apps 2026; not an official NASA product.
      </footer>
    </>
  );
}
