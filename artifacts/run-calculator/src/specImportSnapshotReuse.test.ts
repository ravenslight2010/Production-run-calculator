// @vitest-environment node
//
// Regression for exact-file parse reuse: re-importing a byte-identical file
// (same sourceKey + same SHA-256 sourceHash) must REUSE the previously saved
// snapshot's parse instead of re-running the AI. The AI's read of the same
// workbook can drift between calls (values swapping rows, a misread weight),
// and the re-import prune would treat that drift as real spec changes and
// clobber the user's data with it. Also locks:
//   • hashSpecImportSource determinism + multi-file order independence;
//   • selectReusableSnapshot exact-match-only selection (newest wins);
//   • commitSpecImport persisting the sourceHash with the new snapshot.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedSpecImport, ParsedProfile } from "@workspace/spec-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";

function fixtureProfile(over: Partial<ParsedProfile> = {}): ParsedProfile {
  return {
    brand: "Aldo's",
    flavor: "Cheese",
    dieType: "12 inch",
    sauceOzPerPizza: 4,
    applicators: [{ type: "Mozzarella", ozPerPizza: 5 }],
    pepperonis: [],
    ...over,
  };
}

function fixtureParse(): ParsedSpecImport {
  return { profiles: [fixtureProfile()], recipes: [] };
}

const { parseSpy, saveSheetSpy, fetchSheetsSpy, applySpy, aliasesRef } = vi.hoisted(() => ({
  parseSpy: vi.fn(async () => {
    throw new Error("AI parse must not run on exact re-import");
  }),
  saveSheetSpy: vi.fn(async () => {}),
  fetchSheetsSpy: vi.fn(async () => [] as unknown[]),
  applySpy: vi.fn(),
  aliasesRef: { current: [] as unknown[] },
}));

vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({ brands: [], flavorsByBrand: {} }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  isNameDeleted: () => false,
  flavorNamespace: (brand: string) => `flavors:${brand}`,
  applySpecImport: applySpy,
}));
vi.mock("./specImportAliases", () => ({
  fetchSpecImportAliases: async () => aliasesRef.current,
  saveSpecImportAliases: async () => {},
}));
vi.mock("./savedSpecSheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./savedSpecSheets")>();
  return {
    ...actual,
    saveSpecSheet: saveSheetSpy,
    fetchSavedSpecSheets: fetchSheetsSpy,
    buildSpecSheetLabel: () => "Sheet",
    loadCurrentReconcileRecipes: () => [],
  };
});
vi.mock("./parseSpecSheet", () => ({ requestParseSpecSheet: parseSpy }));
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in tests");
  },
}));
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [] as CheeseRecipe[],
  saveCheeseRecipes: async (items: CheeseRecipe[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [] as Mix[],
  saveMixes: async (items: Mix[]) => items,
}));

import {
  prepareSpecImport,
  prepareSpecImportMulti,
  commitSpecImport,
  hashSpecImportSource,
} from "./specImport";
import { selectReusableSnapshot } from "./savedSpecSheets";

function bufOf(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

beforeEach(() => {
  parseSpy.mockClear();
  saveSheetSpy.mockClear();
  applySpy.mockReset();
  fetchSheetsSpy.mockReset();
  fetchSheetsSpy.mockResolvedValue([]);
  aliasesRef.current = [];
});

describe("hashSpecImportSource", () => {
  it("is deterministic and 64-char hex for a single file", async () => {
    const a1 = await hashSpecImportSource([bufOf("hello")]);
    const a2 = await hashSpecImportSource([bufOf("hello")]);
    expect(a1).toBe(a2);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSpecImportSource([bufOf("other")])).not.toBe(a1);
  });

  it("is order-independent for multi-file imports and distinct from singles", async () => {
    const ab = await hashSpecImportSource([bufOf("a"), bufOf("b")]);
    const ba = await hashSpecImportSource([bufOf("b"), bufOf("a")]);
    expect(ab).toBe(ba);
    expect(ab).not.toBe(await hashSpecImportSource([bufOf("a")]));
  });

  it("returns undefined for an empty file list", async () => {
    expect(await hashSpecImportSource([])).toBeUndefined();
  });

  // The fingerprint must be salted with the parse-pipeline version: when the
  // AI prompt/parse pipeline improves, old snapshots' hashes stop matching so
  // a re-import of the SAME bytes re-runs the improved parse instead of
  // resurrecting a stale parse. Without the salt, a single file's fingerprint
  // would equal its raw SHA-256 and prompt fixes would never reach re-imports.
  it("salts the fingerprint with the parse version (single-file hash != raw file hash)", async () => {
    const { createHash } = await import("node:crypto");
    const raw = createHash("sha256").update(Buffer.from("hello")).digest("hex");
    expect(await hashSpecImportSource([bufOf("hello")])).not.toBe(raw);
  });
});

