import { sql } from "bun";
import { performance } from "perf_hooks";

interface BenchmarkResult {
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: string;
  compressionTime: number;
}

async function benchmarkCompression() {
  console.log("🔍 Fetching locations data from database...\n");

  const rows = await sql`
    SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, nearest_tram_stop_m
    FROM stops
  ` as { lat: number; lng: number; nearest_tram_stop_m: number | null }[];

  const data = { locations: rows };
  const jsonString = JSON.stringify(data);
  const originalSize = jsonString.length;

  console.log(`📊 Original data size: ${(originalSize / 1024 / 1024).toFixed(2)} MB (${originalSize.toLocaleString()} bytes)\n`);

  const results: BenchmarkResult[] = [];

  // Benchmark Gzip
  console.log("🗜️  Compressing with Gzip...");
  const gzipStart = performance.now();
  const gzipCompressed = Bun.gzipSync(jsonString);
  const gzipTime = performance.now() - gzipStart;
  results.push({
    algorithm: "Gzip",
    originalSize,
    compressedSize: gzipCompressed.length,
    compressionRatio: ((1 - gzipCompressed.length / originalSize) * 100).toFixed(1) + "%",
    compressionTime: gzipTime,
  });
  console.log(`   ✓ ${gzipCompressed.length.toLocaleString()} bytes (${(gzipCompressed.length / 1024 / 1024).toFixed(2)} MB) - ${gzipTime.toFixed(2)}ms\n`);

  // Benchmark Deflate
  console.log("🗜️  Compressing with Deflate...");
  const deflateStart = performance.now();
  const deflateCompressed = Bun.deflateSync(jsonString);
  const deflateTime = performance.now() - deflateStart;
  results.push({
    algorithm: "Deflate",
    originalSize,
    compressedSize: deflateCompressed.length,
    compressionRatio: ((1 - deflateCompressed.length / originalSize) * 100).toFixed(1) + "%",
    compressionTime: deflateTime,
  });
  console.log(`   ✓ ${deflateCompressed.length.toLocaleString()} bytes (${(deflateCompressed.length / 1024 / 1024).toFixed(2)} MB) - ${deflateTime.toFixed(2)}ms\n`);

  // Benchmark Zstd
  console.log("🗜️  Compressing with Zstd...");
  const zstdStart = performance.now();
  const zstdCompressed = Bun.zstdCompressSync(Buffer.from(jsonString));
  const zstdTime = performance.now() - zstdStart;
  results.push({
    algorithm: "Zstd",
    originalSize,
    compressedSize: zstdCompressed.length,
    compressionRatio: ((1 - zstdCompressed.length / originalSize) * 100).toFixed(1) + "%",
    compressionTime: zstdTime,
  });
  console.log(`   ✓ ${zstdCompressed.length.toLocaleString()} bytes (${(zstdCompressed.length / 1024 / 1024).toFixed(2)} MB) - ${zstdTime.toFixed(2)}ms\n`);

  // Display results table
  console.log("📈 COMPRESSION BENCHMARK RESULTS");
  console.log("─".repeat(100));
  console.log(
    `| ${"Algorithm".padEnd(12)} | ${"Original".padEnd(12)} | ${"Compressed".padEnd(12)} | ${"Ratio".padEnd(10)} | ${"Time".padEnd(10)} |`
  );
  console.log("─".repeat(100));

  for (const result of results) {
    console.log(
      `| ${result.algorithm.padEnd(12)} | ` +
        `${(result.originalSize / 1024 / 1024).toFixed(2) + " MB".padEnd(12)} | ` +
        `${(result.compressedSize / 1024 / 1024).toFixed(2) + " MB".padEnd(12)} | ` +
        `${result.compressionRatio.padEnd(10)} | ` +
        `${result.compressionTime.toFixed(2) + " ms".padEnd(10)} |`
    );
  }

  console.log("─".repeat(100));

  // Find winner
  const smallest = results.reduce((prev, current) =>
    current.compressedSize < prev.compressedSize ? current : prev
  );
  const fastest = results.reduce((prev, current) =>
    current.compressionTime < prev.compressionTime ? current : prev
  );

  console.log(`\n🏆 Best compression: ${smallest.algorithm} (${smallest.compressionRatio} reduction)`);
  console.log(`⚡ Fastest compression: ${fastest.algorithm} (${fastest.compressionTime.toFixed(2)}ms)`);

  // Size comparison
  console.log("\n📉 Size comparison (relative to original):");
  for (const result of results) {
    const barLength = Math.round((1 - result.compressedSize / originalSize) * 50);
    const bar = "█".repeat(barLength) + "░".repeat(50 - barLength);
    console.log(`  ${result.algorithm.padEnd(8)} ${bar} ${(result.compressedSize / originalSize * 100).toFixed(1)}%`);
  }
}

// Run benchmark
benchmarkCompression().catch(console.error);
