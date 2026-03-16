// Runs all ingestion scripts in order. Use as a K8s init pod:
//   command: ["bun", "scripts/ingest-all.ts"]

console.log("=== Step 1/2: ingest-stops ===");
await import("./ingest-stops.ts");

console.log("\n=== Step 2/2: ingest-tram-stops ===");
await import("./ingest-tram-stops.ts");

console.log("\nAll ingestion steps complete.");
