// @vitest-environment node
//
// Source-level assertion-strength guard for Suite 7 Test 1
// ("GlanceOverlay does NOT re-render when manage/dialog state toggles").
//
// Suite 7 Test 1 asserts `expect(renderCount).toBe(1)` after each dialog
// toggle to verify GlanceOverlay does NOT re-render when manage/dialog state
// changes.  If that assertion were weakened to `toBeGreaterThanOrEqual(1)` or
// `toBeLessThanOrEqual(2)`, a component that re-renders on every dialog toggle
// would silently satisfy it — hiding the dialog-stutter regression.
//
// This guard reads the source file and verifies:
//   1. The Test 1 block contains `expect(renderCount).toBe(1)` at least 4
//      times (once after mount + once after each of the 3 dialog toggles).
//   2. The Test 1 block does NOT contain `toBeGreaterThanOrEqual` on a
//      renderCount assertion — the specific weakening the task guards against.
//   3. The Test 1 block does NOT contain `toBeLessThanOrEqual` on a
//      renderCount assertion — the other obvious weakening.
//
// If someone edits Test 1's matchers without updating this file, the guard
// fails immediately with an actionable message.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const SNAPPY_FILE = resolve(
  __dirname,
  "./LiveTabMemo.snappy.test.tsx",
);

// ── Extract the Suite 7 Test 1 block from the source file ─────────────────
//
// Boundaries:
//   START — the exact it() title line for Test 1
//   END   — the comment marker that introduces Test 2 inside the same describe
//
// Using a comment marker for the end boundary is robust: it is part of the
// authored structure and does not change unless the tests are reorganised
// (which would itself be a noteworthy edit).

const TEST1_START_MARKER = 'it("GlanceOverlay does NOT re-render when manage/dialog state toggles"';
const TEST1_END_MARKER   = "// ─── Test 2: LIVE CLOCK";

function extractTest1Block(src: string): string {
  const startIdx = src.indexOf(TEST1_START_MARKER);
  if (startIdx === -1) {
    throw new Error(
      `Suite 7 Test 1 start marker not found in ${SNAPPY_FILE}.\n` +
      `Expected to find: ${TEST1_START_MARKER}\n` +
      `If the test title was renamed, update TEST1_START_MARKER in\n` +
      `LiveTabMemo.suite7.assertionStrength.test.ts.`,
    );
  }

  const endIdx = src.indexOf(TEST1_END_MARKER, startIdx);
  if (endIdx === -1) {
    throw new Error(
      `Suite 7 Test 1 end marker not found after start marker in ${SNAPPY_FILE}.\n` +
      `Expected to find: ${TEST1_END_MARKER}\n` +
      `If the surrounding comment was edited, update TEST1_END_MARKER in\n` +
      `LiveTabMemo.suite7.assertionStrength.test.ts.`,
    );
  }

  return src.slice(startIdx, endIdx);
}

describe("LiveTabMemo — Suite 7 Test 1 assertion-strength guard (source-level)", () => {
  const src = readFileSync(SNAPPY_FILE, "utf8");
  const test1Block = extractTest1Block(src);

  // ─── Sanity: markers resolve to a plausible block ──────────────────────
  it("source-file markers resolve to a non-empty Test 1 block", () => {
    expect(test1Block.length).toBeGreaterThan(200);
    // The block must contain the renderCount variable to confirm we extracted
    // the right section.
    expect(test1Block).toContain("renderCount");
  });

  // ─── Guard 1: strict-equal assertions are present ──────────────────────
  //
  // Test 1 checks renderCount after mount AND after each of 3 dialog toggles
  // (open, import-tick, close) — 4 strict-equal assertions in total.
  // Requiring at least 4 ensures every toggle checkpoint uses the strict form.
  it("Test 1 block contains expect(renderCount).toBe(1) at least 4 times (strict equality on every toggle checkpoint)", () => {
    const STRICT_RE = /expect\s*\(\s*renderCount\s*\)\s*\.toBe\s*\(\s*1\s*\)/g;
    const matches = test1Block.match(STRICT_RE) ?? [];

    expect(
      matches.length,
      `Expected at least 4 occurrences of \`expect(renderCount).toBe(1)\` in ` +
      `Suite 7 Test 1, but found ${matches.length}.\n` +
      `If a dialog-toggle checkpoint was removed or the assertion was weakened, ` +
      `restore it to strict equality in LiveTabMemo.snappy.test.tsx and update ` +
      `the minimum count here if the number of toggle checkpoints genuinely changed.`,
    ).toBeGreaterThanOrEqual(4);
  });

  // ─── Guard 2: toBeGreaterThanOrEqual not used on renderCount ───────────
  //
  // `expect(renderCount).toBeGreaterThanOrEqual(1)` would silently pass even
  // when GlanceOverlay re-renders on every dialog toggle — hiding the
  // regression Test 1 is designed to catch.
  it("Test 1 block does NOT use toBeGreaterThanOrEqual on a renderCount assertion", () => {
    const RANGE_RE = /expect\s*\(\s*renderCount\s*\)\s*\.toBeGreaterThanOrEqual/;

    expect(
      RANGE_RE.test(test1Block),
      `Suite 7 Test 1 contains \`expect(renderCount).toBeGreaterThanOrEqual(...)\`.\n` +
      `This weakens the isolation guard: a component that re-renders on every dialog ` +
      `toggle would silently satisfy a >= check even though it should render EXACTLY once.\n` +
      `Restore the assertion to \`expect(renderCount).toBe(1)\` in LiveTabMemo.snappy.test.tsx.`,
    ).toBe(false);
  });

  // ─── Guard 3: toBeLessThanOrEqual not used on renderCount ──────────────
  //
  // `expect(renderCount).toBeLessThanOrEqual(2)` is the other obvious
  // weakening: it would pass for renderCount === 1 OR 2, masking a single
  // spurious re-render caused by the dialog-stutter regression.
  it("Test 1 block does NOT use toBeLessThanOrEqual on a renderCount assertion", () => {
    const RANGE_RE = /expect\s*\(\s*renderCount\s*\)\s*\.toBeLessThanOrEqual/;

    expect(
      RANGE_RE.test(test1Block),
      `Suite 7 Test 1 contains \`expect(renderCount).toBeLessThanOrEqual(...)\`.\n` +
      `This weakens the isolation guard: a component that re-renders once on a dialog ` +
      `toggle would pass a <= 2 check even though it should render EXACTLY once.\n` +
      `Restore the assertion to \`expect(renderCount).toBe(1)\` in LiveTabMemo.snappy.test.tsx.`,
    ).toBe(false);
  });

  // ─── Guard 4: markers themselves are not stale ────────────────────────
  //
  // If the test title or surrounding comment is ever renamed, the guards above
  // would still "pass" vacuously because extractTest1Block would throw.  This
  // test explicitly asserts both markers exist in the source file so that a
  // marker rename surfaces as a clear failure here, not as an uncaught error.
  it("both extraction markers exist in the snappy source file (stale-marker guard)", () => {
    expect(
      src,
      `Suite 7 Test 1 start marker not found in the source file.\n` +
      `If the test title was renamed, update TEST1_START_MARKER in\n` +
      `LiveTabMemo.suite7.assertionStrength.test.ts.`,
    ).toContain(TEST1_START_MARKER);

    expect(
      src,
      `Suite 7 Test 1 end marker not found in the source file.\n` +
      `If the surrounding comment was edited, update TEST1_END_MARKER in\n` +
      `LiveTabMemo.suite7.assertionStrength.test.ts.`,
    ).toContain(TEST1_END_MARKER);
  });
});
