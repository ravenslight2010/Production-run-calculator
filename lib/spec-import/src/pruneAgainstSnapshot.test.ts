import { describe, it, expect } from "vitest";
import {
  mergePruneSnapshots,
  pruneSpecImportAgainstSnapshot,
  resolveImportName,
  type ImportMergeAliasMap,
  type ParsedProfile,
  type ParsedRecipe,
  type ParsedSpecImport,
} from "./index";

const profile = (over: Partial<ParsedProfile> = {}): ParsedProfile => ({
  brand: "Basha's",
  flavor: "Cheese",
  dieType: "12 inch",
  sauceOzPerPizza: 4,
  pizzasPerCase: 12,
  applicators: [{ type: "Mozzarella", ozPerPizza: 5 }],
  pepperonis: [{ type: "Pepperoni", sticks: 2, ozPerPizza: 1.5 }],
  ...over,
});

const recipe = (over: Partial<ParsedRecipe> = {}): ParsedRecipe => ({
  kind: "sauce",
  name: "Basha's Sauce",
  rows: [
    { ingredient: "Tomato Paste", lbs: 20 },
    { ingredient: "Water", lbs: 10 },
  ],
  ...over,
});

const parsedOf = (p: ParsedProfile[], r: ParsedRecipe[] = []): ParsedSpecImport => ({
  profiles: p,
  recipes: r,
});

