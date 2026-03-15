import { Elysia, t } from "elysia";
import { sql } from "../db";

export const queueRoute = new Elysia().get(
  "/api/queue",
  async ({ query }) => {
    const lat = parseFloat(query.lat);
    const lng = parseFloat(query.lng);
    const radius_m = parseFloat(query.radius_m);
    const min_tram_m = parseFloat(query.min_tram_m ?? "0");

    const wkt = `SRID=4326;POINT(${lng} ${lat})`;
    const rows = await sql`
      SELECT stop_id
      FROM stops
      WHERE ST_DWithin(location, ST_GeogFromText(${wkt}), ${radius_m})
        AND nearest_tram_stop_m >= ${min_tram_m}
      ORDER BY RANDOM()
    `;

    return { stops: rows.map((r: { stop_id: string }) => r.stop_id) };
  },
  {
    query: t.Object({
      lat: t.String(),
      lng: t.String(),
      radius_m: t.String(),
      min_tram_m: t.Optional(t.String()),
    }),
  }
);
