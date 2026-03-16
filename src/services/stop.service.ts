import { sql } from 'bun'

const MAPILLARY_API = 'https://graph.mapillary.com/images'
const BBOX_DELTA = 0.001
const IMAGE_LIMIT = 20
const RESULT_COUNT = 4
const REFRESH_AFTER_DAYS = 20
const RETRY_EMPTY_AFTER_HOURS = 24

const TOKEN = process.env['MAPILLARY_API_TOKEN']

export interface ServiceLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function fetchAndStoreImages(stopId: number, lat: number, lng: number, log: ServiceLogger): Promise<{ mapillary_image_id: number; url: string; distance_m: number }[]> {
  await sql`UPDATE stops SET images_last_fetched_at = NOW() WHERE stop_id = ${stopId}`

  if (!TOKEN) {
    log.warn(`stop ${stopId}: skipping image fetch — MAPILLARY_API_TOKEN not set`)
    return []
  }

  const west = lng - BBOX_DELTA
  const east = lng + BBOX_DELTA
  const south = lat - BBOX_DELTA
  const north = lat + BBOX_DELTA

  const res = await fetch(
    `${MAPILLARY_API}?fields=id,thumb_2048_url,computed_geometry&bbox=${west},${south},${east},${north}&limit=${IMAGE_LIMIT}&access_token=${TOKEN}`
  )
  if (!res.ok) {
    log.error(`stop ${stopId}: Mapillary bbox fetch failed — ${res.status} ${res.statusText}`)
    return []
  }

  const data = await res.json() as {
    data: {
      id: string
      thumb_2048_url: string | null
      computed_geometry: { coordinates: [number, number] } | null
    }[]
  }

  const images = (data.data ?? [])
    .filter(img => img.computed_geometry != null && img.thumb_2048_url != null)
    .map(img => {
      const [imgLng, imgLat] = img.computed_geometry!.coordinates
      return {
        mapillary_image_id: Number(img.id),
        url: img.thumb_2048_url!,
        distance_m: haversineM(lat, lng, imgLat!, imgLng!),
      }
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, RESULT_COUNT)

  if (images.length === 0) {
    log.info(`stop ${stopId}: no nearby Mapillary images found`)
    return []
  }

  await sql.begin(async (tx) => {
    for (const img of images) {
      await tx`
        INSERT INTO stop_images (stop_id, mapillary_image_id, url, distance_m, fetched_at)
        VALUES (${stopId}, ${img.mapillary_image_id}, ${img.url}, ${img.distance_m}, NOW())
        ON CONFLICT (stop_id, mapillary_image_id) DO UPDATE
          SET url = EXCLUDED.url, distance_m = EXCLUDED.distance_m, fetched_at = NOW()
      `
    }
  })

  log.info(`stop ${stopId}: stored ${images.length} images`)
  return images
}

export class StopService {
  static async findById(id: number, log: ServiceLogger) {
    const rows = await sql`
      SELECT stop_id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
             images_last_fetched_at
      FROM stops
      WHERE stop_id = ${id}
    `
    const stop = rows[0] as { stop_id: number; name: string; lat: number; lng: number; images_last_fetched_at: Date | null } | undefined
    if (!stop) return null

    const imageRows = await sql`
      SELECT mapillary_image_id, url, distance_m, fetched_at
      FROM stop_images
      WHERE stop_id = ${id}
      ORDER BY distance_m
    ` as { mapillary_image_id: number; url: string; distance_m: number; fetched_at: Date }[]

    const now = Date.now()

    if (imageRows.length > 0) {
      const ageMs = now - imageRows[0]!.fetched_at.getTime()
      const refreshThresholdMs = REFRESH_AFTER_DAYS * 86400 * 1000
      if (ageMs > refreshThresholdMs) {
        log.info(`stop ${id}: images are ${Math.floor(ageMs / 86400000)}d old — refreshing in background`)
        void fetchAndStoreImages(id, stop.lat, stop.lng, log)
      }
      return { stop_id: stop.stop_id, name: stop.name, lat: stop.lat, lng: stop.lng, images: imageRows.map(r => ({ url: r.url, distance_m: r.distance_m })) }
    }

    const lastFetched = stop.images_last_fetched_at
    const retryThresholdMs = RETRY_EMPTY_AFTER_HOURS * 3600 * 1000
    if (!lastFetched || now - lastFetched.getTime() > retryThresholdMs) {
      log.info(`stop ${id}: no images cached — fetching from Mapillary`)
      const images = await fetchAndStoreImages(id, stop.lat, stop.lng, log)
      return { stop_id: stop.stop_id, name: stop.name, lat: stop.lat, lng: stop.lng, images: images.map(r => ({ url: r.url, distance_m: r.distance_m })) }
    }

    log.info(`stop ${id}: no images and retry cooldown active — returning empty`)
    return { stop_id: stop.stop_id, name: stop.name, lat: stop.lat, lng: stop.lng, images: [] }
  }

  static async getAllLocations() {
    const rows = await sql`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, nearest_tram_stop_m
      FROM stops
    ` as { lat: number; lng: number; nearest_tram_stop_m: number | null }[]
    return rows
  }

  static async findNearby(lat: number, lng: number, radius_m: number, min_tram_m: number) {
    const wkt = `SRID=4326;POINT(${lng} ${lat})`
    const rows = await sql`
      SELECT stop_id
      FROM stops
      WHERE ST_DWithin(location, ST_GeogFromText(${wkt}), ${radius_m})
        AND nearest_tram_stop_m >= ${min_tram_m}
      ORDER BY RANDOM()
    `
    return rows.map((r: { stop_id: number }) => r.stop_id)
  }
}
