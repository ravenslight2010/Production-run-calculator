// ── Source guard: CURRENT_BLANK_RUN_VALUE must stay in sync with DEFAULT_VALUES ─
//
// Background: `CURRENT_BLANK_RUN_VALUE` in protectRunValues.ts is the server's
// canonical "all-default blank run" template. The server's empty-over-populated
// guard (`isBlankRunValue`) performs an EXACT deep-equality check against it to
// decide whether an incoming run value should be blocked from overwriting a real
// stored value. When a new field is added to `DEFAULT_VALUES` (the client's
// matching template) but NOT to `CURRENT_BLANK_RUN_VALUE`, blank runs that
// carry the new field no longer match the template and fall through to stamp-only
// logic, silently re-opening the "I entered it, it vanished" data-loss bug.
//
// When an existing field's default VALUE changes in DEFAULT_VALUES but not in
// CURRENT_BLANK_RUN_VALUE, the same degradation occurs: the client emits the
// new default shape, which no longer deep-equals the old template, and the blank
// run sneaks through the guard.
//
// This lint-style test parses CURRENT_BLANK_RUN_VALUE from source (TypeScript
// AST → evaluated literals) and compares both its key set AND each field's value
// against the runtime-imported DEFAULT_VALUES. Symbolic constants in
// DEFAULT_VALUES (e.g. MACHINE_TIME_DEFAULTS.mixerLowSec, PRE_POST_TUNNEL_DEFAULT_MIN)
// are resolved automatically because we import the live module.
//
// Note: CURRENT_BLANK_RUN_VALUE is intentionally NOT required to use the same
// literal representation — only the resolved value must match. The server's
// MACHINE_TIME_DEFAULTS normalization deliberately accepts 0 for fields whose
// default moved from 0 to a non-zero factory typical (mixerLowSec etc.); those
// fields are whitelisted below so the guard allows either 0 or the real default.
//
// Fix for a drift: add/correct the field in CURRENT_BLANK_RUN_VALUE in
// artifacts/api-server/src/lib/protectRunValues.ts, then re-run.
//
// See also: §6 of .agents/skills/sync-invariant-check/SKILL.md
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { DEFAULT_VALUES, MACHINE_TIME_DEFAULTS, PRE_POST_TUNNEL_DEFAULT_MIN } from "./types";

const PROTECT_FILE = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "artifacts",
  "api-server",
  "src",
  "lib",
  "protectRunValues.ts",
);

// ── AST value evaluator ──────────────────────────────────────────────────────
// Evaluate a TypeScript AST expression node to a plain JS value. Handles the
// subset of value types present in CURRENT_BLANK_RUN_VALUE: number/string/bool
// literals and empty array literals. Returns a sentinel for anything else so
// the test can flag it explicitly.
const UNRESOLVED = Symbol("unresolved");

function evalLiteral(node: ts.Expression): unknown {
  // Numeric literal: 0, 1.0, 2.5, 330, …
  if (ts.isNumericLiteral(node)) return Number(node.text);

  // Unary minus for negative numbers (−1, etc.) — shouldn't appear but handles it
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }

  // String literal: "", "none", "cartoned", …
  if (ts.isStringLiteral(node)) return node.text;

  // Boolean literals
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;

  // Array literal — only empty arrays are expected in CURRENT_BLANK_RUN_VALUE.
  // A non-empty array literal here would be a miscopy; flag it as UNRESOLVED
  // rather than silently comparing structurally.
  if (ts.isArrayLiteralExpression(node)) {
    if (node.elements.length === 0) return [];
    return UNRESOLVED;
  }

  // Anything else (property access, identifier, …) cannot be safely evaluated
  // from source text alone without a full type-checker.
  return UNRESOLVED;
}

// ── Object extractor ─────────────────────────────────────────────────────────
// Extract { key → evaluated value } from the first const variable declaration
// whose name matches `varName` and whose initializer is an object literal.
type ExtractedEntry = { key: string; value: unknown; rawText: string };

