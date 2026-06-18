// @vitest-environment node
//
// Unit + parity tests for the shared "fill in missing data" detection/proposal
// logic. The web module is imported directly. The mobile module
// (artifacts/run-calculator-mobile/context/fillMissing.ts) is byte-identical for
// this logic but lives behind a React Native / Expo import graph that cannot load
// in a node/jsdom test, so it is loaded through a strip-imports -> transpile ->
// temp-file-import pipeline. Both copies are then driven with the same inputs and
// their results compared (the replit.md web<->mobile parity rule).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as web from "./fillMissing";

type FillMissingModule = typeof web;

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_FILE = path.resolve(
  here,
  "../../run-calculator-mobile/context/fillMissing.ts",
);

// Symbols the module references that come from its (stripped) imports. Only
// `photoErrorMessage` is touched at module-eval time; the rest live in function
// bodies that these tests never call, but we stub them so the module evaluates.
const STUB_PRELUDE = `
const photoErrorMessage = (e) => (e instanceof Error ? e.message : String(e));
const loadProfile = () => null;
const inventoryClientId = () => "test-client";
const inventoryShared = {};
const getAuthToken = async () => undefined;
const getApiBaseUrl = () => "";
const getOrCreateClientId = async () => "test-client";
const profileKey = (b, f) => String(b).toLowerCase() + "__" + String(f).toLowerCase();
const SPEC_PROFILES = {};
class InventoryApiError extends Error {}
`;

let tempFile: string | null = null;

