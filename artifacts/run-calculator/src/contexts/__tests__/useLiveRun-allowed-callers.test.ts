// @vitest-environment node
//
// Structural guard: useLiveRun() must only be called from components that are
// explicitly designed to subscribe to the per-second clock. Calling it from
// a non-live tab component (Inventory, Setup, Manage, Mixes, Warehouse, AI,
// Staff…) would cause every one of those tabs to re-render once per second,
// burning CPU and causing unnecessary UI churn.
//
// This test scans home.tsx at build time. If a developer accidentally adds
// useLiveRun() inside inline tab content that is NOT on the allowlist, this
// test fails immediately — before review, before deploy.
//
// HOW TO MAINTAIN THE ALLOWLIST
// ──────────────────────────────
// The allowlist below is the single source of truth. Every function name on
// the list is a component that intentionally subscribes to the live clock.
// If you extract a new live-display component and it needs useLiveRun():
//   1. Name it with the "Live" prefix OR add it to ALLOWED_CALLERS below.
//   2. Leave a brief comment explaining why it needs the live clock.
// If you see this test fail after a refactor, the failing function name is
// printed so you know exactly what to inspect or add to the list.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// ── Allowlist ─────────────────────────────────────────────────────────────────
// Only these function names may call useLiveRun() in home.tsx.
const ALLOWED_CALLERS = new Set<string>([
  // Live-clock-dependent tab content (re-render every second is intentional)
  "LiveRunTabContent",
  "LivePackagingTabContent",
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
  // GlanceOverlay — full-screen glance overlay that shows live run stats
  "GlanceOverlay",
  // CompactRunStrip — persistent strip shown on non-Run tabs; displays live
  //   counters (cases made, pace, time left) so it must subscribe to the clock
  "CompactRunStrip",
]);

// ── Scanner ───────────────────────────────────────────────────────────────────
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

    // Regex to detect a top-level function declaration:
    //   `function FunctionName(` or `function FunctionName<`
    // We capture only PascalCase names (components) to skip utilities like
    // `function buildNeedRows(`, `function fmtElapsed(`, etc.
    const FUNC_DECL_RE = /^function ([A-Z][A-Za-z0-9]*)[\s<(]/;

    // Matches an actual useLiveRun() call (not an import line or comment).
    const USE_LIVE_RUN_RE = /\buseLiveRun\s*\(\s*\)/;
    const IMPORT_RE = /^\s*(import|\/\/|\/\*|\*)/;

    let currentFunction: string | null = null;
    const violations: { line: number; fn: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track the current enclosing function.
      const funcMatch = line.match(FUNC_DECL_RE);
      if (funcMatch) {
        currentFunction = funcMatch[1];
        continue;
      }

      // Skip import lines and comment lines.
      if (IMPORT_RE.test(line)) continue;

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
      const m = line.match(FUNC_DECL_RE);
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
