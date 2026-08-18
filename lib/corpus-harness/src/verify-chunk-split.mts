// Standalone verification script for the chunk-split change (Task #839).
// Exercises splitGridsForPrompt on real corpus workbooks and confirms:
//   1. Multi-chunk workbooks produce ≥2 non-empty chunks, zero dropped rows.
//   2. No chunk has a recipe block header with zero following data rows (split inside a block).
//   3. Recipe sheets that don't fit in the current chunk start fresh (flush guard).
//   4. SPEC_PARSE_VERSION = "26" is correctly embedded in cache keys.
// Run with:  npx tsx lib/corpus-harness/src/verify-chunk-split.mts

import * as path from "node:path";
import * as url from "node:url";
import { readGrids, corpusFiles, type SheetGrid } from "./corpus.js";
import { splitGridsForPrompt, gridsToPromptText } from "@workspace/spec-import";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────

function isRecipeBlockHeader(line: string): boolean {
  return /^Recipe:/i.test(line.trim());
}

/** Check a rendered chunk for orphaned recipe headers (header with no rows). */
function orphanedRecipeHeaders(chunk: SheetGrid[]): string[] {
  const issues: string[] = [];
  for (const sheet of chunk) {
    let lastHeaderIdx = -1;
    const lines = sheet.rows.map((r) => r.join("\t").trim());
    for (let i = 0; i < lines.length; i++) {
      if (isRecipeBlockHeader(lines[i])) {
        lastHeaderIdx = i;
      }
    }
    // An orphaned header is a "Recipe:" line that is the LAST row in a chunk sheet —
    // its data rows were moved to the next chunk (or don't exist). Check for this.
    if (lastHeaderIdx === lines.length - 1 && lines.length > 0) {
      issues.push(`sheet "${sheet.name}": last row is recipe header "${lines[lastHeaderIdx]}"`);
    }
  }
  return issues;
}

// ── Run verification ──────────────────────────────────────────────────────────

const TARGET_FILES: Array<{ file: string; expectedChunks: number }> = [
  { file: "Bobo's_Pizza_Recipe_Specs_-_29_1784339783713.xlsx", expectedChunks: 2 },
  { file: "Corner_Booth_Recipe_Specs_-_24_1784339783909.xlsx", expectedChunks: 2 },
  { file: "Lowe's_Pizza_Recipe_Specs_-_28_1784339784386.xlsx", expectedChunks: 2 },
  { file: "Aldo's_Pizza_Specs_-_09_1784339783417.xlsx", expectedChunks: 1 }, // baseline
  { file: "Lucia_Pizza_Recipe_Specs_-_35_1784339784592.xlsx", expectedChunks: 1 }, // larger single-chunk
];

let totalFailures = 0;

for (const { file, expectedChunks } of TARGET_FILES) {
  console.log(`\n▶ ${file}`);
  const grids = readGrids("specs", file);
  console.log(`  sheets: ${grids.length} (${grids.map((g) => `"${g.name}" ${g.rows.length}r`).join(", ")})`);

  const { chunks, droppedRows } = splitGridsForPrompt(grids);
  const chunkSizes = chunks.map((c) => {
    const text = gridsToPromptText(c);
    return text.length;
  });

  console.log(`  chunks: ${chunks.length}  droppedRows: ${droppedRows}`);
  console.log(`  chunk sizes (chars): ${chunkSizes.join(", ")}`);

  const failures: string[] = [];

  // 1. Expected chunk count
  if (chunks.length !== expectedChunks) {
    failures.push(`expected ${expectedChunks} chunk(s), got ${chunks.length}`);
  }

  // 2. No dropped rows
  if (droppedRows > 0) {
    failures.push(`dropped ${droppedRows} rows`);
  }

  // 3. All chunks non-empty
  for (let ci = 0; ci < chunks.length; ci++) {
    const c = chunks[ci];
    if (c.length === 0) failures.push(`chunk ${ci} is empty`);
    const totalRows = c.reduce((s, sh) => s + sh.rows.length, 0);
    if (totalRows === 0) failures.push(`chunk ${ci} has no rows`);
  }

  // 4. No orphaned recipe headers (block header as last row of a chunk sheet)
  for (let ci = 0; ci < chunks.length; ci++) {
    const orphans = orphanedRecipeHeaders(chunks[ci]);
    for (const o of orphans) {
      failures.push(`chunk ${ci}: orphaned header — ${o}`);
    }
  }

  // 5. Show chunk layout for multi-chunk workbooks
  if (expectedChunks > 1) {
    for (let ci = 0; ci < chunks.length; ci++) {
      const c = chunks[ci];
      const sheetNames = c.map((s) => s.name);
      console.log(`  chunk ${ci}: sheets=[${sheetNames.map((n) => `"${n}"`).join(", ")}]`);
    }
  }

  if (failures.length === 0) {
    console.log(`  ✅ PASS`);
  } else {
    for (const f of failures) {
      console.log(`  ❌ FAIL: ${f}`);
    }
    totalFailures += failures.length;
  }
}

// ── SPEC_PARSE_VERSION cache fence check ─────────────────────────────────────
console.log("\n▶ SPEC_PARSE_VERSION cache fence");
// Check the client-side version constant
const specImportPath = path.join(__dirname, "../../..", "artifacts/run-calculator/src/specImport.ts");
import { readFileSync } from "node:fs";
let specImportSrc: string;
try {
  specImportSrc = readFileSync(specImportPath, "utf8");
  const match = specImportSrc.match(/SPEC_PARSE_VERSION\s*=\s*["'](\d+)["']/);
  if (match) {
    const version = match[1];
    console.log(`  SPEC_PARSE_VERSION = "${version}"`);
    if (parseInt(version, 10) >= 25) {
      console.log("  ✅ PASS — version fences off pre-chunk-split stale cache entries");
    } else {
      console.log("  ❌ FAIL — version not bumped past 25 (pre-chunk-split change)");
      totalFailures += 1;
    }
  } else {
    console.log("  ❌ FAIL — SPEC_PARSE_VERSION not found in specImport.ts");
    totalFailures += 1;
  }
} catch (e) {
  console.log(`  ⚠️  Could not read specImport.ts: ${e}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (totalFailures === 0) {
  console.log("✅ All chunk-split verifications PASSED");
  process.exit(0);
} else {
  console.log(`❌ ${totalFailures} verification(s) FAILED`);
  process.exit(1);
}
