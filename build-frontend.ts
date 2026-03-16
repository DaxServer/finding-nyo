import vue from "@eckidevs/bun-plugin-vue";
import { copyFile, mkdir } from "fs/promises";

await mkdir("public", { recursive: true });
await mkdir("public/images", { recursive: true });

await Bun.build({
  entrypoints: ["./frontend/main.ts"],
  outdir: "./public",
  plugins: [vue()],
  minify: false,
});

await Bun.$`bunx tailwindcss -i frontend/styles.css -o public/styles.css`;

await copyFile("frontend/index.html", "public/index.html");
await copyFile("node_modules/leaflet/dist/leaflet.css", "public/leaflet.css");
await copyFile("node_modules/leaflet.markercluster/dist/MarkerCluster.css", "public/MarkerCluster.css");
await copyFile("node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css", "public/MarkerCluster.Default.css");
await copyFile("node_modules/leaflet/dist/images/marker-icon.png", "public/images/marker-icon.png");
await copyFile("node_modules/leaflet/dist/images/marker-icon-2x.png", "public/images/marker-icon-2x.png");
await copyFile("node_modules/leaflet/dist/images/marker-shadow.png", "public/images/marker-shadow.png");
console.log("Build complete → public/");
