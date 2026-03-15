import { join } from "path";

const CACHE_FILE = join(import.meta.dir, "..", "de-lijn-gtfs.zip");
const TRAM_ROUTE_TYPE = "0";

const sql = Bun.sql;

// ----- helpers -----

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const s = line.replace(/\r/g, "");
  while (i <= s.length) {
    if (s[i] === '"') {
      let field = "";
      i++;
      while (i < s.length) {
        if (s[i] === '"' && s[i + 1] === '"') { field += '"'; i += 2; }
        else if (s[i] === '"') { i++; break; }
        else { field += s[i++]; }
      }
      fields.push(field);
      if (s[i] === ",") i++;
    } else {
      const end = s.indexOf(",", i);
      if (end === -1) { fields.push(s.slice(i)); break; }
      fields.push(s.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

function parseIds(csv: string, keyCol: string, filterCol?: string, filterValues?: Set<string>): Set<string> {
  const lines = csv.trim().split("\n");
  const headerLine = lines[0]!;
  if (!headerLine) throw new Error("Empty CSV");
  const header = splitCsvLine(headerLine);
  const ki = header.indexOf(keyCol);
  const fi = filterCol ? header.indexOf(filterCol) : -1;

  const result = new Set<string>();
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    if (filterCol && fi >= 0 && filterValues) {
      if (!filterValues.has(fields[fi] ?? "")) continue;
    }
    const key = fields[ki] ?? "";
    if (key) result.add(key);
  }
  return result;
}

// ----- main -----

console.log("Reading tram route IDs from routes.txt ...");
const routesCsv = await Bun.$`unzip -p ${CACHE_FILE} routes.txt`.text();
const tramRouteIds = parseIds(routesCsv, "route_id", "route_type", new Set([TRAM_ROUTE_TYPE]));
console.log(`  Found ${tramRouteIds.size} tram routes`);

console.log("Reading tram trip IDs from trips.txt ...");
const tripsCsv = await Bun.$`unzip -p ${CACHE_FILE} trips.txt`.text();
const tramTripIds = parseIds(tripsCsv, "trip_id", "route_id", tramRouteIds);
console.log(`  Found ${tramTripIds.size} tram trips`);

// Write trip IDs to a temp file so awk can filter stop_times.txt without
// loading all 12M rows into memory
const tripIdFile = "/tmp/tram_trip_ids.txt";
await Bun.write(tripIdFile, [...tramTripIds].join("\n"));

console.log("Extracting tram stop IDs from stop_times.txt (awk pipeline) ...");
// awk: NR==FNR reads trip_ids file first, then filters stop_times.txt on stdin
// -F'"' splits on quotes so $2=trip_id and $8=stop_id in stop_times.txt
const awkProg = 'NR==FNR{ids[$1]=1; next} FNR>1 && ($2 in ids) {print $8}';
const stopIdText = await Bun.$`unzip -p ${CACHE_FILE} stop_times.txt | awk -F'"' ${awkProg} ${tripIdFile} - | sort -u`.text();
const tramStopIds = new Set(stopIdText.trim().split("\n").filter(Boolean));
console.log(`  Found ${tramStopIds.size} unique tram stop IDs`);

await Bun.$`rm -f ${tripIdFile}`;

console.log("Creating tram_stops table ...");
await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
await sql`
  CREATE TABLE IF NOT EXISTS tram_stops (
    stop_id   TEXT PRIMARY KEY,
    stop_code TEXT,
    name      TEXT NOT NULL,
    location  GEOGRAPHY(POINT, 4326) NOT NULL
  )
`;
await sql`CREATE INDEX IF NOT EXISTS tram_stops_location_idx ON tram_stops USING GIST (location)`;

console.log("Inserting tram stops from existing stops table ...");
const ids = [...tramStopIds];

// Insert in batches using stops already in the DB (avoids re-parsing stops.txt)
const BATCH = 1000;
let inserted = 0;
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  const pgArray = `{${batch.join(",")}}`;
  await sql`
    INSERT INTO tram_stops (stop_id, stop_code, name, location)
    SELECT stop_id, stop_code, name, location
    FROM stops
    WHERE stop_id = ANY(${pgArray}::text[])
    ON CONFLICT (stop_id) DO NOTHING
  `;
  inserted += batch.length;
  process.stdout.write(`\r  ${Math.min(inserted, ids.length)}/${ids.length}`);
}
console.log("\nDone inserting.");

const tramCount = await sql`SELECT COUNT(*) FROM tram_stops`;
console.log(`tram_stops table has ${tramCount[0]!.count} rows`);

console.log("Adding nearest_tram_stop_m column to stops table ...");
await sql`ALTER TABLE stops ADD COLUMN IF NOT EXISTS nearest_tram_stop_m DOUBLE PRECISION`;

console.log("Computing nearest tram stop distance for all bus stops (PostGIS KNN) ...");
await sql`
  UPDATE stops s
  SET nearest_tram_stop_m = (
    SELECT ST_Distance(s.location, t.location)
    FROM tram_stops t
    ORDER BY s.location::geometry <-> t.location::geometry
    LIMIT 1
  )
`;

const stats = await sql`
  SELECT
    COUNT(*) FILTER (WHERE nearest_tram_stop_m IS NOT NULL) AS computed,
    ROUND(MIN(nearest_tram_stop_m)::numeric, 0)             AS min_m,
    ROUND(AVG(nearest_tram_stop_m)::numeric, 0)             AS avg_m,
    ROUND(MAX(nearest_tram_stop_m)::numeric, 0)             AS max_m
  FROM stops
`;
const s = stats[0]!;
console.log(`Distances computed for ${s.computed} stops`);
console.log(`  min=${s.min_m}m  avg=${s.avg_m}m  max=${s.max_m}m`);

await sql.end();
