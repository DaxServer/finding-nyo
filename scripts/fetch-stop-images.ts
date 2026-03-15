const sql = Bun.sql;

const MAPILLARY_API = "https://graph.mapillary.com/images";
const BBOX_DELTA = 0.001;
const IMAGE_LIMIT = 20;
const RESULT_COUNT = 4;

const TOKEN = process.env["MAPILLARY_API_TOKEN"];
if (!TOKEN) throw new Error("MAPILLARY_API_TOKEN not set");

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS stop_images (
      stop_id    TEXT NOT NULL,
      url        TEXT NOT NULL,
      distance_m DOUBLE PRECISION NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS stop_images_stop_id_idx ON stop_images (stop_id)`;
  await sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS images_fetched BOOLEAN NOT NULL DEFAULT FALSE`;
}

interface StopCoord {
  stop_id: string;
  lat: number;
  lng: number;
}

async function fetchImages(stop: StopCoord): Promise<void> {
  const { stop_id, lat, lng } = stop;
  const west = lng - BBOX_DELTA;
  const east = lng + BBOX_DELTA;
  const south = lat - BBOX_DELTA;
  const north = lat + BBOX_DELTA;

  const url = `${MAPILLARY_API}?fields=id,thumb_2048_url,computed_geometry&bbox=${west},${south},${east},${north}&limit=${IMAGE_LIMIT}&access_token=${TOKEN}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      await sql`UPDATE stops SET images_fetched = TRUE WHERE stop_id = ${stop_id}`;
      return;
    }

    const data = (await res.json()) as {
      data: { id: string; thumb_2048_url: string; computed_geometry: { coordinates: [number, number] } }[];
    };

    const images = (data.data ?? [])
      .map((img) => {
        const [imgLng, imgLat] = img.computed_geometry.coordinates;
        return { url: img.thumb_2048_url, distance_m: haversineM(lat, lng, imgLat!, imgLng!) };
      })
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, RESULT_COUNT);

    await sql.begin(async (tx) => {
      for (const img of images) {
        await tx`INSERT INTO stop_images (stop_id, url, distance_m) VALUES (${stop_id}, ${img.url}, ${img.distance_m})`;
      }
      await tx`UPDATE stops SET images_fetched = TRUE WHERE stop_id = ${stop_id}`;
    });
  } catch (e) {
    console.error(`\nFailed to fetch images for stop ${stop_id}:`, e);
    // Leave images_fetched = FALSE so this stop will be retried on next run
  }
}

await createSchema();

const rows = await sql`
  SELECT stop_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
  FROM stops
  WHERE images_fetched = FALSE
  ORDER BY stop_id
` as StopCoord[];

const total = rows.length;
console.log(`Fetching images for ${total} stops sequentially ...`);

let done = 0;
for (const stop of rows) {
  await fetchImages(stop);
  done++;
  process.stdout.write(`\n  ${done}/${total}`);
}

console.log("\nDone.");
await sql.end();
