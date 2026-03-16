import vue from "@eckidevs/bun-plugin-vue";
import { copyFile, mkdir, rename } from "fs/promises";
import { createHash } from "crypto";
import { readFile } from "fs/promises";

await mkdir("public", { recursive: true });
await mkdir("public/images", { recursive: true });

await Bun.build({
  entrypoints: ["./frontend/main.ts"],
  outdir: "./public",
  plugins: [vue()],
  minify: false,
});

await Bun.$`bunx tailwindcss -i frontend/styles.css -o public/styles.css`;

// Generate content hash and rename files
async function generateHash(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const hash = createHash("sha256").update(buffer).digest("base64url").slice(0, 8);
  return hash;
}

async function hashRename(basePath: string, ext: string): Promise<string> {
  const hash = await generateHash(basePath + ext);
  const hashedPath = `${basePath}.${hash}${ext}`;
  await rename(basePath + ext, hashedPath);
  return hashedPath.replace(/^\.\/public\//, "/");
}

const mainJs = await hashRename("./public/main", ".js");
const stylesCss = await hashRename("./public/styles", ".css");

// Update index.html with hashed asset paths
let indexHtml = await readFile("frontend/index.html", "utf-8");
indexHtml = indexHtml.replace('href="/styles.css"', `href="${stylesCss}"`);
indexHtml = indexHtml.replace('src="/main.js"', `src="${mainJs}"`);
await Bun.write("public/index.html", indexHtml);

await copyFile("node_modules/leaflet/dist/leaflet.css", "public/leaflet.css");
await copyFile("node_modules/leaflet.markercluster/dist/MarkerCluster.css", "public/MarkerCluster.css");
await copyFile("node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css", "public/MarkerCluster.Default.css");
await copyFile("node_modules/leaflet/dist/images/marker-icon.png", "public/images/marker-icon.png");
await copyFile("node_modules/leaflet/dist/images/marker-icon-2x.png", "public/images/marker-icon-2x.png");
await copyFile("node_modules/leaflet/dist/images/marker-shadow.png", "public/images/marker-shadow.png");
console.log(`Build complete → public/ (${mainJs}, ${stylesCss})`);