describe("selectReusableSnapshot", () => {
  const snap = (id: number, sourceKey: string | null, sourceHash: string | null, createdAt: number) =>
    ({ id, sourceKey, sourceHash, createdAt });

  it("matches only exact sourceKey + sourceHash, newest first", () => {
    const sheets = [
      snap(1, "specs", "h1", 100),
      snap(2, "specs", "h1", 200),
      snap(3, "specs", "h2", 300), // same key, different bytes
      snap(4, "other", "h1", 400), // different file set
      snap(5, null, "h1", 500), // legacy, no key
      snap(6, "specs", null, 600), // legacy, no hash
    ];
    expect(selectReusableSnapshot(sheets, "specs", "h1")?.id).toBe(2);
    expect(selectReusableSnapshot(sheets, "specs", "h3")).toBeUndefined();
    expect(selectReusableSnapshot(sheets, "missing", "h1")).toBeUndefined();
  });

  it("never matches on blank key or hash (legacy snapshots stay unreusable)", () => {
    const sheets = [snap(1, "", "", 100), snap(2, null, null, 200)];
    expect(selectReusableSnapshot(sheets, "", "")).toBeUndefined();
    expect(selectReusableSnapshot(sheets, "specs", "")).toBeUndefined();
    expect(selectReusableSnapshot(sheets, "", "h1")).toBeUndefined();
  });
});

describe("exact re-import parse reuse", () => {
  it("single file: reuses the stored parse and never calls the AI", async () => {
    const data = bufOf("workbook-bytes");
    const hash = await hashSpecImportSource([bufOf("workbook-bytes")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "specs", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);

    const prepared = await prepareSpecImport(data, "Specs.xlsx");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.parsed.profiles).toHaveLength(1);
    expect(prepared.parsed.profiles[0].sauceOzPerPizza).toBe(4);
    expect(prepared.sourceHash).toBe(hash);
    expect(prepared.newAliases).toEqual([]);
    expect(prepared.note).toMatch(/imported before/i);
  });

  it("remaps merged/renamed-away brands in the reused parse instead of resurrecting them", async () => {
    // Regression: reused snapshots skipped brand/flavor alias canonicalization,
    // so a re-import after a brand merge/rename resurrected the old brand (or
    // the tombstone partition silently dropped the profile).
    const data = bufOf("workbook-bytes");
    const hash = await hashSpecImportSource([bufOf("workbook-bytes")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "specs", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);
    aliasesRef.current = [
      { kind: "brand", externalName: "Aldo's", canonicalName: "Aldo Brothers", context: null },
    ];

    const prepared = await prepareSpecImport(data, "Specs.xlsx");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.parsed.profiles).toHaveLength(1);
    expect(prepared.parsed.profiles[0].brand).toBe("Aldo Brothers");
    expect(prepared.parsed.profiles[0].flavor).toBe("Cheese");
  });

  it("single file: changed bytes fall through to a fresh parse", async () => {
    const hash = await hashSpecImportSource([bufOf("old-bytes")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "specs", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);

    // Bytes differ → no reuse → the normal parse path runs (and rejects here
    // because the buffer isn't a real workbook / the AI stub throws).
    await expect(prepareSpecImport(bufOf("new-bytes"), "Specs.xlsx")).rejects.toThrow();
  });

  it("multi file: reuses only for the SAME file set, before buffers are consumed", async () => {
    const bufs = [bufOf("file-a"), bufOf("file-b")];
    const hash = await hashSpecImportSource([bufOf("file-a"), bufOf("file-b")]);
    fetchSheetsSpy.mockResolvedValue([
      { id: 1, label: "Prev", sourceKey: "a|b", sourceHash: hash, createdAt: 100, data: fixtureParse() },
    ]);

    const seen: Array<[number, number]> = [];
    const prepared = await prepareSpecImportMulti(bufs, (d, t) => seen.push([d, t]), [
      "b.xlsx",
      "a.xlsx",
    ]);

    expect(parseSpy).not.toHaveBeenCalled();
    expect(prepared.sourceHash).toBe(hash);
    expect(seen).toEqual([[2, 2]]);

    // A single-file re-import from that batch must NOT reuse the batch
    // snapshot (its data is the merged whole-batch parse).
    await expect(prepareSpecImport(bufOf("file-a"), "a.xlsx")).rejects.toThrow();
  });
});

describe("commitSpecImport snapshot hash persistence", () => {
  it("passes the prepared sourceHash to saveSpecSheet", async () => {
    const prepared = {
      parsed: fixtureParse(),
      newAliases: [],
      sourceNames: ["specs.xlsx"],
      sourceHash: "abc123",
    } as unknown as Parameters<typeof commitSpecImport>[0];

    await commitSpecImport(prepared);

    expect(saveSheetSpy).toHaveBeenCalledTimes(1);
    expect(saveSheetSpy.mock.calls[0][2]).toBe("specs");
    expect(saveSheetSpy.mock.calls[0][3]).toBe("abc123");
  });
});
