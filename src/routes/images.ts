import { Elysia, t } from "elysia";
import { sql } from "../db";

export const imagesRoute = new Elysia().get(
  "/api/stops/:id/images",
  async ({ params }) => {
    const rows = await sql`
      SELECT url, distance_m
      FROM stop_images
      WHERE stop_id = ${params.id}
      ORDER BY distance_m
      LIMIT 4
    `;
    return { images: rows as { url: string; distance_m: number }[] };
  },
  {
    params: t.Object({ id: t.String() }),
  }
);
