# GeoGuesser — De Lijn Bus Stop Identifier

A Tinder-style swipe game that helps identify a De Lijn bus stop from a photo. The user draws a radius on a map, optionally filters by distance to the nearest tram stop, then swipes through Mapillary street-view photos of candidate stops until they find a match.

## Commands

```bash
bun run dev          # Start server with hot reload (port 3000)
bun run build        # Compile Vue frontend → public/ (bun-plugin-vue + tailwindcss CLI → public/styles.css)
bun run start        # Build + start server (production)
bun run typecheck    # tsc --noEmit
bun run lint         # eslint . (type-aware; catches floating promises, type errors)
```

After frontend changes, rebuild manually: `bun run build`. Assets use content-based hashing (e.g., `main.{hash}.js`) for automatic cache-busting — no hard refresh needed.

## Tailwind CSS

Tailwind v4 is compiled via `@tailwindcss/cli` at build time. Input: `frontend/styles.css` (`@import "tailwindcss"`). Output: `public/styles.css` (only used classes, ~12KB). Do not use the Play CDN — it shows a production warning and injects styles async.

## Architecture

```
server.ts                        # Elysia entry point, serves public/ as static
src/
  models/
    response.ts                  # TypeBox response schemas
  services/
    stop.service.ts              # Stop-related business logic
    queue.service.ts             # Queue generation logic
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
  ingest-stops.ts                # Downloads De Lijn GTFS, inserts all stops into PostGIS; also creates stop_images table
  ingest-tram-stops.ts           # Extracts tram stops, computes nearest_tram_stop_m on stops
public/                          # Built frontend output (gitignored)
```

## Database

PostGIS runs via Docker Compose (`docker compose up -d`). Default `DATABASE_URL`: `postgres://postgres:postgres@localhost:5432/postgres`.

Tables:
- `stops` — all De Lijn stops (~31k), `stop_id INTEGER PK`, `location GEOGRAPHY(POINT,4326)`, `nearest_tram_stop_m`, `images_last_fetched_at TIMESTAMPTZ`
- `tram_stops` — tram-only subset, FK → `stops`, used for distance filtering
- `stop_images` — on-demand Mapillary images: `stop_id INTEGER FK`, `mapillary_image_id BIGINT`, `url TEXT`, `distance_m`, `fetched_at TIMESTAMPTZ`; images are fetched on first stop request and refreshed after 20 days; stops with no nearby images are not retried for 24 hours

Indexes: `stops_location_idx` (GIST), `stop_images_stop_id_idx` (btree), `stop_images_stop_mapillary_idx` (unique btree on `stop_id, mapillary_image_id`).

## Backend Architecture

Single Elysia instance with service layer pattern:
- **Routes** (`server.ts`) — HTTP handlers with TypeBox validation and response schemas, error handling via `.onError()`
- **Services** (`src/services/`) — Business logic, database queries, pure TypeScript (no Elysia types)
- **Models** (`src/models/response.ts`) — TypeBox schemas for response validation and Eden Treaty type inference

Services use `Bun.sql` directly (no database wrapper). Route handlers use `t.Numeric()` for query parameters to auto-coerce strings to numbers. Error handler uses `status()` function for consistent error responses. Logging handled by `@bogeychan/elysia-logger` with JSON output for Grafana/Loki aggregation.

**Response compression**: Multi-algorithm compression via `mapResponse` hook for JSON responses > 1KB. Priority: gzip (77.1% reduction, best) → deflate (77.1%) → zstd (75.2%, 3x faster). Check `Accept-Encoding` header, use `Bun.gzipSync()`/`Bun.deflateSync()`/`Bun.zstdCompressSync()`, set appropriate headers.

**API efficiency**: Include related data in responses when always needed together (e.g., stop details + images) to avoid multiple network calls. Prefer single endpoints over separate fetches for coupled data.

**Response caching**: In-memory Map-based cache with 5-minute TTL for expensive endpoints (`/api/stops/locations`, `/api/stops/:id`). Use `derive` to inject cached data into context and `onAfterHandle` to store responses BEFORE `mapResponse` compression. Route handlers check for cached data and return early with type assertion `as typeof Response.static`.

## Data Ingestion (one-time setup)

Run all at once (or use as a K8s init pod: `command: ["bun", "scripts/ingest-all.ts"]`):
```bash
bun run ingest
```

Or individually in order:
```bash
bun scripts/ingest-stops.ts         # ~30k stops from GTFS + creates stop_images table
bun scripts/ingest-tram-stops.ts    # tram subset + nearest_tram_stop_m
```

Images are fetched on demand at serve time — no image ingestion step required. Requires `MAPILLARY_API_TOKEN` at runtime.

## Frontend Patterns