function extractObjectEntries(
  source: string,
  varName: string,
  fileName: string,
): ExtractedEntry[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const entries: ExtractedEntry[] = [];
  let found = false;

  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === varName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = true;
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : null;
        if (!key) continue;
        entries.push({
          key,
          value: evalLiteral(prop.initializer as ts.Expression),
          rawText: prop.initializer.getText(sf),
        });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  if (!found) {
    throw new Error(`Could not find variable declaration for "${varName}" in ${fileName}`);
  }
  return entries;
}

// ── Fields whose server-side template is allowed to carry 0 OR the real default ─
// These are fields whose default moved from 0 to a non-zero value. The server
// normalizes 0 → default in isBlankRunValue before comparing, so BOTH values
// mean "blank" and CURRENT_BLANK_RUN_VALUE may legitimately use either.
// The guard accepts the value if it equals either the DEFAULT_VALUES value OR 0.
const ZERO_OR_DEFAULT_FIELDS: ReadonlySet<string> = new Set([
  ...Object.keys(MACHINE_TIME_DEFAULTS),
  // preTunnelMin / postTunnelMin also covered by MACHINE_TIME_DEFAULTS in protectRunValues.ts
]);

// ── Load data ────────────────────────────────────────────────────────────────
const protectSrc = fs.readFileSync(PROTECT_FILE, "utf8");
const currentBlankEntries = extractObjectEntries(
  protectSrc,
  "CURRENT_BLANK_RUN_VALUE",
  "protectRunValues.ts",
);
const currentBlankKeys = currentBlankEntries.map((e) => e.key).sort();
const currentBlankMap = new Map(currentBlankEntries.map((e) => [e.key, e]));

const defaultValuesKeys = Object.keys(DEFAULT_VALUES).sort();
const defaultSet = new Set(defaultValuesKeys);
const blankSet = new Set(currentBlankKeys);

