// Regression tests for the catalog side of an ingredient merge: applying a
// merge must push the post-merge catalog back to the caller (which seeds the
// ["ingredients"] React Query cache) so the unified ingredient universe drops
// the merged-away name IMMEDIATELY instead of waiting out the 60s poll.
import { describe, it, expect, vi } from "vitest";
import { mergeCatalogEntriesByName } from "./ingredients";
import type { Ingredient } from "@workspace/ingredient-catalog";

function mkIng(overrides: Partial<Ingredient> & { id: string; name: string }): Ingredient {
  return { categories: ["general"], mergedInto: null, enabled: true, ...overrides };
}

describe("mergeCatalogEntriesByName", () => {
  it("merges known sources into the target and reports the post-merge catalog", async () => {
    const catalog = [mkIng({ id: "t", name: "Mozzarella" }), mkIng({ id: "s", name: "Mozz" })];
    const postMerge = [
      mkIng({ id: "t", name: "Mozzarella" }),
      mkIng({ id: "s", name: "Mozz", mergedInto: "t", enabled: false }),
    ];
    const save = vi.fn();
    const merge = vi.fn(async () => postMerge);
    const onCatalog = vi.fn();

    await mergeCatalogEntriesByName(catalog, ["Mozz"], "Mozzarella", onCatalog, { save, merge });

    expect(save).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith(["s"], "t");
    // The cache-seeding callback must receive the authoritative post-merge
    // catalog — this is what makes the merged-away name vanish immediately.
    expect(onCatalog).toHaveBeenCalledTimes(1);
    expect(onCatalog).toHaveBeenCalledWith(postMerge);
  });

  it("matches source and target names case-insensitively with trimming", async () => {
    const catalog = [mkIng({ id: "t", name: "Mozzarella" }), mkIng({ id: "s", name: "  MOZZ " })];
    const merge = vi.fn(async () => catalog);
    const onCatalog = vi.fn();

    await mergeCatalogEntriesByName(catalog, ["mozz"], "  mozzarella ", onCatalog, {
      save: vi.fn(),
      merge,
    });

    expect(merge).toHaveBeenCalledWith(["s"], "t");
  });

  it("creates the target when the catalog doesn't know it, reporting each write", async () => {
    const catalog = [mkIng({ id: "s", name: "Mozz" })];
    const save = vi.fn(async (items: Ingredient[]) => [...catalog, ...items]);
    const merge = vi.fn(async () => [] as Ingredient[]);
    const onCatalog = vi.fn();

    await mergeCatalogEntriesByName(catalog, ["Mozz"], "Mozzarella", onCatalog, { save, merge });

    expect(save).toHaveBeenCalledTimes(1);
    const created = save.mock.calls[0][0][0];
    expect(created.name).toBe("Mozzarella");
    expect(merge).toHaveBeenCalledWith(["s"], created.id);
    // Once for the target creation, once for the merge result.
    expect(onCatalog).toHaveBeenCalledTimes(2);
  });

  it("skips the merge call when no source is in the catalog", async () => {
    const catalog = [mkIng({ id: "t", name: "Mozzarella" })];
    const merge = vi.fn();
    const onCatalog = vi.fn();

    await mergeCatalogEntriesByName(catalog, ["Never Seen"], "Mozzarella", onCatalog, {
      save: vi.fn(),
      merge,
    });

    expect(merge).not.toHaveBeenCalled();
    expect(onCatalog).not.toHaveBeenCalled();
  });

  it("never merges the target into itself", async () => {
    const catalog = [mkIng({ id: "t", name: "Mozzarella" })];
    const merge = vi.fn();

    await mergeCatalogEntriesByName(catalog, ["mozzarella"], "Mozzarella", vi.fn(), {
      save: vi.fn(),
      merge,
    });

    expect(merge).not.toHaveBeenCalled();
  });

  it("propagates server failures so the caller can treat them as best-effort", async () => {
    const catalog = [mkIng({ id: "t", name: "Mozzarella" }), mkIng({ id: "s", name: "Mozz" })];
    const merge = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      mergeCatalogEntriesByName(catalog, ["Mozz"], "Mozzarella", vi.fn(), {
        save: vi.fn(),
        merge,
      }),
    ).rejects.toThrow("boom");
  });
});
