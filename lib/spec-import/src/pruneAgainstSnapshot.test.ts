import { describe, it, expect } from "vitest";
import {
  mergePruneSnapshots,
  pruneSpecImportAgainstSnapshot,
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
  it("drops a fully unchanged profile", () => {
    const out = pruneSpecImportAgainstSnapshot(parsedOf([profile()]), parsedOf([profile()]));
    expect(out.parsed.profiles).toHaveLength(0);
    expect(out.unchangedProfiles).toBe(1);
  });

  it("keeps only the changed scalar fields of a partially changed profile", () => {
    const out = pruneSpecImportAgainstSnapshot(
      parsedOf([profile({ sauceOzPerPizza: 5 })]),
      parsedOf([profile()]),
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
      parsedOf([profile({ brand: "  basha's ", flavor: "CHEESE", dieType: "12 INCH " })]),
      parsedOf([profile()]),
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
