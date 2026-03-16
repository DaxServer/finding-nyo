import { sql } from 'bun'

export class StopService {
  static async findById(id: string) {
    const rows = await sql`
      SELECT stop_id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
      FROM stops
      WHERE stop_id = ${id}
    `
    const stop = rows[0] as { stop_id: string; name: string; lat: number; lng: number } | null
    if (!stop) return null

    const imageRows = await sql`
      SELECT url, distance_m
      FROM stop_images
      WHERE stop_id = ${id}
      ORDER BY distance_m
      LIMIT 4
    `
    return { ...stop, images: imageRows as { url: string; distance_m: number }[] }
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
    return rows.map((r: { stop_id: string }) => r.stop_id)
  }
}