- **Prefetching with cache**: Use `Map` for cache and `in-flight` requests to prevent duplicate fetches. Check cache first, then fetch if needed. Store results with timestamp for TTL-based expiration.
- **Cache cleanup**: Clear Maps in `onUnmounted` to prevent memory leaks. Implement cleanup function to remove stale entries (e.g., 30s TTL).
- **Race condition prevention**: Track in-flight requests in a Map; don't start new request if one is already pending for the same key.
- **Eden Treaty static types**: `Stop`, `Queue`, `Locations` are exported from `src/models/response.ts` (`typeof Schema.static`). Import these in frontend components instead of manually re-typing response shapes.
- **Aborting background async loops**: Use a `let aborted = false` module-level flag; check `if (aborted) return` at the top of each loop iteration; set `aborted = true` in `onUnmounted` to stop sequential background fetches cleanly.

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `MAPILLARY_API_TOKEN` | Yes | Mapillary Graph API token (ingestion + runtime URL resolution) |

## Gotchas

- **Leaflet init timing**: The map container must have a non-zero height before `L.map()` is called. `useInitOnResize` uses a `ResizeObserver` to defer init until the wrapper has a real height, then explicitly sets `mapEl.style.height` in pixels before initializing.
- **`bun-plugin-vue` static hoisting**: Vue refs on `<div ref="x">` inside static subtrees can point to the wrong element. Ensure the ref target is not hoisted by making it dynamic or a direct child of a dynamic parent.
- **Elysia static cache**: The static plugin sets `Cache-Control: max-age=86400`. Built assets use content-based hashing for automatic cache-busting (`main.{hash}.js`, `styles.{hash}.css`) — browsers fetch fresh versions after rebuild.
- **`Bun.sql` array params**: Use `{${ids.join(",")}}::integer[]` (or `::text[]`) syntax — tagged template literals don't serialize JS arrays as Postgres array literals. Match the cast type to the column type.
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
- **`Bun.file().arrayBuffer()` returns a Promise**: Unlike `fs.readFile()` which returns a Buffer directly, `Bun.file().arrayBuffer()` must be awaited. For synchronous hashing, use `await readFile(path)` instead.
- **`t.Numeric()` for string-origin params**: Use `t.Numeric()` instead of `t.Number()` for both query parameters and path params (`:id`) — both arrive as strings. Elysia coerces `"123"` → `123` at runtime.
- **`status()` function for error responses**: Use `return status(code, payload)` in both route handlers and `onError` hooks. Do not use `set.status` — `status()` is cleaner and works in all contexts.
- **Type-aware ESLint**: ESLint doesn't type-check by default. Enable with `parserOptions.projectService: true` and rules like `@typescript-eslint/no-floating-promises`, `@typescript-eslint/no-misused-promises`.
- **`void` for fire-and-forget promises**: Use `void promiseCall()` to mark intentionally unhandled promises (prefetching, event handlers) and satisfy linter.
- **Vue SFC type checking**: Use `vue-tsc --noEmit` instead of `tsc --noEmit` for proper type checking in `.vue` files. `tsc` has limited Vue SFC support and misses type errors that the IDE catches.
- **Bun compression APIs**: `Bun.zstdCompressSync()` returns a Buffer that requires `new Uint8Array(compressed)` for Response constructor, while `Bun.gzipSync()` and `Bun.deflateSync()` work directly. Bun has no brotli API.
- **Elysia lifecycle hooks order**: `onRequest` → `onBeforeHandle` → route handler → `onAfterHandle` → `mapResponse` → `onAfterResponse`. Use `onAfterHandle` (not `onAfterResponse`) when caching data to avoid caching Response objects created by `mapResponse`.
- **Elysia caching with compression**: Cache original data in `onAfterHandle` before compression, not in `onAfterResponse` which receives transformed Response objects. Use `derive` to inject cached data into route context, not `onRequest` return values (bypasses `mapResponse`).
- **Type assertions for cached data**: When returning cached data of type `unknown`, use type assertion like `return cachedData as typeof StopResponse.static` to satisfy TypeBox response schemas.
- **Mapillary image URL expiry**: Signed CDN URLs (`scontent.XX.fbcdn.net`) have `Cache-Control: max-age=1209600` (14 days) and an `oe` hex expiry param of ~30 days. Safe to store in DB; `stop.service.ts` refreshes after 20 days.
- **One-off scripts**: Use `bun -e "..."` not `node -e "..."` for inline evaluation.
- **`reactive(Set)` reactivity**: `reactive(new Set()).clear()` / `.add()` can fail to trigger re-renders in edge cases (e.g. when flush batches across watcher + component update). Use `ref(new Set())` with full replacement — `s.value = new Set()` / `s.value = new Set([...s.value, x])` — ref assignment always triggers reactivity.
- **Vue `@load` stale event race**: If `<img>` elements share a numeric `:key` across stops, a previous stop's in-flight `@load` can fire after tracked state is cleared, incorrectly marking a tile as loaded. Use a semantically meaningful key (e.g. `:key="img.url"`) — Vue destroys and recreates the element when the URL changes, eliminating stale events.
- **CSS shimmer direction**: Animating `background-position` for shimmer effects can appear reversed depending on `background-size`. Use `translateX(-100% → 100%)` on a `::after` pseudo-element with `overflow: hidden` on the parent for reliable left-to-right direction.
