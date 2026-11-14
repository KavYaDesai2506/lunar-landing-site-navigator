// "Start here": five jobs, each a deep link that opens the right place and pulses the control to use.
// It launches work instead of explaining it; there is no tour.
import { useEffect } from "react";
import { linkFor, setState } from "../lib/state";
import type { AppState } from "../lib/state";

interface Job {
  label: string;
  go: Partial<AppState>;
  /** a few words shown beside the pulsing control */
  tip?: string;
}

export const JOBS: Job[] = [
  { label: "Check a site", go: { view: "site", hl: "picker" } },
  { label: "Which ridge ends the light?", go: { view: "site", tab: "horizon", hl: "ridge" }, tip: "This terrain ends the light" },
  { label: "Find a landing date", go: { view: "site", tab: "plan", hl: "window" }, tip: "Click any date to land then" },
  { label: "Analyse my own coordinate", go: { view: "sites", hl: "custom" }, tip: "Click the map, or type a point" },
  { label: "Why did Chandrayaan-3 go dark?", go: { view: "missions", open: "chandrayaan3", hl: "mission-chandrayaan3" }, tip: "Press play to watch the sunset" },
];

const SEEN = "lunarnav.guide";

export function guideDismissed(): boolean {
  try {
    return localStorage.getItem(SEEN) === "hidden";
  } catch {
    return false;
  }
}

export function rememberGuide(open: boolean) {
  try {
    if (open) localStorage.removeItem(SEEN);
    else localStorage.setItem(SEEN, "hidden");
  } catch {
    /* not persisted: the panel simply shows again next visit */
  }
}

export default function GuidePanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="guide" id="guide" aria-label="Start here">
      <div className="guide-in">
        <strong className="guide-title">Start here</strong>
        <ul className="guide-jobs">
          {JOBS.map((j) => (
            <li key={j.label}>
              <a
                className="guide-job"
                href={linkFor(j.go)}
                onClick={(e) => {
                  e.preventDefault();
                  // null first, so choosing the same job twice pulses twice
                  setState({ hl: null });
                  setTimeout(() => setState(j.go, { push: true }), 0);
                }}
              >
                {j.label}
              </a>
            </li>
          ))}
        </ul>
        <button className="guide-close" onClick={onClose} aria-label="Hide the Start here panel" title="Hide (reopen from the top bar)">
          Hide ✕
        </button>
      </div>
    </aside>
  );
}

/**
 * Pulse the control a job points at (the element carrying data-hl), scroll it into view, then drop
 * the key from the URL. The element may not exist yet (site data still loading), so look for a while.
 */
export function useHighlight(hl: string | null) {
  useEffect(() => {
    if (!hl) return;
    let el: HTMLElement | null = null;
    let tries = 0;
    let done = 0;
    const find = () => {
      el = document.querySelector<HTMLElement>(`[data-hl="${hl}"]`);
      if (!el) {
        if (++tries > 60) {
          clearInterval(iv);
          setState({ hl: null });
        }
        return;
      }
      clearInterval(iv);
      const tip = JOBS.find((j) => j.go.hl === hl)?.tip;
      if (tip) el.setAttribute("data-tip", tip);
      el.classList.add("hl-pulse");
      const r = el.getBoundingClientRect();
      if (r.top < 120 || r.bottom > window.innerHeight - 20) {
        const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: r.height > window.innerHeight * 0.7 ? "start" : "center" });
      }
      done = window.setTimeout(() => setState({ hl: null }), 5000);
    };
    const iv = window.setInterval(find, 150);
    find();
    return () => {
      clearInterval(iv);
      clearTimeout(done);
      el?.classList.remove("hl-pulse");
      el?.removeAttribute("data-tip");
    };
  }, [hl]);
}
