import { join } from "path";

const GTFS_URL = "https://gtfs.irail.be/de-lijn/de_lijn-gtfs.zip";
const CACHE_FILE = join(import.meta.dir, "..", "de-lijn-gtfs.zip");
const BATCH_SIZE = 1000;

const sql = Bun.sql;

async function downloadZip(): Promise<void> {
  if (await Bun.file(CACHE_FILE).exists()) {
    const size = Bun.file(CACHE_FILE).size / 1024 / 1024;
    console.log(`Using cached zip at ${CACHE_FILE} (${size.toFixed(1)} MB)`);
    return;
  }

  console.log(`Downloading GTFS zip from ${GTFS_URL} ...`);
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const buffer = await res.arrayBuffer();
  await Bun.write(CACHE_FILE, buffer);
  const size = Bun.file(CACHE_FILE).size / 1024 / 1024;
  console.log(`Saved to ${CACHE_FILE} (${size.toFixed(1)} MB)`);
}

async function extractStopsCsv(): Promise<string> {
  console.log("Extracting stops.txt ...");
  const result = await Bun.$`unzip -p ${CACHE_FILE} stops.txt`.text();
  return result;
}

interface StopRow {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
}

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

function parseCsv(csv: string): StopRow[] {
  const lines = csv.trim().split("\n");
  const headerLine = lines[0]!;
  if (!headerLine) throw new Error("stops.txt is empty");
  const header = splitCsvLine(headerLine);

  const iId = header.indexOf("stop_id");
  const iCode = header.indexOf("stop_code");
  const iName = header.indexOf("stop_name");
  const iLat = header.indexOf("stop_lat");
  const iLon = header.indexOf("stop_lon");

  return lines.slice(1).flatMap((line) => {
    const fields = splitCsvLine(line);
    const row = {
      stop_id: fields[iId] ?? "",
      stop_code: fields[iCode] ?? "",
      stop_name: fields[iName] ?? "",
      stop_lat: fields[iLat] ?? "",
      stop_lon: fields[iLon] ?? "",
    };
    // Skip rows with missing coordinates (e.g. parent station entries)
    if (!row.stop_lat || !row.stop_lon) return [];
    return [row];
  });
}

async function createSchema(): Promise<void> {
  console.log("Creating schema ...");
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  await sql`
    CREATE TABLE IF NOT EXISTS stops (
      stop_id   TEXT PRIMARY KEY,
      stop_code TEXT,
      name      TEXT NOT NULL,
      location  GEOGRAPHY(POINT, 4326) NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS stops_location_idx ON stops USING GIST (location)
  `;
}

async function insertStops(rows: StopRow[]): Promise<void> {
  console.log(`Inserting ${rows.length} stops in batches of ${BATCH_SIZE} ...`);
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await sql.begin(async (tx) => {
      for (const r of batch) {
        const wkt = `SRID=4326;POINT(${r.stop_lon} ${r.stop_lat})`;
        const code = r.stop_code || null;
        await tx`
          INSERT INTO stops (stop_id, stop_code, name, location)
          VALUES (${r.stop_id}, ${code}, ${r.stop_name}, ST_GeogFromText(${wkt}))
          ON CONFLICT (stop_id) DO NOTHING
        `;
      }
    });

    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${rows.length}`);
  }

  console.log("\nDone.");
}

await downloadZip();
const csv = await extractStopsCsv();
const rows = parseCsv(csv);
console.log(`Parsed ${rows.length} stops`);
await createSchema();
await insertStops(rows);

const count = await sql`SELECT COUNT(*) FROM stops`;
console.log(`stops table now has ${count[0].count} rows`);
await sql.end();
