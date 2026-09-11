import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { clearMergeSuggestionCache, isCurrentMergeSuggestionRequest, suggestMerges } from "./mergeSuggest";
import {
  collectDeniedPairs,
  collectMergeAliases,
  deniedPairKey,
  filterDeniedSuggestions,
  mergeAliasKey,
  mergeSuggestionLists,
  suggestionsFromAliases,
  type DeniedMerge,
  type MergeAlias,
  type MergeSuggestion,
} from "@workspace/merge-suggest";

describe("mergeAliasKey", () => {
  it("is case-insensitive and trimmed", () => {
    expect(mergeAliasKey("  Pepperoni ")).toBe("pepperoni");
    expect(mergeAliasKey("PEPPERONI")).toBe(mergeAliasKey("pepperoni"));
  });
});

describe("collectMergeAliases", () => {
  it("maps each source to the target, dropping blanks/self/dupes", () => {
    expect(collectMergeAliases(["Peperoni", "pepperoni ", "", "  "], "Pepperoni")).toEqual([
      { externalName: "Peperoni", canonicalName: "Pepperoni" },
    ]);
  });

  it("dedupes sources case-insensitively, first spelling wins", () => {
    expect(collectMergeAliases(["Mozz", "MOZZ", "Mozz "], "Mozzarella")).toEqual([
      { externalName: "Mozz", canonicalName: "Mozzarella" },
    ]);
  });

  it("returns [] when target is blank", () => {
    expect(collectMergeAliases(["a", "b"], "   ")).toEqual([]);
  });
});

describe("suggestionsFromAliases", () => {
  const aliases: MergeAlias[] = [
    { externalName: "Peperoni", canonicalName: "Pepperoni" },
    { externalName: "Pep.", canonicalName: "Pepperoni" },
    { externalName: "Mozz", canonicalName: "Mozzarella" },
  ];

  it("re-proposes remembered merges only when BOTH names still exist", () => {
    const out = suggestionsFromAliases(["Pepperoni", "Peperoni", "Pep."], aliases);
    expect(out).toEqual([
      { target: "Pepperoni", sources: ["Peperoni", "Pep."], reason: "Previously merged" },
    ]);
  });

  it("drops a remembered merge whose target no longer exists (existence guard)", () => {
    // "Mozzarella" target absent → no suggestion even though "Mozz" is present.
    const out = suggestionsFromAliases(["Mozz", "Pepperoni", "Peperoni"], aliases);
    expect(out).toEqual([
      { target: "Pepperoni", sources: ["Peperoni"], reason: "Previously merged" },
    ]);
  });

  it("drops a remembered merge whose source no longer exists", () => {
    const out = suggestionsFromAliases(["Pepperoni"], aliases);
    expect(out).toEqual([]);
  });

  it("uses the current spelling of present names", () => {
    const out = suggestionsFromAliases(["PEPPERONI", "peperoni"], aliases);
    expect(out).toEqual([
      { target: "PEPPERONI", sources: ["peperoni"], reason: "Previously merged" },
    ]);
  });
});

describe("mergeSuggestionLists", () => {
  it("combines remembered + AI groups by shared target, remembered first", () => {
    const remembered: MergeSuggestion[] = [
      { target: "Pepperoni", sources: ["Peperoni"], reason: "Previously merged" },
    ];
    const ai: MergeSuggestion[] = [
      { target: "Pepperoni", sources: ["Pep."], reason: "ai" },
      { target: "Mozzarella", sources: ["Mozz"] },
    ];
    expect(mergeSuggestionLists(remembered, ai)).toEqual([
      { target: "Pepperoni", sources: ["Peperoni", "Pep."], reason: "Previously merged" },
      { target: "Mozzarella", sources: ["Mozz"] },
    ]);
  });

  it("never lets a source equal the target and drops empties", () => {
    const out = mergeSuggestionLists(
      [{ target: "Pepperoni", sources: ["Pepperoni"] }],
      [{ target: "Mozzarella", sources: ["Mozz"] }],
    );
    expect(out).toEqual([{ target: "Mozzarella", sources: ["Mozz"] }]);
  });
});

