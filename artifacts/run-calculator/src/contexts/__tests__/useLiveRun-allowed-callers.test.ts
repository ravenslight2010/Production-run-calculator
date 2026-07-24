// @vitest-environment node
//
// Structural guard: useLiveRun() must only be called from components that are
// explicitly designed to subscribe to the per-second clock. Calling it from
// a non-live tab component (Inventory, Setup, Manage, Mixes, Warehouse, AI,
// Staff…) would cause every one of those tabs to re-render once per second,
// burning CPU and causing unnecessary UI churn.
//
// TWO checks live here:
//
//  1. HOME.TSX ALLOWLIST (per-function)
//     Scans home.tsx and verifies that every useLiveRun() call is inside a
//     function on the ALLOWED_CALLERS list.  Fine-grained: catches a new
//     inline tab-content block that sneaks a clock subscription in.
//
//  2. FULL SRC/ TREE SCAN (per-file)
//     Scans every non-test .ts/.tsx file under src/ and verifies that
//     useLiveRun() only appears in the files on the ALLOWED_FILES list.
//     Catches the case where a developer extracts a component into a new file
//     under src/components/ or src/pages/ and accidentally imports and calls
//     useLiveRun() there — the per-home.tsx scan would miss that entirely.
//
// HOW TO MAINTAIN THE ALLOWLISTS
// ──────────────────────────────
// ALLOWED_CALLERS  — per-function list for home.tsx (check 1).
//   Add the function name + a brief comment when you add a new live component
//   inline in home.tsx.
//
// ALLOWED_FILES — per-file list for the full-tree scan (check 2).
//   Add the src/-relative path when a new file outside home.tsx legitimately
//   calls useLiveRun().  Leave a comment explaining why.
//   Currently only home.tsx and LiveRunContext.tsx are on this list.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { describe, it, expect } from "vitest";

// ── Check 1: per-function allowlist for home.tsx ───────────────────────────
// Only these function names may call useLiveRun() in home.tsx.
const ALLOWED_CALLERS = new Set<string>([
  // Live-clock-dependent tab content (re-render every second is intentional)
  "LiveRunTabContent",
  "LivePackagingTabContent",
  "LiveSauceTabContent",      // sauce batch stepper uses live casesLeftToRun
  "LiveFrontlineTabContent",
  "LiveDoughTabContent",
  "LiveSetupRecipesTabContent",
  "LiveStoppagesTabContent",
  "LiveSummaryTabContent",

  // Live display helpers mounted on top of the main content area:
  // ScreenModeView — station/TV cast display, updates counters per second
  "ScreenModeView",
  // FloorModeView — idle floor-mode big-numbers monitor
  "FloorModeView",
  // GlanceOverlay was extracted to src/components/GlanceOverlay.tsx so it can
  // be tested in isolation.  It is listed in ALLOWED_FILES below instead.
  // CompactRunStrip was extracted to src/components/CompactRunStrip.tsx so it
  // can be tested in isolation.  It is listed in ALLOWED_FILES below instead.
]);

// ── Check 2: per-file allowlist for the full src/ tree ────────────────────
// Paths are relative to src/ (forward slashes, no leading ./). Any file NOT
// on this list that contains a useLiveRun() call will fail the test.
//
// Test files (*.test.ts, *.test.tsx, __tests__/**) are excluded from the scan
// automatically — they may reference useLiveRun() in describe/it blocks.
const ALLOWED_FILES = new Set<string>([
  // home.tsx — the canonical home of all live-clock components; covered in
  // detail by the per-function allowlist in check 1 above.
  "pages/home.tsx",

  // LiveRunContext.tsx — this file *defines* useLiveRun(), so naturally
  // contains useLiveRun() in the function body and type annotations.
  "contexts/LiveRunContext.tsx",

  // GlanceOverlay.tsx — extracted from home.tsx so the real component can be
  // imported and rendered in isolation by LiveTabMemo.snappy.test.tsx (Suite 5).
  // It is the full-screen live-stats overlay that stays visible while manage
  // dialogs are open, so it genuinely needs the per-second clock subscription.
  "components/GlanceOverlay.tsx",

  // CompactRunStrip.tsx — extracted from home.tsx so the real component can be
  // imported and rendered in isolation by LiveTabMemo.snappy.test.tsx (Suite 11).
  // It is the persistent mini status bar shown on non-Run tabs while manage
  // dialogs are open, so it genuinely needs the per-second clock subscription.
  "components/CompactRunStrip.tsx",
]);