// ── Tests ────────────────────────────────────────────────────────────────────
describe("source guard: CURRENT_BLANK_RUN_VALUE must mirror DEFAULT_VALUES keys and values", () => {
  it("CURRENT_BLANK_RUN_VALUE has every key that DEFAULT_VALUES has (and no extras)", () => {
    const missingFromBlank = defaultValuesKeys.filter((k) => !blankSet.has(k));
    expect(
      missingFromBlank,
      `CURRENT_BLANK_RUN_VALUE in protectRunValues.ts is missing field(s) that exist in ` +
        `DEFAULT_VALUES (types.ts). The empty-over-populated guard will silently degrade — ` +
        `blank runs carrying these fields won't be recognized as blank and will overwrite real data.\n\n` +
        `Add the following to CURRENT_BLANK_RUN_VALUE with the same default value as DEFAULT_VALUES:\n` +
        missingFromBlank.map((k) => `  ${k}: ${JSON.stringify((DEFAULT_VALUES as Record<string, unknown>)[k])}`).join("\n") +
        `\n\nSee §6 of .agents/skills/sync-invariant-check/SKILL.md for context.`,
    ).toEqual([]);

    const extraInBlank = currentBlankKeys.filter((k) => !defaultSet.has(k));
    expect(
      extraInBlank,
      `CURRENT_BLANK_RUN_VALUE in protectRunValues.ts has field(s) that no longer exist in ` +
        `DEFAULT_VALUES (types.ts). Remove stale keys — they cause false-positive blank detections ` +
        `for any real run that happens to carry the same key with a non-matching value:\n` +
        extraInBlank.join(", "),
    ).toEqual([]);
  });

  it("every field's default value in CURRENT_BLANK_RUN_VALUE matches DEFAULT_VALUES", () => {
    // Only check fields present in both (the key test above catches missing/extra).
    const sharedKeys = defaultValuesKeys.filter((k) => blankSet.has(k));
    const mismatches: string[] = [];
    const unresolvable: string[] = [];

    for (const key of sharedKeys) {
      const entry = currentBlankMap.get(key)!;
      const serverVal = entry.value;
      const clientVal = (DEFAULT_VALUES as Record<string, unknown>)[key];

      if (serverVal === UNRESOLVED) {
        // CURRENT_BLANK_RUN_VALUE uses a non-literal expression we can't evaluate from AST alone.
        // This is always a maintenance error — all values must be plain literals.
        unresolvable.push(`  ${key}: ${entry.rawText}  (expected: ${JSON.stringify(clientVal)})`);
        continue;
      }

      // For fields whose server template normalizes 0 → real default, both 0
      // and the real default are acceptable.
      const clientNumVal = clientVal as number;
      if (
        ZERO_OR_DEFAULT_FIELDS.has(key) &&
        typeof serverVal === "number" &&
        typeof clientVal === "number" &&
        (serverVal === 0 || serverVal === clientNumVal)
      ) {
        continue;
      }

      // For array fields: both must be empty arrays (the only valid blank shape).
      if (Array.isArray(clientVal) && Array.isArray(serverVal)) {
        if (clientVal.length === 0 && serverVal.length === 0) continue;
        mismatches.push(
          `  ${key}: server=[${serverVal}]  client=[${clientVal}]`,
        );
        continue;
      }

      // Exact equality for everything else.
      if (serverVal !== clientVal) {
        mismatches.push(
          `  ${key}: CURRENT_BLANK_RUN_VALUE has ${JSON.stringify(serverVal)}, ` +
            `DEFAULT_VALUES has ${JSON.stringify(clientVal)}`,
        );
      }
    }

    expect(
      unresolvable,
      `CURRENT_BLANK_RUN_VALUE uses non-literal expression(s) that the guard can't evaluate.\n` +
        `Change them to plain literal values (numbers/strings/booleans/[]):\n` +
        unresolvable.join("\n"),
    ).toEqual([]);

    expect(
      mismatches,
      `CURRENT_BLANK_RUN_VALUE has field(s) with different default values than DEFAULT_VALUES.\n` +
        `isBlankRunValue uses EXACT value equality, so a changed client default silently ` +
        `degrades blank-run protection (new-default blank runs no longer match the template).\n\n` +
        `Fix by updating the value(s) in CURRENT_BLANK_RUN_VALUE to match DEFAULT_VALUES:\n` +
        mismatches.join("\n") +
        `\n\nSee §6 of .agents/skills/sync-invariant-check/SKILL.md for context.`,
    ).toEqual([]);
  });

  it("the guard is not vacuous: it finds a meaningful number of shared fields", () => {
    expect(
      defaultValuesKeys.length,
      "DEFAULT_VALUES appears to have no keys — import may have broken",
    ).toBeGreaterThan(30);
    expect(
      currentBlankKeys.length,
      "CURRENT_BLANK_RUN_VALUE appears to have no keys — AST extraction may have broken",
    ).toBeGreaterThan(30);
  });

  it("DEFAULT_VALUES contains the expected anchor fields (self-test for import)", () => {
    const anchor = ["casesNeeded", "speedAdjustment", "allergen", "doughRecipe", "cartoned"];
    for (const k of anchor) {
      expect(defaultValuesKeys, `DEFAULT_VALUES should contain "${k}"`).toContain(k);
    }
  });

  it("CURRENT_BLANK_RUN_VALUE machine-time defaults are 0 (relying on server normalization) or the real default", () => {
    // Self-test: confirm the ZERO_OR_DEFAULT_FIELDS whitelist covers the fields in MACHINE_TIME_DEFAULTS.
    for (const key of Object.keys(MACHINE_TIME_DEFAULTS)) {
      if (!blankSet.has(key)) continue; // missing-key test above catches this
      const entry = currentBlankMap.get(key)!;
      const realDefault = (MACHINE_TIME_DEFAULTS as Record<string, number>)[key];
      expect(
        [0, realDefault],
        `CURRENT_BLANK_RUN_VALUE.${key} must be either 0 (old-client path) or the real ` +
          `default ${realDefault} (new-client path). Got: ${entry.value}`,
      ).toContain(entry.value);
    }
  });

  it("PRE_POST_TUNNEL_DEFAULT_MIN fields are 0 or the real default in CURRENT_BLANK_RUN_VALUE", () => {
    for (const key of ["preTunnelMin", "postTunnelMin"]) {
      if (!blankSet.has(key)) continue;
      const entry = currentBlankMap.get(key)!;
      expect(
        [0, PRE_POST_TUNNEL_DEFAULT_MIN],
        `CURRENT_BLANK_RUN_VALUE.${key} must be 0 or ${PRE_POST_TUNNEL_DEFAULT_MIN}. Got: ${entry.value}`,
      ).toContain(entry.value);
    }
  });
});
