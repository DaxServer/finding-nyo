# GeoGuesser — De Lijn Bus Stop Identifier

A Tinder-style swipe game that helps identify a De Lijn bus stop from a photo. The user draws a radius on a map, optionally filters by distance to the nearest tram stop, then swipes through Mapillary street-view photos of candidate stops until they find a match.

## Commands

```bash
bun run dev          # Start server with hot reload (port 3000)
bun run build        # Compile Vue frontend → public/ (bun-plugin-vue + tailwindcss CLI → public/styles.css)
bun run start        # Build + start server (production)
bun run typecheck    # tsc --noEmit
bun run lint         # eslint .
```

After frontend changes, rebuild manually: `bun run build`, then hard-refresh the browser (Elysia static serves with `max-age=86400`).

## Tailwind CSS

Tailwind v4 is compiled via `@tailwindcss/cli` at build time. Input: `frontend/styles.css` (`@import "tailwindcss"`). Output: `public/styles.css` (only used classes, ~12KB). Do not use the Play CDN — it shows a production warning and injects styles async.

## Architecture

```
server.ts                        # Elysia entry point, serves public/ as static
src/
  db.ts                          # Bun.sql singleton (uses DATABASE_URL)
  routes/
    queue.ts                     # GET /api/queue — shuffled stop IDs within radius
    stop.ts                      # GET /api/stops/:id — stop name + lat/lng
    images.ts                    # GET /api/stops/:id/images — reads from stop_images table
frontend/
  api.ts                         # Eden treaty<App> typed client
  App.vue                        # Screen router: setup → game → results
  components/
    AppHeader.vue                # Shared header: "Finding Nyo" branding + optional `right` prop (counter) and `location` prop (shown beside `right` on desktop, on row 2 on mobile)
    SetupScreen.vue              # Leaflet map, pin + radius, tram slider, Start
    GameScreen.vue               # 2×2 photos + mini-map + N/Y keyboard controls
    ResultsScreen.vue            # Matched stop name + Start Over
  composables/
    useInitOnResize.ts           # Defers Leaflet init until container has non-zero height
build-frontend.ts                # Bun.build with bun-plugin-vue, copies index.html → public/
scripts/
  ingest-stops.ts                # Downloads De Lijn GTFS, inserts all stops into PostGIS
  ingest-tram-stops.ts           # Extracts tram stops, computes nearest_tram_stop_m on stops
  fetch-stop-images.ts           # Fetches Mapillary images for all stops, stores in stop_images
public/                          # Built frontend output (gitignored)
```

## Database

PostGIS runs via Docker Compose (`docker compose up -d`). Default `DATABASE_URL`: `postgres://postgres:postgres@localhost:5432/postgres`.

Tables:
- `stops` — all De Lijn stops (~31k), `location GEOGRAPHY(POINT,4326)`, `nearest_tram_stop_m`, `images_fetched BOOLEAN`
- `tram_stops` — tram-only subset, used for distance filtering
- `stop_images` — pre-fetched Mapillary images: `stop_id, url, distance_m`

Indexes: `stops_location_idx` (GIST), `stop_images_stop_id_idx` (btree).

## Data Ingestion (one-time setup)

Run all at once (or use as a K8s init pod: `command: ["bun", "scripts/ingest-all.ts"]`):
```bash
bun run ingest
```

Or individually in order:
```bash
bun scripts/ingest-stops.ts         # ~30k stops from GTFS
bun scripts/ingest-tram-stops.ts    # tram subset + nearest_tram_stop_m
bun scripts/fetch-stop-images.ts    # Mapillary images (sequential, resumable)
```

`fetch-stop-images.ts` is resumable — it skips stops where `images_fetched = TRUE`. Requires `MAPILLARY_API_TOKEN` in the environment.

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `MAPILLARY_API_TOKEN` | For ingestion | Mapillary Graph API token |

## Gotchas

- **Leaflet init timing**: The map container must have a non-zero height before `L.map()` is called. `useInitOnResize` uses a `ResizeObserver` to defer init until the wrapper has a real height, then explicitly sets `mapEl.style.height` in pixels before initializing.
- **`bun-plugin-vue` static hoisting**: Vue refs on `<div ref="x">` inside static subtrees can point to the wrong element. Ensure the ref target is not hoisted by making it dynamic or a direct child of a dynamic parent.
- **Elysia static cache**: The static plugin sets `Cache-Control: max-age=86400`. The JS bundle (`main.js`) is cached — Vue component changes won't appear even after rebuild until cache is bypassed. Use a cache-busting URL (`?v=N`) or close the browser session entirely. Hard refresh alone is not enough.
- **`Bun.sql` array params**: Use `{${ids.join(",")}}::text[]` syntax — tagged template literals don't serialize JS arrays as Postgres array literals.
- **`noUncheckedIndexedAccess`**: Enabled in tsconfig. Array access returns `T | undefined`; use `arr[0]?.prop ?? fallback`.
- **Leaflet CSS**: Must be a static file (`/leaflet.css` copied from `node_modules` in `build-frontend.ts`). Do NOT `import "leaflet/dist/leaflet.css"` in JS — bun bundles it as a JS-injected style tag which fires after ResizeObserver, breaking map initialization.
- **Tailwind v4 buttons**: v4 Preflight removed `cursor: pointer` from buttons. Override in `frontend/styles.css` via `@layer base { button { cursor: pointer; } }`.
- **Elysia 404**: Use `return status(404, payload)` (from handler context) — not `set.status`. `return` skips `onError`; `throw` goes through it.
- **PostGIS search_path**: If the DB role's `search_path` doesn't include `public`, `geography` type won't resolve even after `CREATE EXTENSION postgis` succeeds. Configure `search_path` at the role level (e.g. in OpenTofu) to include `public`.
- **`sql.end()` in ingest scripts**: Ends the shared `Bun.sql` pool — fatal when scripts are `await import()`-ed sequentially by `ingest-all.ts`. Use `if (import.meta.main) await sql.end()` in each script.
- **Mapillary null fields**: `computed_geometry` and thumbnail fields (`thumb_256_url`, `thumb_1024_url`, `thumb_2048_url`, `thumb_original_url`) can be `null` in API responses even when explicitly requested. Filter before mapping.
- **`Bun.sql` repeated params**: Each `${expr}` in a tagged template is a separate `$N` placeholder. Using the same variable twice (e.g. in SELECT and GROUP BY) makes PostgreSQL see different expressions. Wrap in a subquery so the param appears only once.
- **Leaflet default marker images**: `leaflet.css` references `images/marker-icon.png` etc. relative to itself — copy `node_modules/leaflet/dist/images/` to `public/images/` in `build-frontend.ts`. For JS markers, prefer `L.divIcon` to avoid relying on these assets.
- **Leaflet.markercluster CSS**: `MarkerCluster.css` and `MarkerCluster.Default.css` must be copied as static files in `build-frontend.ts` and linked in `index.html` (same pattern as `leaflet.css`).
- **Leaflet.markercluster import**: `import "leaflet.markercluster"` augments `L` with `L.markerClusterGroup()` / `L.MarkerClusterGroup`.
- **Vue reactivity and plain `let` variables**: `computed` and `watch` don't track plain module-level `let` variables (e.g. `let allLocations: Location[] = []`). Use a `ref` flag (e.g. `locationsLoaded = ref(false)`) to signal when non-reactive data has been populated.
- **Leaflet initial map view**: Use `map.fitBounds(L.latLngBounds(locations.map(l => [l.lat, l.lng])), { padding: [20, 20] })` to fit data rather than hardcoding a `setView` lat/lng/zoom.
