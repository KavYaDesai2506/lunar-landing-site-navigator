// Deep links from a site into the two NASA-listed map tools for this challenge.
// Both URL formats were checked in the live tools on 13 Nov 2026 by opening the link and reading
// the coordinates back at the centre of the view:
//   QuickMap  ?proj=<id>&prjExtent=<xmin,ymin,xmax,ymax>  in projected metres on the 1737.4 km sphere
//             (27 = south-polar stereographic, 16 = equidistant cylindrical, lon in -180..180)
//   Moon Trek #v=0.1&x=&y=&z=&p=<crs>   metres in the south-polar CRS, degrees in the cylindrical one
// Past 75 N neither format was checked, so those points get a plain link to the tool.
import { fmtLat, fmtLon } from "../lib/format";

const R = 1737400; // m
const RAD = Math.PI / 180;
export const QUICKMAP_HOME = "https://quickmap.lroc.im-ldi.com/";
export const MOONTREK_HOME = "https://trek.nasa.gov/moon/";

/** South-polar stereographic metres, 0 E up (+y), 90 E right (+x): the convention both tools use. */
function southPolar(lat: number, lon: number): [number, number] {
  const r = 2 * R * Math.tan(((90 + lat) * RAD) / 2);
  return [r * Math.sin(lon * RAD), r * Math.cos(lon * RAD)];
}

const lon180 = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export interface MapLink {
  href: string;
  /** false when the link opens the tool's start page instead of this point */
  centred: boolean;
}

/** LROC QuickMap centred on the point, about `spanKm` wide. */
export function quickmapLink(lat: number, lon: number, spanKm = 60): MapLink {
  let x: number, y: number, proj: number;
  if (lat <= -60) [x, y, proj] = [...southPolar(lat, lon), 27];
  else if (lat < 75) [x, y, proj] = [R * lon180(lon) * RAD, R * lat * RAD, 16];
  else return { href: QUICKMAP_HOME, centred: false };
  const hw = (spanKm * 1000) / 2;
  const hh = hw / 2; // the view is roughly 2:1; QuickMap widens the extent to fit the window
  const ext = [x - hw, y - hh, x + hw, y + hh].map((v) => Math.round(v)).join(",");
  return { href: `${QUICKMAP_HOME}?prjExtent=${encodeURIComponent(ext)}&proj=${proj}`, centred: true };
}

/** NASA Moon Trek centred on the point. */
export function moonTrekLink(lat: number, lon: number): MapLink {
  if (lat >= 75) return { href: MOONTREK_HOME, centred: false };
  const polar = lat <= -60;
  const [x, y] = polar ? southPolar(lat, lon).map((v) => Math.round(v)) : [+lon180(lon).toFixed(5), +lat.toFixed(5)];
  const crs = polar ? "urn:ogc:def:crs:IAU2000::30120" : "urn:ogc:def:crs:EPSG::104903";
  return { href: `${MOONTREK_HOME}#v=0.1&x=${x}&y=${y}&z=7&p=${encodeURIComponent(crs)}&d=`, centred: true };
}

export function ExploreLinks({ lat, lon, name }: { lat: number; lon: number; name: string }) {
  const qm = quickmapLink(lat, lon);
  const mt = moonTrekLink(lat, lon);
  const where = `${fmtLat(lat)}, ${fmtLon(lon)}`;
  return (
    <section className="card card-quiet" aria-labelledby="ext-h">
      <h2 id="ext-h">See this spot in NASA's map tools</h2>
      <p className="card-lede">
        Both are resources NASA lists for this challenge. The links open {qm.centred && mt.centred ? `centred on ${where}` : "the tools"} in a new tab, so the imagery can be set beside the horizon computed here.
      </p>
      <div className="ext-links">
        <a className="btn ext-link" href={qm.href} target="_blank" rel="noreferrer" aria-label={`Open ${name} in LROC QuickMap (new tab)`}>
          <span className="ext-name">LROC QuickMap ↗</span>
          <span className="ext-what">{qm.centred ? "LRO camera imagery, about 60 km across" : "opens the start page: search for the coordinates there"}</span>
        </a>
        <a className="btn ext-link" href={mt.href} target="_blank" rel="noreferrer" aria-label={`Open ${name} in NASA Moon Trek (new tab)`}>
          <span className="ext-name">NASA Moon Trek ↗</span>
          <span className="ext-what">{mt.centred ? "JPL's map and 3D viewer (takes up to a minute to load)" : "opens the start page: search for the coordinates there"}</span>
        </a>
      </div>
      <p className="note">
        In QuickMap a terrain-aware sunset for this point takes a dozen or more clicks and minutes of computing; the countdown at the top of this page is the same question answered directly.
      </p>
    </section>
  );
}
