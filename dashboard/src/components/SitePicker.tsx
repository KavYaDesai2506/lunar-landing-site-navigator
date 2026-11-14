import { useEffect, useMemo, useRef, useState } from "react";
import { fmtLat, fmtLon, normLon, roundCoord } from "../lib/format";
import { setState, useAppState } from "../lib/state";
import type { SiteHeadline } from "../lib/types";

const GROUPS: [SiteHeadline["group"], string][] = [
  ["artemis", "Artemis III candidate regions"],
  ["polar", "South-polar candidates"],
  ["mission", "Robotic missions"],
  ["apollo", "Apollo"],
];

/**
 * "-89.45, 222.84", "89.45 S 222.84 E", "89.45°S, 137.16°W": latitude then longitude.
 * Returns east-positive longitude in [0, 360), or null when the text is not a coordinate pair.
 */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(text.replace(/[−–]/g, "-"));
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2]) lat = Math.abs(lat) * (m[2].toUpperCase() === "S" ? -1 : 1);
  if (m[4] && m[4].toUpperCase() === "W") lon = -Math.abs(lon);
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -360 || lon > 360) return null;
  return { lat: roundCoord(lat), lon: normLon(lon) };
}

type Option = { key: string; label: string; hint?: string; group?: string; run: () => void };

/** One box for "where": type a site name or a latitude, longitude pair. */
export default function SitePicker({ sites, current }: { sites: SiteHeadline[]; current: string }) {
  const s = useAppState();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const options = useMemo(() => {
    const out: Option[] = [];
    const q = text.trim().toLowerCase();
    const ll = parseLatLon(text);
    if (ll) {
      out.push({
        key: "custom",
        label: `Analyse ${fmtLat(ll.lat)}, ${fmtLon(ll.lon)}`,
        hint: "your own point, computed live",
        run: () => setState({ view: "site", site: "custom", lat: ll.lat, lon: ll.lon, mast: ["0", "2", "10"].includes(s.mast) ? s.mast : "2" }, { push: true }),
      });
    }
    for (const [g, label] of GROUPS) {
      for (const h of sites) {
        if (h.group !== g) continue;
        if (q && !ll && !h.name.toLowerCase().includes(q) && !h.id.includes(q)) continue;
        if (ll) continue;
        out.push({
          key: h.id,
          label: h.name,
          hint: `${fmtLat(h.lat, 2)}, ${fmtLon(h.lon, 2)}`,
          group: label,
          run: () => setState({ view: "site", site: h.id, lat: null, lon: null, mast: s.site === "custom" ? "2" : s.mast }, { push: true }),
        });
      }
    }
    if (!ll) out.push({ key: "map", label: "Pick a point on the map…", hint: "or type latitude, longitude here", run: () => setState({ view: "sites" }) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, sites, s.mast, s.site]);

  useEffect(() => setActive(0), [text]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // a Start here job asks for the picker: open it with the list showing
  useEffect(() => {
    if (s.hl !== "picker") return;
    setText("");
    setOpen(true);
    input.current?.focus({ preventScroll: true });
  }, [s.hl]);

  useEffect(() => {
    if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    setText("");
    input.current?.blur();
    o.run();
  };

  let lastGroup: string | undefined;
  return (
    <div className="picker" ref={box} data-hl="picker">
      <label className="ctl-label" htmlFor="site-input">
        Landing site or lat, lon
      </label>
      <div className="picker-box">
        <input
          id="site-input"
          ref={input}
          className="input select-big"
          role="combobox"
          aria-expanded={open}
          aria-controls="site-list"
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `site-opt-${options[active].key}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={open ? "Type a name, or −89.45, 222.84" : undefined}
          value={open ? text : current}
          onFocus={() => {
            setText("");
            setOpen(true);
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) setOpen(true);
              else setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open) choose(options[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
        />
        <button
          type="button"
          className="picker-caret"
          tabIndex={-1}
          aria-label={open ? "Close the site list" : "Open the site list"}
          onClick={() => {
            if (open) setOpen(false);
            else input.current?.focus();
          }}
        >
          ▾
        </button>
        {open && (
          <ul className="picker-list" id="site-list" role="listbox" ref={list} aria-label="Sites">
            {options.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group ?? lastGroup;
              return (
                <li key={o.key} role="presentation">
                  {head && <div className="picker-group">{head}</div>}
                  <div
                    id={`site-opt-${o.key}`}
                    role="option"
                    aria-selected={i === active}
                    className={`picker-opt${o.key === "custom" ? " custom" : ""}${o.key === s.site ? " current" : ""}`}
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                  >
                    <span>{o.label}</span>
                    {o.hint && <span className="picker-hint">{o.hint}</span>}
                  </div>
                </li>
              );
            })}
            {options.length === 1 && options[0].key === "map" && <li className="picker-empty">No site by that name. For your own point type latitude, longitude: −89.45, 222.84</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
