// Copies the engine's output into the dashboard's public data folder.
//   npm run sync-data                 (engine output at ../out)
//   npm run sync-data -- <engine-dir> (or set LUNARNAV_ENGINE_DIR)
// Re-run after every engine precompute. Nothing here changes the engine files.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(process.argv[2] ?? process.env.LUNARNAV_ENGINE_DIR ?? join(here, "..", ".."));
const out = join(engine, "out");
const dest = join(here, "..", "public", "data");

if (!existsSync(join(out, "sites", "index.json"))) {
  console.error(`No engine output at ${out} (expected sites/index.json). Pass the engine folder as an argument.`);
  process.exit(1);
}

rmSync(join(dest, "sites"), { recursive: true, force: true });
mkdirSync(join(dest, "sites"), { recursive: true });

let n = 0;
let bytes = 0;
for (const f of readdirSync(join(out, "sites"))) {
  if (!f.endsWith(".json")) continue;
  // re-serialise without whitespace: same content, smaller download
  const text = JSON.stringify(JSON.parse(readFileSync(join(out, "sites", f), "utf8")));
  writeFileSync(join(dest, "sites", f), text);
  bytes += text.length;
  n++;
}
console.log(`sites: ${n} files, ${(bytes / 1e6).toFixed(2)} MB`);

const report = join(out, "validation_report.json");
if (existsSync(report)) {
  writeFileSync(join(dest, "validation_report.json"), JSON.stringify(JSON.parse(readFileSync(report, "utf8"))));
  console.log("validation_report.json copied");
} else {
  console.warn("validation_report.json missing: the Evidence page will say so");
}

// Optional base map for the south-polar site picker: named IAU features from
// the engine's gazetteer, cut down to what the map draws.
const gaz = join(engine, "data", "gazetteer", "moon_features.json");
if (existsSync(gaz)) {
  const all = JSON.parse(readFileSync(gaz, "utf8"));
  const keep = all
    .filter((f) => f.lat <= -78 && f.diam_km >= 4 && /Crater|Mons|Satellite/.test(f.type))
    .map((f) => ({ n: f.name, lat: +f.lat.toFixed(3), lon: +f.lon.toFixed(3), d: +f.diam_km.toFixed(1), t: f.type.startsWith("Mons") ? "m" : "c" }));
  writeFileSync(join(dest, "features_south.json"), JSON.stringify(keep));
  console.log(`features_south.json: ${keep.length} named features south of 78S`);
} else {
  console.warn("gazetteer not found: the polar map will show sites without crater outlines");
}
