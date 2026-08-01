// @vitest-environment node
//
// Coverage for the mobile re-import case-update offer builder
// (artifacts/run-calculator-mobile/utils/importCaseUpdates.ts). Re-importing
// today's schedule can list a DIFFERENT case count for a run that's already
// going; buildCaseUpdateOffers turns those matches into offers and must flag
// (via `madeAlready`) offers whose new target is BELOW what the floor already
// produced — accepting one makes the run instantly "over target". A regression
// here (flag missing, flag on the wrong side, finished runs picked up) would
// only be caught on the floor, so it's locked down here.
//
// The module imports "@/utils/notify" (a React Native import graph), so it is
// loaded via the strip-imports -> transpile -> temp-file-import pipeline
// documented in .agents/memory/web-test-harness.md, with a STUB_PRELUDE
// supplying `showConfirm` (captured so the prompt text can be asserted).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(
  here,
  "../../../_archived/mobile/utils/importCaseUpdates.ts",
);

// The only import the module has is `showConfirm` from "@/utils/notify".
// Capture every call so tests can assert the prompt message and drive the
// confirm button.
const STUB_PRELUDE = `
export const __confirmCalls = [];
const showConfirm = (opts) => { __confirmCalls.push(opts); };
`;

type RanRunInfo = {
  brand: string;
  flavor: string;
  id: string;
  startedAt?: number;
  endedAt?: number;
  casesNeeded: number;
  casesMade?: number;
};

type CaseUpdateOffer = {
  runId: string;
  brand: string;
  flavor: string;
  from: number;
  to: number;
  madeAlready?: number;
};

interface MobileModule {
  buildCaseUpdateOffers: (
    matches: {
      row: { brand: string; flavor: string; casesNeeded: number };
      run: RanRunInfo;
    }[],
  ) => CaseUpdateOffer[];
  promptCaseUpdates: (
    offers: CaseUpdateOffer[],
    prefix: string,
    apply: (offer: CaseUpdateOffer) => void,
  ) => void;
  __confirmCalls: {
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
    onCancel: () => void;
  }[];
}

let tempFile: string | null = null;