async function loadStrippedModule(file: string): Promise<FillMissingModule> {
  const ts = (await import("typescript")).default;
  const raw = fs.readFileSync(file, "utf8");
  // Drop every `import ... from "...";` (incl. multiline + `import type`).
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
    `fillMissing.mobile.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return (await import(pathToFileURL(out).href)) as FillMissingModule;
}

let mobile: FillMissingModule;

beforeAll(async () => {
  mobile = await loadStrippedModule(MOBILE_FILE);
});

afterAll(() => {
  if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
});

// ── Shared fixtures ──────────────────────────────────────────────────────────

const keysOf = (m: FillMissingModule, rec: Record<string, unknown>) =>
  m.detectMissingFields(rec).map((f) => f.spec.key);

// A deterministic KnownLookup exercising every source-priority branch.
function lookup(key: string): { profile?: string | number; spec?: string | number } {
  switch (key) {
    case "casesNeeded":
      return { profile: 500 }; // profile wins
    case "cycleSpeed":
      return { spec: 9.1 }; // no profile -> spec
    case "shipper":
      return { profile: "12in", spec: "costco" }; // profile beats spec
    case "sauceOzPerPizza":
      return { profile: 0 }; // blank profile is ignored -> falls to default
    default:
      return {}; // -> documentedDefault when present, else none
  }
}

// ── detectMissingFields ──────────────────────────────────────────────────────

describe("detectMissingFields", () => {
  it("flags every non-slot-gated field on a fully blank run", () => {
    const keys = keysOf(web, {});
    expect(keys).toEqual([
      "brand",
      "flavor",
      "dieType",
      "casesNeeded",
      "crustsPerCycle",
      "cycleSpeed",
      "speedAdjustment",
      "freezerTime",
      "pizzasPerCase",
      "casesPerSkid",
      "casesPerLayer",
      "cartonsPerCase",
      "shipper",
      "skidStacking",
      "doughballsPerTray",
      "crustsPerStack",
      "doughBatchYield",
      "crustsPerCase",
      "sauceOzPerPizza",
      "sauceBarrelLbs",
    ]);
    // Applicator / pepperoni slots are not in use, so none are flagged.
    expect(keys.some((k) => /^app\d/.test(k) || /^pep\d/.test(k))).toBe(false);
  });

  it("skips fields that already hold a value", () => {
    const keys = keysOf(web, { brand: "Lucia's", casesNeeded: 384, sauceOzPerPizza: 4 });
    expect(keys).not.toContain("brand");
    expect(keys).not.toContain("casesNeeded");
    expect(keys).not.toContain("sauceOzPerPizza");
    expect(keys).toContain("flavor");
  });

  it("treats whitespace text and non-positive numbers as blank", () => {
    const keys = keysOf(web, { brand: "   ", casesNeeded: 0, cycleSpeed: -3 });
    expect(keys).toContain("brand");
    expect(keys).toContain("casesNeeded");
    expect(keys).toContain("cycleSpeed");
  });

  describe("slot gating", () => {
    it("flags an applicator slot only when it is in use (type set)", () => {
      const keys = keysOf(web, { app1Type: "Mozzarella" });
      expect(keys).toContain("app1OzPerPizza");
      expect(keys).toContain("app1BatchLbs");
      expect(keys).not.toContain("app1Type"); // already set
      // Other applicator slots stay off.
      expect(keys.some((k) => /^app[234]/.test(k))).toBe(false);
    });

    it("activates an applicator slot via oz/pizza or a cheese recipe", () => {
      expect(keysOf(web, { app2OzPerPizza: 3 })).toContain("app2Type");
      expect(keysOf(web, { app3CheeseRecipe: [{ x: 1 }] })).toContain("app3Type");
    });

    it("flags a pepperoni slot only when it is in use (sticks > 0)", () => {
      const keys = keysOf(web, { pep2Sticks: 10 });
      expect(keys).toContain("pep2Type");
      expect(keys).toContain("pep2OzPerPizza");
      expect(keys).toContain("pep2BatchLbs");
      expect(keys.some((k) => /^pep1/.test(k))).toBe(false);
    });

    it("gates cartonsPerCase on the cartoned flag", () => {
      expect(keysOf(web, {})).toContain("cartonsPerCase");
      expect(keysOf(web, { cartoned: "no" })).not.toContain("cartonsPerCase");
      expect(keysOf(web, { cartoned: "yes" })).toContain("cartonsPerCase");
    });
  });
});

// ── buildProposals (source priority) ─────────────────────────────────────────

describe("buildProposals", () => {
  const proposalsFor = (m: FillMissingModule, rec: Record<string, unknown>) => {
    const props = m.buildProposals(m.detectMissingFields(rec), lookup);
    return new Map(props.map((p) => [p.key, p]));
  };

  it("resolves sources in the order profile -> spec -> default -> none", () => {
    const byKey = proposalsFor(web, {});
    expect(byKey.get("casesNeeded")).toMatchObject({ source: "profile", value: 500 });
    expect(byKey.get("cycleSpeed")).toMatchObject({ source: "spec", value: 9.1 });
    expect(byKey.get("shipper")).toMatchObject({ source: "profile", value: "12in" });
    // documentedDefault used when no known source.
    expect(byKey.get("freezerTime")).toMatchObject({
      source: "default",
      value: web.DOCUMENTED_DEFAULTS.freezerTime,
    });
    // No source at all -> value null.
    expect(byKey.get("dieType")).toMatchObject({ source: "none", value: null });
  });

  it("ignores a blank known value and falls through to the default", () => {
    const byKey = proposalsFor(web, {});
    expect(byKey.get("sauceOzPerPizza")).toMatchObject({
      source: "default",
      value: web.DOCUMENTED_DEFAULTS.sauceOzPerPizza,
    });
  });
});

// ── aiCandidates ─────────────────────────────────────────────────────────────

describe("aiCandidates", () => {
  it("returns only fillable, AI-eligible fields with no known source", () => {
    const proposals = web.buildProposals(web.detectMissingFields({}), lookup);
    const keys = web.aiCandidates(proposals).map((p) => p.key);
    // dieType + skidStacking have no source and are AI-eligible & fillable.
    expect(keys).toEqual(["dieType", "skidStacking"]);
    // brand/flavor are "none" too but not fillable -> excluded.
    expect(keys).not.toContain("brand");
    expect(keys).not.toContain("flavor");
    // shipper had a profile source -> excluded.
    expect(keys).not.toContain("shipper");
  });

  it("excludes slot AI-eligible fields that resolve to a default", () => {
    // app1BatchLbs has a documentedDefault, so it never reaches "none".
    const proposals = web.buildProposals(
      web.detectMissingFields({ app1Type: "Mozz" }),
      lookup,
    );
    const keys = web.aiCandidates(proposals).map((p) => p.key);
    expect(keys).toContain("app1OzPerPizza"); // no default -> none -> AI
    expect(keys).not.toContain("app1BatchLbs"); // default -> not AI
  });
});

// ── buildFillMissingInput ────────────────────────────────────────────────────

describe("buildFillMissingInput", () => {
  it("packs identity, known context, and requested fields", () => {
    const candidates = web.aiCandidates(
      web.buildProposals(web.detectMissingFields({}), lookup),
    );
    const input = web.buildFillMissingInput("Lucia's", "PEPPERONI", "12in", candidates, {
      pizzasPerCase: 12,
      brand: "Lucia's",
    });
    expect(input.brand).toBe("Lucia's");
    expect(input.flavor).toBe("PEPPERONI");
    expect(input.dieType).toBe("12in");
    // brand/flavor are never echoed back as context.
    expect(input.context?.some((c) => c.key === "brand" || c.key === "flavor")).toBe(false);
    expect(input.context).toContainEqual({ key: "pizzasPerCase", label: "Pizzas / Case", value: "12" });
    expect(input.fields.map((f) => f.key)).toEqual(["dieType", "skidStacking"]);
  });
});

// ── isBlankValue ─────────────────────────────────────────────────────────────

describe("isBlankValue", () => {
  it("treats non-positive numbers and empty/whitespace text as blank", () => {
    expect(web.isBlankValue("number", 0)).toBe(true);
    expect(web.isBlankValue("number", -1)).toBe(true);
    expect(web.isBlankValue("number", "0")).toBe(true);
    expect(web.isBlankValue("number", 5)).toBe(false);
    expect(web.isBlankValue("text", "")).toBe(true);
    expect(web.isBlankValue("text", "   ")).toBe(true);
    expect(web.isBlankValue("text", "x")).toBe(false);
  });
});

// ── Web <-> mobile parity guard ──────────────────────────────────────────────

describe("web/mobile parity", () => {
  // Inputs spanning blank runs, partially-filled runs, slot activation, and the
  // cartoned gate. Both modules must agree field-for-field on all of them.
  const cases: Record<string, unknown>[] = [
    {},
    { brand: "Lucia's", flavor: "PEPPERONI", casesNeeded: 384 },
    { app1Type: "Mozzarella", app2OzPerPizza: 3 },
    { pep1Sticks: 6, pep2Type: "Cup & Char" },
    { cartoned: "no" },
    { cartoned: "yes", shipper: "costco", sauceOzPerPizza: 4 },
    { brand: "  ", cycleSpeed: -2, app3CheeseRecipe: [{ a: 1 }] },
  ];

  it("exposes identical FIELD_SPECS and DOCUMENTED_DEFAULTS", () => {
    expect(mobile.FIELD_SPECS).toEqual(web.FIELD_SPECS);
    expect(mobile.DOCUMENTED_DEFAULTS).toEqual(web.DOCUMENTED_DEFAULTS);
  });

  it("detectMissingFields agrees for every input", () => {
    for (const rec of cases) {
      expect(mobile.detectMissingFields(rec)).toEqual(web.detectMissingFields(rec));
    }
  });

  it("buildProposals agrees for every input", () => {
    for (const rec of cases) {
      const m = mobile.buildProposals(mobile.detectMissingFields(rec), lookup);
      const w = web.buildProposals(web.detectMissingFields(rec), lookup);
      expect(m).toEqual(w);
    }
  });

  it("aiCandidates agrees for every input", () => {
    for (const rec of cases) {
      const m = mobile.aiCandidates(mobile.buildProposals(mobile.detectMissingFields(rec), lookup));
      const w = web.aiCandidates(web.buildProposals(web.detectMissingFields(rec), lookup));
      expect(m).toEqual(w);
    }
  });

  it("buildFillMissingInput agrees for every input", () => {
    for (const rec of cases) {
      const mc = mobile.aiCandidates(mobile.buildProposals(mobile.detectMissingFields(rec), lookup));
      const wc = web.aiCandidates(web.buildProposals(web.detectMissingFields(rec), lookup));
      const m = mobile.buildFillMissingInput("Lucia's", "PEPPERONI", "12in", mc, rec);
      const w = web.buildFillMissingInput("Lucia's", "PEPPERONI", "12in", wc, rec);
      expect(m).toEqual(w);
    }
  });

  it("isBlankValue agrees across kinds and values", () => {
    const probes: Array<[("number" | "text" | "select"), unknown]> = [
      ["number", 0],
      ["number", -1],
      ["number", 12],
      ["number", "0"],
      ["text", ""],
      ["text", "   "],
      ["text", "x"],
      ["select", ""],
      ["select", "costco"],
    ];
    for (const [kind, v] of probes) {
      expect(mobile.isBlankValue(kind, v)).toBe(web.isBlankValue(kind, v));
    }
  });
});