describe("pruneSpecImportAgainstSnapshot", () => {
  it("drops a fully unchanged profile with no name links or applicators", () => {
    const bare = { applicators: [], sauceName: undefined, doughName: undefined };
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([profile(bare)]),
      parsedOf([profile(bare)]),
    );
    expect(out.parsed.profiles).toHaveLength(0);
    expect(out.unchangedProfiles).toBe(1);
  });

  it("keeps an otherwise-unchanged profile that carries applicators (slot links always re-apply)", () => {
    // Applicator lists are never pruned as "unchanged": the mix/cheese slot
    // name links are re-resolved from them at apply time, and the snapshot
    // records what the sheet said — not what the profile actually stores.
    const out = pruneSpecImportAgainstSnapshot(parsedOf([profile()]), parsedOf([profile()]));
    expect(out.parsed.profiles).toHaveLength(1);
    expect(out.parsed.profiles[0].applicators).toHaveLength(1);
    expect(out.unchangedProfiles).toBe(0);
  });

  it("always keeps sauceName/doughName even when identical to the snapshot", () => {
    // Regression guard (Hannaford Tikka Masala): a prior bad import wrote a
    // wrong name link while the sheet stayed identical — a correcting
    // re-import must still push the sheet's name through to the apply step.
    const withNames = { applicators: [] as ParsedProfile["applicators"], sauceName: "Tikka Masala Sauce", doughName: "CRB Dough" };
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([profile(withNames)]),
      parsedOf([profile(withNames)]),
    );
    expect(out.parsed.profiles).toHaveLength(1);
    expect(out.parsed.profiles[0].sauceName).toBe("Tikka Masala Sauce");
    expect(out.parsed.profiles[0].doughName).toBe("CRB Dough");
    expect(out.unchangedProfiles).toBe(0);
  });

  it("keeps only the changed scalar fields of a partially changed profile", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([profile({ sauceOzPerPizza: 5, applicators: [] })]),
      parsedOf([profile({ applicators: [] })]),
    );
    expect(out.parsed.profiles).toHaveLength(1);
    const p = out.parsed.profiles[0];
    expect(p.sauceOzPerPizza).toBe(5);
    expect(p.dieType).toBeUndefined();
    expect(p.pizzasPerCase).toBeUndefined();
    expect(p.applicators).toEqual([]);
    expect(p.pepperonis).toEqual([]);
  });

  it("keeps the WHOLE applicator array when any slot changed (atomic)", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([
        profile({
          applicators: [
            { type: "Mozzarella", ozPerPizza: 6 },
            { type: "Cheddar", ozPerPizza: 2 },
          ],
        }),
      ]),
      parsedOf([profile({ applicators: [{ type: "Mozzarella", ozPerPizza: 5 }, { type: "Cheddar", ozPerPizza: 2 }] })]),
    );
    expect(out.parsed.profiles[0].applicators).toHaveLength(2);
  });

  it("keeps the WHOLE pepperoni array when any slot changed (atomic)", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([profile({ pepperonis: [{ type: "Pepperoni", sticks: 3, ozPerPizza: 1.5 }] })]),
      parsedOf([profile()]),
    );
    expect(out.parsed.profiles[0].pepperonis).toHaveLength(1);
  });

  it("compares brand/flavor and names case-insensitively with trim", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([profile({ brand: "  basha's ", flavor: "CHEESE", dieType: "12 INCH ", applicators: [] })]),
      parsedOf([profile({ applicators: [] })]),
    );
    expect(out.parsed.profiles).toHaveLength(0);
  });

  it("keeps a profile with no previous snapshot entry untouched", () => {
    const p = profile({ brand: "New Brand" });
    const out = pruneSpecImportAgainstSnapshot(parsedOf([p]), parsedOf([profile()]));
    expect(out.parsed.profiles[0]).toEqual(p);
    expect(out.unchangedProfiles).toBe(0);
  });

  it("flips an unchanged recipe to referenceOnly (rows order-insensitive)", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([], [recipe({ rows: [{ ingredient: "Water", lbs: 10 }, { ingredient: "tomato paste", lbs: 20 }] })]),
      parsedOf([], [recipe()]),
    );
    expect(out.parsed.recipes[0].referenceOnly).toBe(true);
    expect(out.unchangedRecipes).toBe(1);
  });

  it("keeps a recipe whose rows changed", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([], [recipe({ rows: [{ ingredient: "Tomato Paste", lbs: 25 }, { ingredient: "Water", lbs: 10 }] })]),
      parsedOf([], [recipe()]),
    );
    expect(out.parsed.recipes[0].referenceOnly).toBeUndefined();
    expect(out.unchangedRecipes).toBe(0);
  });

  it("matches recipes by loose name key (case/punctuation drift across parses)", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([], [recipe({ name: "bashas sauce" })]),
      parsedOf([], [recipe({ name: "Basha's  Sauce" })]),
    );
    expect(out.parsed.recipes[0].referenceOnly).toBe(true);
  });

  it("keeps a dough recipe whose doughball weight changed even with identical rows", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([], [recipe({ kind: "dough", name: "Master Dough", doughballOz: 19 })]),
      parsedOf([], [recipe({ kind: "dough", name: "Master Dough", doughballOz: 18 })]),
    );
    expect(out.parsed.recipes[0].referenceOnly).toBeUndefined();
  });

  it("does not match a recipe of a different kind with the same name", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([], [recipe({ kind: "cheese" })]),
      parsedOf([], [recipe({ kind: "sauce" })]),
    );
    expect(out.parsed.recipes[0].referenceOnly).toBeUndefined();
  });

  it("never overrides an explicit user referenceOnly pick and ignores referenceOnly snapshots", () => {
    const userPick = recipe({ referenceOnly: true, rows: [] });
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([], [userPick, recipe({ name: "Other Sauce" })]),
      parsedOf([], [recipe({ name: "Other Sauce", referenceOnly: true })]),
    );
    expect(out.parsed.recipes[0]).toEqual(userPick);
    expect(out.parsed.recipes[1].referenceOnly).toBeUndefined();
  });

  it("never demotes an explicit 'update existing' pick, even when the sheet is unchanged", () => {
    // The user linked the parsed recipe to an existing pool recipe AND checked
    // "update it with this sheet" — the pool copy may have drifted from the
    // sheet, so an unchanged re-import must still carry the update through.
    const userPick = recipe({ updateExisting: true });
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([], [userPick]),
      parsedOf([], [recipe()]),
    );
    expect(out.parsed.recipes[0]).toEqual(userPick);
    expect(out.parsed.recipes[0].referenceOnly).toBeUndefined();
    expect(out.unchangedRecipes).toBe(0);
  });

  it("does not mutate its inputs", () => {
    const parsed = parsedOf([profile()], [recipe()]);
    const snapshot = JSON.parse(JSON.stringify(parsed)) as ParsedSpecImport;
    const parsedCopy = JSON.parse(JSON.stringify(parsed));
    pruneSpecImportAgainstSnapshot(parsed, snapshot);
    expect(parsed).toEqual(parsedCopy);
  });
});