async function loadStrippedModule(file: string): Promise<MobileModule> {
  const ts = (await import("typescript")).default;
  const raw = fs.readFileSync(file, "utf8");
  const withoutImports = raw.replace(
    /import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g,
    "",
  );
  const source = STUB_PRELUDE + withoutImports;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  });
  const out = path.join(
    os.tmpdir(),
    `importCaseUpdates.mobile.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return (await import(pathToFileURL(out).href)) as MobileModule;
}

let mobile: MobileModule;

beforeAll(async () => {
  mobile = await loadStrippedModule(MOBILE_FILE);
});

afterAll(() => {
  if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
});

function match(
  rowCases: number,
  run: Partial<RanRunInfo> & { casesNeeded: number },
): { row: { brand: string; flavor: string; casesNeeded: number }; run: RanRunInfo } {
  return {
    row: { brand: "Acme", flavor: "Pepperoni", casesNeeded: rowCases },
    run: {
      brand: "Acme",
      flavor: "Pepperoni",
      id: "run-1",
      startedAt: 1_000,
      ...run,
    },
  };
}

describe("buildCaseUpdateOffers — lowered-target flag (madeAlready)", () => {
  it("sets madeAlready only when casesMade exceeds the new target", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(60, { casesNeeded: 100, casesMade: 80 }),
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      runId: "run-1",
      from: 100,
      to: 60,
      madeAlready: 80,
    });
  });

  it("does NOT set madeAlready when casesMade equals the new target", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(80, { casesNeeded: 100, casesMade: 80 }),
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0].to).toBe(80);
    expect(offers[0].madeAlready).toBeUndefined();
    expect("madeAlready" in offers[0]).toBe(false);
  });

  it("does NOT set madeAlready when the target is raised above what was made", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(120, { casesNeeded: 100, casesMade: 80 }),
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ from: 100, to: 120 });
    expect(offers[0].madeAlready).toBeUndefined();
  });

  it("does NOT set madeAlready when casesMade is missing (treated as 0)", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(60, { casesNeeded: 100 }),
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ from: 100, to: 60 });
    expect(offers[0].madeAlready).toBeUndefined();
  });

  it("clamps negative casesMade to 0 (never flags)", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(60, { casesNeeded: 100, casesMade: -5 }),
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0].madeAlready).toBeUndefined();
  });

  it("rounds casesMade before comparing (80.4 vs target 80 -> no flag; 80.6 -> flag)", () => {
    const noFlag = mobile.buildCaseUpdateOffers([
      match(80, { casesNeeded: 100, casesMade: 80.4 }),
    ]);
    expect(noFlag[0].madeAlready).toBeUndefined();

    const flagged = mobile.buildCaseUpdateOffers([
      match(80, { casesNeeded: 100, casesMade: 80.6 }),
    ]);
    expect(flagged[0].madeAlready).toBe(81);
  });
});

describe("buildCaseUpdateOffers — offer eligibility", () => {
  it("finished runs (endedAt set) never produce offers, even lowered ones", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(60, { casesNeeded: 100, casesMade: 80, endedAt: 2_000 }),
    ]);
    expect(offers).toEqual([]);
  });

  it("unstarted runs (no startedAt) never produce offers", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(60, { casesNeeded: 100, casesMade: 80, startedAt: undefined }),
    ]);
    expect(offers).toEqual([]);
  });

  it("no offer when the re-imported count matches the current target", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(100, { casesNeeded: 100, casesMade: 80 }),
    ]);
    expect(offers).toEqual([]);
  });

  it("ignores non-finite or non-positive re-imported counts", () => {
    expect(
      mobile.buildCaseUpdateOffers([match(NaN, { casesNeeded: 100 })]),
    ).toEqual([]);
    expect(
      mobile.buildCaseUpdateOffers([match(0, { casesNeeded: 100 })]),
    ).toEqual([]);
    expect(
      mobile.buildCaseUpdateOffers([match(-4, { casesNeeded: 100 })]),
    ).toEqual([]);
  });

  it("mixes flagged and unflagged offers across multiple matches", () => {
    const offers = mobile.buildCaseUpdateOffers([
      match(60, { id: "a", casesNeeded: 100, casesMade: 80 }),
      match(150, { id: "b", casesNeeded: 100, casesMade: 80 }),
      match(90, { id: "c", casesNeeded: 100, casesMade: 80, endedAt: 5 }),
    ]);
    expect(offers.map((o) => o.runId)).toEqual(["a", "b"]);
    expect(offers[0].madeAlready).toBe(80);
    expect(offers[1].madeAlready).toBeUndefined();
  });
});

describe("promptCaseUpdates — warning line text (one-run-at-a-time chain)", () => {
  const flagged: CaseUpdateOffer = {
    runId: "a",
    brand: "Acme",
    flavor: "Pepperoni",
    from: 100,
    to: 60,
    madeAlready: 80,
  };
  const plain: CaseUpdateOffer = {
    runId: "b",
    brand: "Acme",
    flavor: "Cheese",
    from: 100,
    to: 150,
  };

  it("includes the 'Already made N ... BELOW' warning only on flagged prompts", () => {
    mobile.__confirmCalls.length = 0;
    const applied: string[] = [];
    mobile.promptCaseUpdates([flagged, plain], "", (o) => applied.push(o.runId));

    // Prompts are chained one run at a time — only the first shows initially.
    expect(mobile.__confirmCalls).toHaveLength(1);
    const first = mobile.__confirmCalls[0];
    expect(first.message).toContain("Acme Pepperoni: 100 → 60 cases");
    expect(first.message).toContain("Already made 80");
    expect(first.message).toContain("the new target of 60 is BELOW that");

    // Confirming applies the flagged offer (allowed, just warned) and chains
    // the next prompt, which carries NO lowered-target warning.
    first.onConfirm();
    expect(applied).toEqual(["a"]);
    expect(mobile.__confirmCalls).toHaveLength(2);
    const second = mobile.__confirmCalls[1];
    expect(second.message).toContain("Acme Cheese: 100 → 150 cases");
    expect(second.message).not.toContain("Already made");
    expect(second.message).not.toContain("BELOW");

    second.onConfirm();
    expect(applied).toEqual(["a", "b"]);
  });

  it("declining a flagged offer keeps the current target but still advances the chain", () => {
    mobile.__confirmCalls.length = 0;
    const applied: string[] = [];
    mobile.promptCaseUpdates([flagged, plain], "", (o) => applied.push(o.runId));

    const first = mobile.__confirmCalls[0];
    expect(first.cancelText).toBe("Keep 100");
    first.onCancel();
    expect(applied).toEqual([]);
    expect(mobile.__confirmCalls).toHaveLength(2);
    mobile.__confirmCalls[1].onConfirm();
    expect(applied).toEqual(["b"]);
  });

  it("a stray double-callback cannot double-apply or double-advance", () => {
    mobile.__confirmCalls.length = 0;
    const applied: string[] = [];
    mobile.promptCaseUpdates([flagged], "", (o) => applied.push(o.runId));

    const first = mobile.__confirmCalls[0];
    first.onConfirm();
    first.onConfirm();
    first.onCancel();
    expect(applied).toEqual(["a"]);
    expect(mobile.__confirmCalls).toHaveLength(1);
  });

  it("does not prompt at all when there are no offers", () => {
    mobile.__confirmCalls.length = 0;
    mobile.promptCaseUpdates([], "", () => {
      throw new Error("must not apply");
    });
    expect(mobile.__confirmCalls).toEqual([]);
  });
});
