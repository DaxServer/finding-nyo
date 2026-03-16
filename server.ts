import { Elysia, t } from "elysia";
import staticPlugin from "@elysiajs/static";
import { logger } from "@bogeychan/elysia-logger";
import { QueueService } from "./src/services/queue.service";
import { StopService } from "./src/services/stop.service";
import {
  StopResponse,
  QueueResponse,
  LocationsResponse,
  ErrorResponse,
} from "./src/models/response";

// Simple in-memory cache with TTL
interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 86400 * 1000; // 24 hours

function getCacheKey(path: string, query?: Record<string, unknown>): string {
  if (query && Object.keys(query).length > 0) {
    const sortedParams = Object.keys(query)
      .sort()
      .map((k) => `${k}=${JSON.stringify(query[k])}`)
      .join("&");
    return `${path}?${sortedParams}`;
  }
  return path;
}

function getFromCache(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export const app = new Elysia()
  .use(
    logger({
      level: "info",
      autoLogging: true,
    })
  )
  .derive(({ request, set }) => {
    // Check cache for applicable endpoints
    const path = new URL(request.url).pathname;
    const shouldCache = request.method === "GET" &&
      (path === "/api/stops/locations" || path.startsWith("/api/stops/"));

    let cachedData: unknown = null;
    if (shouldCache) {
      const cacheKey = getCacheKey(path);
      cachedData = getFromCache(cacheKey);
      if (cachedData) {
        set.headers["X-Cache"] = "HIT";
      } else {
        set.headers["X-Cache"] = "MISS";
      }
    }

    return {
      cachedData,
      shouldCache,
    };
  })
  .onAfterHandle(({ request, response }) => {
    // Only cache GET requests with successful responses
    if (request.method !== "GET") return;
    if (!response || typeof response !== "object") return;

    const path = new URL(request.url).pathname;
    if (path !== "/api/stops/locations" && !path.startsWith("/api/stops/")) {
      return;
    }

    const cacheKey = getCacheKey(path);
    setCache(cacheKey, response);
  })
  .mapResponse(({ responseValue, request, set }) => {
    // Only compress object responses (JSON)
    if (typeof responseValue !== "object" || responseValue === null) {
      return;
    }

    const jsonString = JSON.stringify(responseValue);
    if (jsonString.length < 1024) {
      return; // Don't compress small responses
    }

    const acceptEncoding = request.headers.get("Accept-Encoding") || "";

    // Try Gzip first (best compression: 77.1% reduction)
    if (acceptEncoding.includes("gzip")) {
      const compressed = Bun.gzipSync(jsonString);
      set.headers["Content-Encoding"] = "gzip";
      set.headers["Content-Length"] = compressed.length.toString();
      set.headers["Content-Type"] = "application/json; charset=utf-8";
      return new Response(compressed);
    }

    // Fallback to Deflate (tied with gzip for best compression)
    if (acceptEncoding.includes("deflate")) {
      const compressed = Bun.deflateSync(jsonString);
      set.headers["Content-Encoding"] = "deflate";
      set.headers["Content-Length"] = compressed.length.toString();
      set.headers["Content-Type"] = "application/json; charset=utf-8";
      return new Response(compressed);
    }

    // Fallback to Zstd (fastest compression, slightly worse ratio)
    if (acceptEncoding.includes("zstd")) {
      const compressed = Bun.zstdCompressSync(Buffer.from(jsonString));
      set.headers["Content-Encoding"] = "zstd";
      set.headers["Content-Length"] = compressed.length.toString();
      set.headers["Content-Type"] = "application/json; charset=utf-8";
      return new Response(new Uint8Array(compressed));
    }

    // No compression supported by client
    return;
  })
  .onError(({ code, error: _error, status }) => {
    if (code === "NOT_FOUND") {
      return status(404, { error: "Resource not found" });
    }
    if (code === "VALIDATION") {
      return status(400, { error: "Validation failed" });
    }
    return status(500, { error: "Internal server error" });
  })
  .use(staticPlugin({ assets: "public", prefix: "/" }))
  .get("/", () => Bun.file("public/index.html"))

  .get("/api/queue", async ({ query }) => {
    const stops = await QueueService.generate(
      query.lat,
      query.lng,
      query.radius_m,
      query.min_tram_m ?? 0
    );
    return { stops };
  }, {
    query: t.Object({
      lat: t.Numeric(),
      lng: t.Numeric(),
      radius_m: t.Numeric(),
      min_tram_m: t.Optional(t.Numeric()),
    }),
    response: {
      200: QueueResponse,
      400: ErrorResponse,
    },
  })

  .get("/api/stops/:id", async ({ cachedData, params, status }) => {
    if (cachedData) return cachedData as typeof StopResponse.static;

    const stop = await StopService.findById(params.id);
    if (!stop) {
      return status(404, { error: `Stop not found: ${params.id}` });
    }
    return stop;
  }, {
    params: t.Object({ id: t.String() }),
    response: {
      200: StopResponse,
      404: ErrorResponse,
    },
  })

  .get("/api/stops/locations", async ({ cachedData }) => {
    if (cachedData) return cachedData as typeof LocationsResponse.static;

    const locations = await StopService.getAllLocations();
    return { locations };
  }, {
    response: {
      200: LocationsResponse,
    },
  })

  .listen(3000);

export type App = typeof app;
console.log("Listening on http://localhost:3000");