describe("deniedPairKey", () => {
  it("is order-independent and case-insensitive", () => {
    expect(deniedPairKey("Mozz", "Mozzarella")).toBe(deniedPairKey("Mozzarella", "Mozz"));
    expect(deniedPairKey("  MOZZ ", "mozzarella")).toBe(deniedPairKey("mozz", "Mozzarella"));
  });

  it("distinguishes different pairs", () => {
    expect(deniedPairKey("a", "b")).not.toBe(deniedPairKey("a", "c"));
  });
});

describe("collectDeniedPairs", () => {
  it("pairs each source with the target", () => {
    expect(collectDeniedPairs("Mozzarella", ["Mozz", "Moz"])).toEqual([
      { nameA: "Mozzarella", nameB: "Mozz" },
      { nameA: "Mozzarella", nameB: "Moz" },
    ]);
  });

  it("drops self-references and duplicates", () => {
    expect(collectDeniedPairs("Cheese", ["cheese", "Mozz", "MOZZ", ""])).toEqual([
      { nameA: "Cheese", nameB: "Mozz" },
    ]);
  });

  it("returns [] for a blank target", () => {
    expect(collectDeniedPairs("  ", ["x"])).toEqual([]);
  });
});

describe("filterDeniedSuggestions", () => {
  const suggestions: MergeSuggestion[] = [
    { target: "Mozzarella", sources: ["Mozz", "Moz"], reason: "dup" },
    { target: "Pepperoni", sources: ["Peperoni"] },
  ];

  it("removes a denied source, keeping the rest", () => {
    const denied: DeniedMerge[] = [{ nameA: "mozzarella", nameB: "mozz" }];
    const out = filterDeniedSuggestions(suggestions, denied);
    expect(out[0]).toEqual({ target: "Mozzarella", sources: ["Moz"], reason: "dup" });
    expect(out[1]).toEqual({ target: "Pepperoni", sources: ["Peperoni"] });
  });

  it("drops a suggestion left with no sources", () => {
    const denied: DeniedMerge[] = [{ nameA: "Pepperoni", nameB: "Peperoni" }];
    const out = filterDeniedSuggestions(suggestions, denied);
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe("Mozzarella");
  });

  it("is order-independent (denial direction does not matter)", () => {
    const denied: DeniedMerge[] = [{ nameA: "Moz", nameB: "Mozzarella" }];
    const out = filterDeniedSuggestions(suggestions, denied);
    expect(out[0].sources).toEqual(["Mozz"]);
  });

  it("returns the input unchanged when there are no denials", () => {
    expect(filterDeniedSuggestions(suggestions, [])).toBe(suggestions);
  });
});

describe("suggestMerges request lifecycle", () => {
  beforeEach(() => {
    clearMergeSuggestionCache();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        Promise.resolve({ ok: true, status: 200, json: async () => body }) as Promise<Response>;
      if (url.includes("/api/merge-aliases")) return json({ aliases: [] });
      if (url.includes("/api/denied-merges")) return json({ denied: [] });
      if (init?.signal?.aborted) {
        return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }
      return json({}, false, 404);
    }));
  });

  it("rejects a stale response when a newer request has started", () => {
    const controller = new AbortController();
    expect(isCurrentMergeSuggestionRequest(1, 2, controller.signal)).toBe(false);
    expect(isCurrentMergeSuggestionRequest(2, 2, controller.signal)).toBe(true);
    controller.abort();
    expect(isCurrentMergeSuggestionRequest(2, 2, controller.signal)).toBe(false);
  });

  afterEach(() => {
    clearMergeSuggestionCache();
    vi.unstubAllGlobals();
  });

  it("reuses results for the same master-data version and refresh bypasses cache", async () => {
    const first = await suggestMerges(["Pepperoni", "Peperoni"]);
    const second = await suggestMerges(["pePPeroni", " peperoni "]);
    expect(second).toEqual(first);

    await suggestMerges(["Pepperoni", "Peperoni"], undefined, undefined, undefined, { forceRefresh: true });
  });

  it("runs the deterministic scan without contacting an AI route", async () => {
    const result = await suggestMerges(
      ["Pepperoni", "Peperoni"],
      undefined,
      undefined,
      undefined,
      { forceRefresh: true },
    );

    expect(result.suggestions).toEqual([
      {
        target: "Pepperoni",
        sources: ["Peperoni"],
        reason: "Looks like the same item (spelling or word order)",
      },
    ]);
  });

});
