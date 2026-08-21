// Unit tests for pickMixDuplicateLosers — the pure selection logic behind the
// one-time mix-duplicate-name-purge heal. Two imports minted the SAME mix under
// two ids (one hollow, one with real data); the heal must keep the real row and
// only ever delete true duplicates (same scope + ci name/brand/flavor).
// @workspace/db is mocked so importing dataHeals.ts stays side-effect free.
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  dataHealsTable: {},
  dailySyncTable: {},
  specImportAliasesTable: {},
  aiCorrectionsTable: {},
  importAliasesTable: {},
  cheeseRecipesTable: {},
  mixesTable: {},
  doughRecipesTable: {},
  sauceRecipesTable: {},
  brandProfilesTable: {},
}));

import { pickMixDuplicateLosers } from "./dataHeals";

type Row = {
  id: string;
  scope: string;
  name: string;
  brand: string;
  flavor: string;
  batchSize: number;
  components: { ingredient: string; perPizza?: number; perBatchLbs?: number }[];
  createdAt: Date;
};

const row = (over: Partial<Row>): Row => ({
  id: "id",
  scope: "live",
  name: "Bashas Red Fajita Mix",
  brand: "Basha's Original",
  flavor: "SUPREME",
  batchSize: 0,
  components: [],
  createdAt: new Date("2026-07-16T00:00:00Z"),
  ...over,
});

describe("pickMixDuplicateLosers", () => {
  it("drops the hollow duplicate and keeps the row with real amounts", () => {
    const hollow = row({
      id: "premix-basha-s-original-supreme-red-fajita-mix",
      components: [{ ingredient: "Red Onions", perPizza: 0 }],
    });
    const real = row({
      id: "premix-basha-s-original-supreme-bashas-red-fajita-mix",
      batchSize: 124.2,
      components: [
        { ingredient: "Red Onions", perPizza: 0.75, perBatchLbs: 31.05 },
      ],
      createdAt: new Date("2026-07-17T00:00:00Z"),
    });
    expect(pickMixDuplicateLosers([hollow, real])).toEqual([hollow]);
    expect(pickMixDuplicateLosers([real, hollow])).toEqual([hollow]);
  });

  it("prefers the OLDEST row when contents tie", () => {
    const older = row({ id: "a", createdAt: new Date("2026-07-01T00:00:00Z") });
    const newer = row({ id: "b", createdAt: new Date("2026-07-10T00:00:00Z") });
    expect(pickMixDuplicateLosers([older, newer])).toEqual([newer]);
    expect(pickMixDuplicateLosers([newer, older])).toEqual([newer]);
  });

  it("groups case-insensitively on trimmed name/brand/flavor", () => {
    const a = row({ id: "a", name: " bashas red fajita mix " });
    const b = row({ id: "b", batchSize: 5 });
    expect(pickMixDuplicateLosers([a, b])).toEqual([a]);
  });

  it("never deletes distinct mixes (different flavor, brand, or scope)", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", flavor: "DELUXE" }),
      row({ id: "c", brand: "Lucia's" }),
      row({ id: "d", scope: "sandbox" }),
      row({ id: "e", name: "White Fajita Mix" }),
    ];
    expect(pickMixDuplicateLosers(rows)).toEqual([]);
  });

  it("keeps exactly one winner in a 3-way duplicate group", () => {
    const hollow1 = row({ id: "a" });
    const hollow2 = row({ id: "b" });
    const real = row({
      id: "c",
      components: [{ ingredient: "X", perPizza: 1 }],
    });
    const losers = pickMixDuplicateLosers([hollow1, real, hollow2]);
    expect(losers.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });
});
