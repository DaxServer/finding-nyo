// Runs all ingestion scripts in order. Use as a K8s init pod:
//   command: ["bun", "scripts/ingest-all.ts"]

console.log("=== Step 1/3: ingest-stops ===");
await import("./ingest-stops.ts");

console.log("\n=== Step 2/3: ingest-tram-stops ===");
await import("./ingest-tram-stops.ts");

console.log("\n=== Step 3/3: fetch-stop-images ===");
await import("./fetch-stop-images.ts");

console.log("\nAll ingestion steps complete.");
