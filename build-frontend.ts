import vue from "@eckidevs/bun-plugin-vue";
import { copyFile, mkdir } from "fs/promises";

await mkdir("public", { recursive: true });

await Bun.build({
  entrypoints: ["./frontend/main.ts"],
  outdir: "./public",
  plugins: [vue()],
  minify: false,
});

await Bun.$`bunx tailwindcss -i frontend/styles.css -o public/styles.css`;

await copyFile("frontend/index.html", "public/index.html");
await copyFile("node_modules/leaflet/dist/leaflet.css", "public/leaflet.css");
console.log("Build complete → public/");
