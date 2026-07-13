// @vitest-environment node
//
// APPLY-side coverage for the web re-import case-update Accept/Keep dialog.
// The offer BUILDER (src/importCaseUpdates.ts) is already tested; this file
// proves the accepted choices actually REACH the run: home.tsx's
// applyCaseUpdateChoices must write an accepted target through the normal
// write paths (live form for the current run, saveRunValues for others),
// leave Keep runs untouched, and advance the per-run LWW edit stamp
// (markRunValuesUpdated) so the sync merge doesn't revert the new count.
//
// Rather than duplicating the logic in a re-implemented fixture (which would
// happily keep passing after a regression in the real code), this test
// extracts the REAL `applyCaseUpdateChoices` function declaration out of
// pages/home.tsx with the TypeScript AST, transpiles it, and executes it with
// stubbed closure dependencies. If the function is renamed/moved the
// extraction fails loudly (see also runValueStampGuard.test.ts, which pins the
// same function's stamping via a lint-style source guard).
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME_FILE = path.join(here, "pages", "home.tsx");

// ── Extract the real function text from home.tsx ───────────────────────────

function extractFunctionText(source: string, name: string): string {
  const sf = ts.createSourceFile(
    "home.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let text: string | null = null;
  const visit = (n: ts.Node) => {
    if (text) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      text = n.getText(sf);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!text) {
    throw new Error(
      `Could not find function ${name}() in pages/home.tsx — if it was renamed or ` +
        `converted to an arrow function, re-point applyCaseUpdateChoices.web.test.ts.`,
    );
  }
  return text;
}

// ── Harness: run the real function with stubbed closure dependencies ────────

type Offer = {
  runId: string;
  brand: string;
  flavor: string;
  from: number;
  to: number;
  madeAlready?: number;
};

type FormValues = Record<string, unknown>;

type Env = {
  /** Offers currently shown in the dialog. */
  offers: Offer[];
  /** Per-run Accept (true) / Keep (false) choices. */
  accepted: Record<string, boolean>;
  /** The run whose values live in the form right now. */
  currentRunId: string;
  /** Initial live-form values (the current run's). */
  formValues: FormValues;
  /** Saved values for the non-current runs. */
  savedValues: Record<string, FormValues>;
};

type Recorded = {
  setValueCalls: { field: string; value: unknown; opts: unknown }[];
  saveRunValuesCalls: { runId: string; values: FormValues }[];
  loadRunValuesCalls: string[];
  markCalls: { runId: string; at: number }[];
  setPromptCalls: unknown[];
  schedulePushCalls: { state: unknown; delay: unknown }[];
  toasts: unknown[];
  lastLocalEdit: number | null;
  form: FormValues;
  saved: Record<string, FormValues>;
};

function runApply(env: Env): Recorded {
  const source = fs.readFileSync(HOME_FILE, "utf8");
  const fnText = extractFunctionText(source, "applyCaseUpdateChoices");

  const rec: Recorded = {
    setValueCalls: [],
    saveRunValuesCalls: [],
    loadRunValuesCalls: [],
    markCalls: [],
    setPromptCalls: [],
    schedulePushCalls: [],
    toasts: [],
    lastLocalEdit: null,
    form: { ...env.formValues },
    saved: Object.fromEntries(
      Object.entries(env.savedValues).map(([k, v]) => [k, { ...v }]),
    ),
  };

  const deps = {
    caseUpdatePrompt: env.offers,
    caseUpdateAccepted: env.accepted,
    setCaseUpdatePrompt: (v: unknown) => rec.setPromptCalls.push(v),
    currentRunIdRef: { current: env.currentRunId },
    form: {
      setValue: (field: string, value: unknown, opts: unknown) => {
        rec.setValueCalls.push({ field, value, opts });
        rec.form[field] = value;
      },
      getValues: () => ({ ...rec.form }),
    },
    saveRunValues: (runId: string, values: FormValues) => {
      rec.saveRunValuesCalls.push({ runId, values: { ...values } });
      rec.saved[runId] = { ...values };
    },
    loadRunValues: (runId: string) => {
      rec.loadRunValuesCalls.push(runId);
      return { ...(rec.saved[runId] ?? {}) };
    },
    markRunValuesUpdated: (runId: string, at: number) =>
      rec.markCalls.push({ runId, at }),
    lastLocalEditRef: {
      set current(v: number) {
        rec.lastLocalEdit = v;
      },
      get current() {
        return rec.lastLocalEdit ?? 0;
      },
    },
    schedulePush: (state: unknown, delay: unknown) =>
      rec.schedulePushCalls.push({ state, delay }),
    dayStateRef: { current: { tag: "day-state" } },
    toast: (t: unknown) => rec.toasts.push(t),
  };

  const wrapper = `
${Object.keys(deps)
  .map((k) => `const ${k} = __deps.${JSON.stringify(k).slice(1, -1)};`)
  .join("\n")}
${fnText}
applyCaseUpdateChoices();
`;
  const { outputText } = ts.transpileModule(wrapper, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  });
  new Function("__deps", outputText)(deps);
  return rec;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const offerCurrent: Offer = {
  runId: "run-current",
  brand: "Acme",
  flavor: "Pepperoni",
  from: 50,
  to: 80,
};
const offerOther: Offer = {
  runId: "run-other",
  brand: "Beta",
  flavor: "Cheese",
  from: 40,
  to: 60,
};

function baseEnv(accepted: Record<string, boolean>): Env {
  return {
    offers: [offerCurrent, offerOther],
    accepted,
    currentRunId: "run-current",
    formValues: { casesNeeded: 50, casesPerSkid: 20, notes: "live form" },
    savedValues: {
      "run-other": { casesNeeded: 40, casesPerSkid: 25, notes: "other run" },
    },
  };
}

let extractionOk = false;
beforeAll(() => {
  // Fail fast (with a clear message) if the real function can't be found.
  extractFunctionText(fs.readFileSync(HOME_FILE, "utf8"), "applyCaseUpdateChoices");
  extractionOk = true;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("applyCaseUpdateChoices (real home.tsx code) — accepted counts reach the run", () => {
  it("extraction harness found the real function", () => {
    expect(extractionOk).toBe(true);
  });

  it("ACCEPT for the CURRENT run goes through the live form, then flushes to saveRunValues", () => {
    const rec = runApply(baseEnv({ "run-current": true, "run-other": false }));

    // The live form was updated (so the on-screen field shows the new target)…
    expect(rec.setValueCalls).toEqual([
      { field: "casesNeeded", value: 80, opts: { shouldDirty: true } },
    ]);
    // …and the SAME values were flushed to the current run's saved copy.
    expect(rec.saveRunValuesCalls).toHaveLength(1);
    expect(rec.saveRunValuesCalls[0].runId).toBe("run-current");
    expect(rec.saveRunValuesCalls[0].values).toMatchObject({
      casesNeeded: 80,
      casesPerSkid: 20,
      notes: "live form",
    });
    expect(rec.saved["run-current"].casesNeeded).toBe(80);
  });

  it("ACCEPT for a NON-current run merges casesNeeded into its saved values without touching other fields", () => {
    const rec = runApply(baseEnv({ "run-current": false, "run-other": true }));

    // The live form is NOT touched for another run's update.
    expect(rec.setValueCalls).toEqual([]);
    expect(rec.form.casesNeeded).toBe(50);

    expect(rec.loadRunValuesCalls).toEqual(["run-other"]);
    expect(rec.saveRunValuesCalls).toHaveLength(1);
    expect(rec.saveRunValuesCalls[0].runId).toBe("run-other");
    // The new target landed; every other saved field survived the merge.
    expect(rec.saved["run-other"]).toEqual({
      casesNeeded: 60,
      casesPerSkid: 25,
      notes: "other run",
    });
  });

  it("KEEP leaves that run completely untouched (no write, no stamp)", () => {
    const rec = runApply(baseEnv({ "run-current": true, "run-other": false }));

    // run-other was kept: never loaded, never saved, never stamped.
    expect(rec.loadRunValuesCalls).not.toContain("run-other");
    expect(rec.saveRunValuesCalls.map((c) => c.runId)).not.toContain("run-other");
    expect(rec.markCalls.map((c) => c.runId)).not.toContain("run-other");
    expect(rec.saved["run-other"].casesNeeded).toBe(40);
  });

  it("every ACCEPTED run gets a fresh LWW stamp (markRunValuesUpdated) so sync can't revert it", () => {
    const before = Date.now();
    const rec = runApply(baseEnv({ "run-current": true, "run-other": true }));
    const after = Date.now();

    expect(rec.markCalls.map((c) => c.runId).sort()).toEqual([
      "run-current",
      "run-other",
    ]);
    for (const c of rec.markCalls) {
      expect(c.at).toBeGreaterThanOrEqual(before);
      expect(c.at).toBeLessThanOrEqual(after);
    }
    // Same "now" for the batch, and the global edit attribution matches it —
    // the sync push must see this as a fresh local edit.
    expect(new Set(rec.markCalls.map((c) => c.at)).size).toBe(1);
    expect(rec.lastLocalEdit).toBe(rec.markCalls[0].at);
    // A push is scheduled immediately so peers get the new counts.
    expect(rec.schedulePushCalls).toHaveLength(1);
    expect(rec.schedulePushCalls[0].delay).toBe(0);
  });

  it("closes the dialog, and with zero accepted runs writes/stamps/pushes NOTHING", () => {
    const rec = runApply(baseEnv({ "run-current": false, "run-other": false }));

    // Dialog dismissed either way.
    expect(rec.setPromptCalls).toEqual([null]);
    // Keep All: no writes, no stamps, no push, no toast.
    expect(rec.setValueCalls).toEqual([]);
    expect(rec.saveRunValuesCalls).toEqual([]);
    expect(rec.markCalls).toEqual([]);
    expect(rec.schedulePushCalls).toEqual([]);
    expect(rec.toasts).toEqual([]);
    expect(rec.saved["run-other"].casesNeeded).toBe(40);
    expect(rec.form.casesNeeded).toBe(50);
  });

  it("accepting BOTH runs routes each through its own path (form vs saved values)", () => {
    const rec = runApply(baseEnv({ "run-current": true, "run-other": true }));

    expect(rec.saved["run-current"].casesNeeded).toBe(80);
    expect(rec.saved["run-other"].casesNeeded).toBe(60);
    expect(rec.form.casesNeeded).toBe(80);
    // Only the current run went through the form.
    expect(rec.setValueCalls).toHaveLength(1);
    // One toast summarizing the applied updates.
    expect(rec.toasts).toHaveLength(1);
  });
});
