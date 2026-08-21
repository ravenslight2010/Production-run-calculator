// @vitest-environment jsdom
//
// End-to-end commit-path regression check for authoritative spec imports.
// The fetch harness below models the brand-profiles API's normal and forced
// LWW behavior while the real profileServerSync module performs the queue,
// POST, acknowledgement, and later reconcile work.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedProfile, ParsedSpecImport } from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

const { applySpy } = vi.hoisted(() => ({
  applySpy: vi.fn(),
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({}),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  applySpecImport: applySpy,
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => [],
  saveSpecImportAliases: async () => {},
  deleteSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", () => ({
  saveSpecSheet: async () => {},
  fetchSavedSpecSheets: async () => [],
  buildSpecSheetLabel: () => "Representative spec",
  deriveSourceKey: () => "representative-spec",
  selectPruneSnapshots: () => [],
  loadCurrentReconcileRecipes: () => [],
}));
vi.mock("./parseSpecSheet", () => ({
  requestParseSpecSheet: vi.fn(),
  makeParseCallPacer: () => async () => {},
  ParseSpecRateLimitError: class extends Error {},
  PARSE_RATE_WINDOW_MS: 62_000,
}));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("matcher is not part of the commit regression");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: async () => [],
  saveNamedRecipes: async () => [],
  addNamedRecipesToServerIfAbsent: async () => ({ added: 0, updated: 0, items: [] }),
}));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));
vi.mock("./dieLineDefaultsServer", () => ({
  fetchDieLineDefaults: async () => [],
  toOverridesMap: () => ({}),
}));
vi.mock("./mergeSuggest", () => ({
  fetchMergeAliases: async () => [],
}));

import { commitSpecImport } from "./specImport";
import {
  canonicalProfileKey,
  flushProfileQueue,
  reconcileProfilesFromServer,
  resetProfileSyncMemoryFallbackForTests,
} from "./profileServerSync";

const profileKey = canonicalProfileKey("Acme", "Pepperoni");
const importedValues = {
  frontlineRecipeName: "Imported Marinara",
  app1CheeseRecipeName: "Imported Blend",
};
const importedProfile: ParsedProfile = {
  brand: "Acme",
  flavor: "Pepperoni",
  sauceName: "Imported Marinara",
  doughName: "Classic Dough",
  sauceOzPerPizza: 4,
  applicators: [{ type: "Imported Blend", ozPerPizza: 5 }],
  pepperonis: [],
};

type ServerProfile = {
  key: string;
  brand: string;
  flavor: string;
  values: Record<string, unknown>;
  crustValues: Record<string, unknown>;
  updatedAt: number;
};

let serverProfile: ServerProfile;

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function prepareImport(): Parameters<typeof commitSpecImport>[0] {
  return {
    parsed: {
      profiles: [importedProfile],
      recipes: [],
    },
    newAliases: [],
    sourceNames: ["representative-spec.xlsx"],
  } as Parameters<typeof commitSpecImport>[0];
}

beforeEach(() => {
  localStorage.clear();
  resetProfileSyncMemoryFallbackForTests();
  serverProfile = {
    key: profileKey,
    brand: "Acme",
    flavor: "Pepperoni",
    values: { frontlineRecipeName: "Wrong Newer Value" },
    crustValues: {},
    updatedAt: 9000,
  };

  // This is the local write performed by applySpecImport in the production
  // storage glue. Keeping it in the harness lets commitSpecImport and the real
  // profile queue operate without replacing either piece of the chain.
  applySpy.mockReset();
  applySpy.mockImplementation((parsed: ParsedSpecImport) => {
    const p = parsed.profiles[0];
    localStorage.setItem(
      `run-calc-profile-${canonicalProfileKey(p.brand, p.flavor)}`,
      JSON.stringify(importedValues),
    );
    localStorage.setItem(
      `run-calc-crust-profile-${canonicalProfileKey(p.brand, p.flavor)}`,
      JSON.stringify({}),
    );
    return {
      touchedProfiles: [{ brand: p.brand, flavor: p.flavor }],
      crustProfiles: [],
    };
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url !== "/api/brand-profiles") {
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }
      if (method === "GET") return response({ items: [serverProfile] });
      if (method !== "POST") throw new Error(`Unexpected method: ${method}`);

      const body = JSON.parse(String(init?.body)) as {
        items: Array<ServerProfile & { force?: boolean }>;
      };
      for (const item of body.items) {
        if (item.force) {
          serverProfile = {
            ...item,
            updatedAt: Math.max(serverProfile.updatedAt + 1, item.updatedAt),
          };
        } else if (item.updatedAt > serverProfile.updatedAt) {
          serverProfile = { ...item };
        }
      }
      return response({ items: [serverProfile] });
    }),
  );
});

describe("spec-import authoritative apply commit path", () => {
  it("beats a newer wrong profile and stays authoritative through reconcile", async () => {
    // The conflicting profile is already persisted with a newer stamp, as can
    // happen when another device or a server heal writes after preparation.
    expect(serverProfile.updatedAt).toBe(9000);
    expect(serverProfile.values.frontlineRecipeName).toBe("Wrong Newer Value");

    await commitSpecImport(prepareImport());

    expect(serverProfile.values).toEqual(importedValues);
    expect(serverProfile.updatedAt).toBeGreaterThan(9000);

    // A normal reconcile must not re-adopt or re-publish the stale wrong row
    // after the forced acknowledgement has advanced the local stamp.
    await reconcileProfilesFromServer();
    await flushProfileQueue();

    expect(serverProfile.values).toEqual(importedValues);
    expect(serverProfile.updatedAt).toBeGreaterThan(9000);
  });
});