// ── Helpers ───────────────────────────────────────────────────────────────
const SRC_DIR = resolve(__dirname, "../../../src");

/** Collect every .ts / .tsx file under a directory, recursively. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (/\.(tsx?)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

/** Returns true if this path should be skipped (it's a test file). */
function isTestFile(absPath: string): boolean {
  const rel = relative(SRC_DIR, absPath).replace(/\\/g, "/");
  // Skip *.test.ts / *.test.tsx anywhere in the tree.
  if (/\.test\.(tsx?)$/.test(rel)) return true;
  // Skip anything under a __tests__ directory.
  if (rel.split("/").includes("__tests__")) return true;
  return false;
}

// Matches an actual useLiveRun() call (not an import statement or comment).
const USE_LIVE_RUN_RE = /\buseLiveRun\s*\(\s*\)/;
const IMPORT_COMMENT_RE = /^\s*(import|\/\/|\/\*|\*)/;

// ── Scanner ───────────────────────────────────────────────────────────────
// Uses a simple line-by-line scan rather than an AST parser so it stays
// dependency-free and fast. The heuristic is reliable because:
//   • All function declarations in home.tsx that could contain useLiveRun()
//     are top-level `function Name(` declarations (not arrow functions).
//   • We scan backwards — the most recent `function Name(` before any
//     useLiveRun() call is its enclosing function.
//   • Import lines and comment-only occurrences are excluded.

