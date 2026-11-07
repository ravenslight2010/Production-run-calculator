import { createReadStream } from "node:fs";
import {
  readCoverageManifest,
  summarizeCoverage,
  type CoverageManifest,
} from "./offline-log-coverage.mts";

// Load the pure summarizer at runtime, preserving scripts' separate TS root.
const { summarizeDatabasePhaseRecords } = await import(
  new URL("../../artifacts/api-server/src/lib/databasePhaseTelemetry.ts", import.meta.url).href
);

// Offline only. Never print paths, rejected records, or parse errors with content.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_LINES = 100_000;

async function main() {
  if (process.argv.length !== 3) throw new Error("usage");
  let bytes = 0;
  let pending = "";
  const lines: string[] = [];
  const stream = createReadStream(process.argv[2]!, { encoding: "utf8", highWaterMark: MAX_LINE_BYTES });
  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_BYTES) throw new Error("size");
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_LINE_BYTES || lines.length >= MAX_LINES) throw new Error("size");
      if (line.trim()) lines.push(line);
    }
    if (Buffer.byteLength(pending) > MAX_LINE_BYTES) throw new Error("size");
  }
  if (pending.trim()) {
    if (lines.length >= MAX_LINES) throw new Error("size");
    lines.push(pending);
  }
  let invalidJsonLines = 0;
  let invalidCoverageManifests = 0;
  let coverageManifest: CoverageManifest | undefined;
  let hasCoverageManifest = false;
  function* records() {
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        const coverage = readCoverageManifest(parsed);
        if (coverage.kind !== "not-manifest") {
          if (coverage.kind === "invalid" || hasCoverageManifest) {
            invalidCoverageManifests += 1;
          } else {
            coverageManifest = coverage.manifest;
            hasCoverageManifest = true;
          }
          continue;
        }
        yield parsed;
      }
      catch { invalidJsonLines++; }
    }
  }
  const summary = summarizeDatabasePhaseRecords(records());
  console.log(JSON.stringify({
    ...summary, invalidJsonLines,
    coverage: summarizeCoverage(coverageManifest, invalidCoverageManifests),
    invalidCoverageManifests,
    provenance: "offline_input_environment_and_revision_not_verified",
  }, null, 2));
  if (invalidJsonLines || invalidCoverageManifests) process.exitCode = 1;
}

main().catch(() => {
  console.error("Cannot summarize: provide one readable JSONL file, at most 16 MiB, 100000 lines, and 64 KiB per line.");
  process.exitCode = 1;
});
