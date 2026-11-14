# Hosting the engine API

The dashboard (https://lunar-navigator-omega.vercel.app) is static. Custom coordinates need the FastAPI engine.

**Live: https://lunar-navigator-api.vercel.app.** It runs as a Vercel Python function in a separate project, `lunar-navigator-api`. The dashboard uses it by default, and wakes it with a `/health` call as soon as the page opens.

## Why Vercel and not Render
Render's free plan sleeps after 15 minutes and takes about a minute to wake, and we can't know when judges will look. A Vercel function has no sleep timer: an idle instance cold-starts in about 15 s, and it costs nothing on Hobby.

## Redeploy
```
.venv/Scripts/python scripts/fetch_runtime_data.py    # once per machine: kernels + regional clips + mmap sidecars
.venv/Scripts/python scripts/build_vercel_api.py      # assembles deploy/vercel-api/ (gitignored)
cd deploy/vercel-api && npx vercel@65.14.0 deploy --prod --yes
```

### How the bundle works
- `api/index.py` imports `lunarnav.api`. Vercel rewrites every path to `/api/index?__p=<path>`, and a small ASGI wrapper restores the original path.
- The bundle is about 627 MB. That is over the standard 250 MB function limit, so the project env var `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` is set; it turns on Vercel's large-functions beta.
- Terrain: the 240 m (±505 km) and 20 m (±60 km) south-polar clips ship as memory-mapped `.npy` files behind meta-only `.npz` stubs. The 20 m file is 144 MB, and the Vercel CLI rejects single files over 100 MB, so it ships as two row blocks. They are joined into `/tmp` on the first load in each instance (about 1–2 s).
- Clips downloaded at request time go to `/tmp/lunarnav-clips` (`LUNARNAV_CACHE_DIR`) and last only as long as that instance.
- Function: 2 GB memory, `maxDuration` 300 s, Python 3.12.

## Measured on 12 Nov 2026 (live)
| Request | Time |
|---|---|
| Cold start (`/health`) | ~14 s |
| Warm `/health` | 0.6 s |
| C2 custom point (bundled terrain) | 2.5 s, sun 78.357 % (curated: 78.376 %) |
| −88.9, 120 (bundled terrain) | 1.8 s |
| Mid-latitude 0.674, 23.473 (SLDEM remote) | 26 s |
| −85.5, 30 (new polar region, PGDA remote) | **234 s**. PGDA was slow that night, and 300 s is the limit, so avoid this case in a live demo |
| North polar (lat ≥ 60) | 422 in 0.4 s |

## Fallback: Render
`render.yaml` and `scripts/fetch_runtime_data.py` also deploy the engine to Render (New → Blueprint). On the free plan it sleeps after 15 minutes idle and takes about a minute to wake, so use the paid Starter plan (about $7/month; check the price on Render's pricing page) if it's ever needed. Memory measured locally peaks at about 460 MB, inside the 512 MB limit.

## Smoke test
```
curl https://lunar-navigator-api.vercel.app/health
curl "https://lunar-navigator-api.vercel.app/site?lat=-89.3157&lon=245.94&mast=2"   # C2
curl "https://lunar-navigator-api.vercel.app/site?lat=85&lon=0"                     # 422
```