describe("useLiveRun — allowed callers in home.tsx", () => {
  it("useLiveRun() is only called from components on the allowlist", () => {
    const homePath = resolve(
      __dirname,
      "../../../src/pages/home.tsx",
    );

    const lines = readFileSync(homePath, "utf8").split("\n");

    // Regex to detect a top-level function declaration in two forms:
    //   1. `function FunctionName(` or `function FunctionName<`
    //   2. `const FunctionName = memo(function FunctionName(` — React.memo wrap
    // We capture only PascalCase names (components) to skip utilities like
    // `function buildNeedRows(`, `function fmtElapsed(`, etc.
    const FUNC_DECL_RE = /^function ([A-Z][A-Za-z0-9]*)[\s<(]/;
    // Matches: const CompactRunStrip = memo(function CompactRunStrip() {
    const MEMO_FUNC_RE = /^const \w+ = \w+\(function ([A-Z][A-Za-z0-9]*)[\s<(]/;

    let currentFunction: string | null = null;
    const violations: { line: number; fn: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track the current enclosing function (plain decl or memo-wrapped).
      const funcMatch = line.match(FUNC_DECL_RE) ?? line.match(MEMO_FUNC_RE);
      if (funcMatch) {
        currentFunction = funcMatch[1];
        continue;
      }

      // Skip import lines and comment lines.
      if (IMPORT_COMMENT_RE.test(line)) continue;

      // Check for a useLiveRun() call.
      if (USE_LIVE_RUN_RE.test(line)) {
        if (currentFunction === null || !ALLOWED_CALLERS.has(currentFunction)) {
          violations.push({ line: i + 1, fn: currentFunction ?? "<module scope>" });
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map(
          ({ line, fn }) =>
            `  Line ${line}: useLiveRun() called inside "${fn}" — add it to ALLOWED_CALLERS if intentional`,
        )
        .join("\n");

      expect.fail(
        `Found ${violations.length} unexpected useLiveRun() call(s) in home.tsx:\n${detail}\n\n` +
          `If this component genuinely needs the live clock, add its function name to\n` +
          `ALLOWED_CALLERS in src/contexts/__tests__/useLiveRun-allowed-callers.test.ts\n` +
          `and leave a comment explaining why.`,
      );
    }

    // Sanity-check: every name in ALLOWED_CALLERS must actually appear in
    // home.tsx. This detects stale entries (e.g. after a rename) so the
    // allowlist stays in sync with the code.
    const functionsFound = new Set<string>();
    for (const line of lines) {
      const m = line.match(FUNC_DECL_RE) ?? line.match(MEMO_FUNC_RE);
      if (m) functionsFound.add(m[1]);
    }

    const staleEntries = [...ALLOWED_CALLERS].filter(
      (name) => !functionsFound.has(name),
    );

    if (staleEntries.length > 0) {
      expect.fail(
        `ALLOWED_CALLERS contains stale entries no longer present in home.tsx:\n` +
          staleEntries.map((n) => `  "${n}"`).join("\n") +
          `\n\nRemove them from ALLOWED_CALLERS in src/contexts/__tests__/useLiveRun-allowed-callers.test.ts.`,
      );
    }
  });
});

describe("useLiveRun — no accidental subscriptions across src/", () => {
  it(
    "useLiveRun() only appears in files on the ALLOWED_FILES list",
    () => {
      const allSourceFiles = collectSourceFiles(SRC_DIR);

      const violations: { file: string; lines: number[] }[] = [];

      for (const absPath of allSourceFiles) {
        // Skip test files — they may import or mention useLiveRun() in specs.
        if (isTestFile(absPath)) continue;

        const relPath = relative(SRC_DIR, absPath).replace(/\\/g, "/");

        // Files on the allowlist are permitted; they are verified separately
        // (home.tsx in check 1, LiveRunContext.tsx owns the definition).
        if (ALLOWED_FILES.has(relPath)) continue;

        const content = readFileSync(absPath, "utf8");
        const lines = content.split("\n");

        const hitLines: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip import statements and comment lines.
          if (IMPORT_COMMENT_RE.test(line)) continue;
          if (USE_LIVE_RUN_RE.test(line)) {
            hitLines.push(i + 1);
          }
        }

        if (hitLines.length > 0) {
          violations.push({ file: relPath, lines: hitLines });
        }
      }

      if (violations.length > 0) {
        const detail = violations
          .map(
            ({ file, lines }) =>
              `  src/${file}  (line${lines.length > 1 ? "s" : ""} ${lines.join(", ")})`,
          )
          .join("\n");

        expect.fail(
          `useLiveRun() was found in ${violations.length} file(s) outside the allowlist:\n\n` +
            `${detail}\n\n` +
            `Each call causes the component to re-render every second, which is very\n` +
            `likely unintentional for a non-live file.  If the subscription is\n` +
            `deliberate, add the src/-relative path to ALLOWED_FILES in\n` +
            `src/contexts/__tests__/useLiveRun-allowed-callers.test.ts and leave a\n` +
            `comment explaining why the file needs the live clock.\n\n` +
            `If you extracted a component from home.tsx into its own file:\n` +
            `  • Add the new file to ALLOWED_FILES, AND\n` +
            `  • Remove the function name from ALLOWED_CALLERS (it no longer lives\n` +
            `    in home.tsx so the per-home.tsx guard would fail as stale anyway).`,
        );
      }
    },
  );

  it(
    "ALLOWED_FILES entries all exist on disk (no stale paths)",
    () => {
      const stale: string[] = [];
      for (const relPath of ALLOWED_FILES) {
        const absPath = join(SRC_DIR, relPath);
        try {
          statSync(absPath);
        } catch {
          stale.push(relPath);
        }
      }

      if (stale.length > 0) {
        expect.fail(
          `ALLOWED_FILES contains path(s) that no longer exist on disk:\n` +
            stale.map((p) => `  src/${p}`).join("\n") +
            `\n\nRemove them from ALLOWED_FILES in\n` +
            `src/contexts/__tests__/useLiveRun-allowed-callers.test.ts.`,
        );
      }
    },
  );
});
