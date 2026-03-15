import vue from "@eckidevs/bun-plugin-vue";
import { copyFile, mkdir } from "fs/promises";

await mkdir("public", { recursive: true });

await Bun.build({
  entrypoints: ["./frontend/main.ts"],
  outdir: "./public",
  plugins: [vue()],
  minify: false,
});

await copyFile("frontend/index.html", "public/index.html");
console.log("Build complete → public/");