describe("resolveImportName", () => {
  const aliases: ImportMergeAliasMap = {
    sauce: [
      { externalName: "Old Tikka Sauce", canonicalName: "Tikka Masala Sauce" },
    ],
    mixes: [
      { externalName: "Fajita Mix", canonicalName: "White Fajita Mix" },
      { externalName: "White Fajita Mix", canonicalName: "Fajita Blend Mix" },
    ],
    cheese: [
      // Malformed cycle — must not loop.
      { externalName: "Blend A", canonicalName: "Blend B" },
      { externalName: "Blend B", canonicalName: "Blend A" },
    ],
  };

  it("returns the spec name unchanged when no mapping exists", () => {
    expect(resolveImportName("Marinara Sauce", "sauce", aliases)).toBe("Marinara Sauce");
    expect(resolveImportName("Marinara Sauce", "sauce", undefined)).toBe("Marinara Sauce");
    expect(resolveImportName("  Marinara Sauce ", "dough", aliases)).toBe("Marinara Sauce");
  });

  it("writes the merge target when the spec name is a merge source", () => {
    expect(resolveImportName("Old Tikka Sauce", "sauce", aliases)).toBe("Tikka Masala Sauce");
  });

  it("matches the merged-away side case-insensitively with trim", () => {
    expect(resolveImportName("  old tikka SAUCE ", "sauce", aliases)).toBe("Tikka Masala Sauce");
  });

  it("only consults the given category", () => {
    expect(resolveImportName("Old Tikka Sauce", "dough", aliases)).toBe("Old Tikka Sauce");
  });

  it("follows chained merges to the current canonical name", () => {
    expect(resolveImportName("Fajita Mix", "mixes", aliases)).toBe("Fajita Blend Mix");
  });

  it("is cycle-safe on malformed alias data", () => {
    expect(resolveImportName("Blend A", "cheese", aliases)).toBe("Blend B");
    expect(resolveImportName("Blend B", "cheese", aliases)).toBe("Blend A");
  });

  it("handles blank input", () => {
    expect(resolveImportName("", "sauce", aliases)).toBe("");
    expect(resolveImportName("   ", "sauce", aliases)).toBe("");
  });
});

describe("mergePruneSnapshots", () => {
  it("unions profiles and recipes across snapshots", () => {
    const merged = mergePruneSnapshots([
      parsedOf([profile()], [recipe()]),
      parsedOf([profile({ brand: "Other", flavor: "Pep" })], [recipe({ name: "Other Sauce" })]),
    ]);
    expect(merged.profiles).toHaveLength(2);
    expect(merged.recipes).toHaveLength(2);
  });

  it("keeps the FIRST (newest) occurrence on duplicate identities", () => {
    const newest = parsedOf(
      [profile({ sauceOzPerPizza: 9 })],
      [recipe({ rows: [{ ingredient: "Basil", lbs: 3 }] })],
    );
    const older = parsedOf([profile()], [recipe()]);
    const merged = mergePruneSnapshots([newest, older]);
    expect(merged.profiles).toHaveLength(1);
    expect(merged.profiles[0].sauceOzPerPizza).toBe(9);
    expect(merged.recipes).toHaveLength(1);
    expect(merged.recipes[0].rows).toEqual([{ ingredient: "Basil", lbs: 3 }]);
  });

  it("dedupes profiles ci-trim on brand+flavor and recipes on kind + loose name key", () => {
    const merged = mergePruneSnapshots([
      parsedOf([profile({ brand: " BASHA'S ", flavor: "cheese" })], [recipe({ name: "bashas sauce" })]),
      parsedOf([profile()], [recipe({ name: "Basha's  Sauce" }), recipe({ kind: "cheese", name: "Basha's Sauce" })]),
    ]);
    expect(merged.profiles).toHaveLength(1);
    // Same loose name but different kind is a distinct identity.
    expect(merged.recipes).toHaveLength(2);
  });

  it("handles empty input and snapshots with missing arrays", () => {
    expect(mergePruneSnapshots([])).toEqual({ profiles: [], recipes: [] });
    const merged = mergePruneSnapshots([{} as ParsedSpecImport, parsedOf([profile()])]);
    expect(merged.profiles).toHaveLength(1);
    expect(merged.recipes).toHaveLength(0);
  });
});
