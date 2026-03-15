import { Elysia, t } from "elysia";
import { sql } from "../db";

export const stopRoute = new Elysia().get(
  "/api/stops/:id",
  async ({ params, status }) => {
    const rows = await sql`
      SELECT stop_id, name, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
      FROM stops
      WHERE stop_id = ${params.id}
    `;
    const row = rows[0];
    if (!row) return status(404, { error: `Stop not found: ${params.id}` });
    return {
      stop_id: row.stop_id as string,
      name: row.name as string,
      lat: row.lat as number,
      lng: row.lng as number,
    };
  },
  {
    params: t.Object({ id: t.String() }),
  }
);
