// @vitest-environment jsdom
//
// Pool-aware applicator-slot heal (v2 of the mix-slot cleanup) + the stale
// cheese-link collector that feeds the Cheese merge tab. Covers the two gaps
// the v1 word-heuristic migration left open: TYPE slots holding an exact
// server pool name (regardless of wording, e.g. "Gyro Cheese Blend") and
// per-run values (v1 only rewrote profiles).

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildPoolLookup,
  healApplicatorSlotValues,
  collectStaleCheeseLinkNames,
} from "./mergeRecipeNames";
import {
  applyPoolAwareSlotHealIfNeeded,
  loadProfile,
  saveBrandFlavors,
  loadRunValues,
  loadList,
  loadDeletedItems,
  saveList,
} from "./storage";
import { PROFILE_KEY, INGREDIENT_TYPES_KEY, RUN_KEY } from "./types";

const CHEESE_POOL = ["HT Standard Cheese Mix", "Four Hands Gyro Cheese Blend", "Aldo's Cheese Mix"];
const MIX_POOL = ["White Fajita Mix"];

function pools(allow: string[] = []) {
  return {
    cheese: buildPoolLookup(CHEESE_POOL),
    mixes: buildPoolLookup(MIX_POOL),
    allowlist: new Set(["mix", "cheese", "pepperoni", ...allow].map((n) => n.toLowerCase())),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("healApplicatorSlotValues", () => {
  it("converts a TYPE slot holding an exact cheese pool name (canonical casing into the link)", () => {
    const { values, changed } = healApplicatorSlotValues(
      { app2Type: "ht standard cheese mix", app2CheeseRecipeName: "" },
      pools(),
    );
    expect(changed).toBe(true);
    expect(values.app2Type).toBe("cheese");
    expect(values.app2CheeseRecipeName).toBe("HT Standard Cheese Mix");
  });

  it("converts a pool name WITHOUT the word 'mix' (v1's blind spot)", () => {
    const { values, changed } = healApplicatorSlotValues(
      { app3Type: "Four Hands Gyro Cheese Blend" },
      pools(),
    );
    expect(changed).toBe(true);
    expect(values.app3Type).toBe("cheese");
    expect(values.app3CheeseRecipeName).toBe("Four Hands Gyro Cheese Blend");
  });

  it("converts a mix pool name to the generic 'Mix' type", () => {
    const { values } = healApplicatorSlotValues({ app1Type: "White Fajita Mix" }, pools());
    expect(values.app1Type).toBe("Mix");
    expect(values.app1CheeseRecipeName).toBe("White Fajita Mix");
  });

  it("falls back to the word heuristic for non-pool names ('blend' counts as cheese)", () => {
    const { values } = healApplicatorSlotValues({ app4Type: "Gyro Cheese Blend" }, pools());
    expect(values.app4Type).toBe("cheese");
    // Raw name kept as the link so it stays visible + mergeable.
    expect(values.app4CheeseRecipeName).toBe("Gyro Cheese Blend");
  });

  it("never clobbers an existing DIFFERENT link name", () => {
    const { values } = healApplicatorSlotValues(
      { app2Type: "HT Standard Cheese Mix", app2CheeseRecipeName: "Aldo's Cheese Mix" },
      pools(),
    );
    expect(values.app2Type).toBe("cheese");
    expect(values.app2CheeseRecipeName).toBe("Aldo's Cheese Mix");
  });

  it("leaves generic types, pep types, and real ingredients alone", () => {
    const { changed } = healApplicatorSlotValues(
      { app1Type: "cheese", app2Type: "Mix", app3Type: "Pepperoni", app4Type: "" },
      pools(),
    );
    expect(changed).toBe(false);
  });
});

describe("collectStaleCheeseLinkNames", () => {
  it("returns link names matching no pool name, deduped case-insensitively", () => {
    const poolCi = new Set(CHEESE_POOL.map((n) => n.toLowerCase()));
    const stale = collectStaleCheeseLinkNames(
      [
        { app1CheeseRecipeName: "Aldo's Standard Cheese Mix" },
        { app2CheeseRecipeName: "aldo's standard cheese mix" },
        { app3CheeseRecipeName: "Aldo's Cheese Mix" }, // in pool → excluded
        { app4CheeseRecipeName: "" },
      ],
      poolCi,
    );
    expect(stale).toEqual(["Aldo's Standard Cheese Mix"]);
  });
});

describe("applyPoolAwareSlotHealIfNeeded", () => {
  it("skips while pools are empty, then heals once loaded", () => {
    saveBrandFlavors({ Aldo: ["Pepperoni"] });
    localStorage.setItem(
      PROFILE_KEY("Aldo", "Pepperoni"),
      JSON.stringify({ app2Type: "HT Standard Cheese Mix" }),
    );
    expect(applyPoolAwareSlotHealIfNeeded([], [])).toEqual([]);

    applyPoolAwareSlotHealIfNeeded(CHEESE_POOL, MIX_POOL);
    const prof = (loadProfile("Aldo", "Pepperoni") ?? {}) as Record<string, unknown>;
    expect(prof.app2Type).toBe("cheese");
    expect(prof.app2CheeseRecipeName).toBe("HT Standard Cheese Mix");
  });

  it("heals per-run values and returns their run ids", () => {
    localStorage.setItem(
      RUN_KEY("run-a"),
      JSON.stringify({ app1Type: "Four Hands Gyro Cheese Blend", app1CheeseRecipeName: "" }),
    );
    localStorage.setItem(RUN_KEY("run-b"), JSON.stringify({ app1Type: "cheese" }));
    const affected = applyPoolAwareSlotHealIfNeeded(CHEESE_POOL, MIX_POOL);
    expect(affected).toEqual(["run-a"]);
    const vals = loadRunValues("run-a") as unknown as Record<string, unknown>;
    expect(vals.app1Type).toBe("cheese");
    expect(vals.app1CheeseRecipeName).toBe("Four Hands Gyro Cheese Blend");
  });

  it("drops pool names leaked into ingredientTypes, with tombstones", () => {
    saveList(INGREDIENT_TYPES_KEY, ["Pepperoni", "HT Standard Cheese Mix"]);
    applyPoolAwareSlotHealIfNeeded(CHEESE_POOL, MIX_POOL);
    expect(loadList(INGREDIENT_TYPES_KEY, [])).toEqual(["Pepperoni"]);
    expect(loadDeletedItems().ingredientTypes ?? []).toContain("ht standard cheese mix");
  });

  it("is RECURRING — a leak that appears after an earlier pass still gets healed", () => {
    applyPoolAwareSlotHealIfNeeded(CHEESE_POOL, MIX_POOL);
    localStorage.setItem(RUN_KEY("late"), JSON.stringify({ app1Type: "HT Standard Cheese Mix" }));
    expect(applyPoolAwareSlotHealIfNeeded(CHEESE_POOL, MIX_POOL)).toEqual(["late"]);
    const vals = loadRunValues("late") as unknown as Record<string, unknown>;
    expect(vals.app1Type).toBe("cheese");
  });

  it("does nothing on a converged device (idempotent, no writes needed)", () => {
    localStorage.setItem(RUN_KEY("ok"), JSON.stringify({ app1Type: "cheese" }));
    expect(applyPoolAwareSlotHealIfNeeded(CHEESE_POOL, MIX_POOL)).toEqual([]);
  });
});
