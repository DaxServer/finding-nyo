import { Elysia } from "elysia";
import { sql } from "../db";

export const locationsRoute = new Elysia().get("/api/stops/locations", async () => {
  const rows = await sql`
    SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, nearest_tram_stop_m
    FROM stops
  ` as { lat: number; lng: number; nearest_tram_stop_m: number | null }[];
  return { locations: rows };
});
