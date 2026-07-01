import { describe, it, expect } from "vitest";
import { deriveSourceKey, latestSourceKeyIds } from "./savedSpecSheets";

describe("deriveSourceKey", () => {
  it("normalizes a single filename (lowercase, strip ext, collapse ws)", () => {
    expect(deriveSourceKey(["Basha's  Original.xlsx"])).toBe("basha's original");
  });

  it("is order-independent and de-duplicates for multi-file imports", () => {
    const a = deriveSourceKey(["a.xlsx", "b.xls"]);
    const b = deriveSourceKey(["b.xls", "a.xlsx"]);
    expect(a).toBe(b);
    expect(deriveSourceKey(["a.xlsx", "a.xls"])).toBe("a");
  });

  it("returns undefined when no usable name is present", () => {
    expect(deriveSourceKey([])).toBeUndefined();
    expect(deriveSourceKey(["", "   "])).toBeUndefined();
  });
});

describe("latestSourceKeyIds", () => {
  it("marks the newest snapshot per distinct sourceKey", () => {
    const latest = latestSourceKeyIds([
      { id: 1, sourceKey: "dough", createdAt: 100 },
      { id: 2, sourceKey: "dough", createdAt: 200 },
      { id: 3, sourceKey: "sauce", createdAt: 150 },
    ]);
    expect(latest.has(2)).toBe(true); // newest dough
    expect(latest.has(3)).toBe(true); // only sauce
    expect(latest.has(1)).toBe(false); // older dough
  });

  it("groups legacy null/blank keys into ONE bucket (matches server '')", () => {
    const latest = latestSourceKeyIds([
      { id: 1, sourceKey: null, createdAt: 100 },
      { id: 2, sourceKey: undefined, createdAt: 300 },
      { id: 3, sourceKey: "   ", createdAt: 200 },
    ]);
    // Only the newest legacy row is "latest"; the rest are previous versions.
    expect([...latest]).toEqual([2]);
  });

  it("breaks createdAt ties deterministically by id desc", () => {
    const latest = latestSourceKeyIds([
      { id: 5, sourceKey: "x", createdAt: 100 },
      { id: 9, sourceKey: "x", createdAt: 100 },
    ]);
    expect([...latest]).toEqual([9]);
  });
});
