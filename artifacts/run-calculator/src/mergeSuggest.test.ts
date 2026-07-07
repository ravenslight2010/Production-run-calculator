import { describe, it, expect, vi, afterEach } from "vitest";
import { suggestMerges } from "./mergeSuggest";
import {
  collectDeniedPairs,
  collectMergeAliases,
  deniedPairKey,
  filterDeniedSuggestions,
  mergeAliasKey,
  mergeSuggestionLists,
  sanitizeMergeSuggestions,
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

describe("sanitizeMergeSuggestions", () => {
  const universe = ["Pepperoni", "Peperoni", "Mozzarella", "Mozz", "Cheddar"];

  it("keeps only groups whose target and sources are real known names", () => {
    const raw = {
      suggestions: [
        { target: "Pepperoni", sources: ["Peperoni", "Ghost Topping"], reason: "typo" },
        { target: "Mozzarella", sources: ["Mozz"] },
        { target: "Unknown Target", sources: ["Cheddar"] },
      ],
    };
    expect(sanitizeMergeSuggestions(raw, universe)).toEqual([
      { target: "Pepperoni", sources: ["Peperoni"], reason: "typo" },
      { target: "Mozzarella", sources: ["Mozz"] },
    ]);
  });

  it("returns the known-name spelling, not the model's casing", () => {
    const raw = { suggestions: [{ target: "pepperoni", sources: ["PEPERONI"] }] };
    expect(sanitizeMergeSuggestions(raw, universe)).toEqual([
      { target: "Pepperoni", sources: ["Peperoni"] },
    ]);
  });

  it("drops a group whose only source equals the target", () => {
    const raw = { suggestions: [{ target: "Pepperoni", sources: ["Pepperoni"] }] };
    expect(sanitizeMergeSuggestions(raw, universe)).toEqual([]);
  });

  it("dedupes sources and collapses one-group-per-target", () => {
    const raw = {
      suggestions: [
        { target: "Pepperoni", sources: ["Peperoni", "peperoni"] },
        { target: "PEPPERONI", sources: ["Mozz"] },
      ],
    };
    // second group is dropped (target already used); sources deduped
    expect(sanitizeMergeSuggestions(raw, universe)).toEqual([
      { target: "Pepperoni", sources: ["Peperoni"] },
    ]);
  });

  it("tolerates garbage shapes without throwing", () => {
    expect(sanitizeMergeSuggestions(null, universe)).toEqual([]);
    expect(sanitizeMergeSuggestions({ suggestions: "nope" }, universe)).toEqual([]);
    expect(sanitizeMergeSuggestions({ suggestions: [42, null, {}] }, universe)).toEqual([]);
  });

  it("accepts a bare array as well as a wrapped object", () => {
    const raw = [{ target: "Mozzarella", sources: ["Mozz"] }];
    expect(sanitizeMergeSuggestions(raw, universe)).toEqual([
      { target: "Mozzarella", sources: ["Mozz"] },
    ]);
  });

  it("bounds group and source counts", () => {
    const raw = {
      suggestions: [{ target: "Pepperoni", sources: ["Peperoni", "Mozz", "Mozzarella"] }],
    };
    const out = sanitizeMergeSuggestions(raw, universe, { maxSourcesPerGroup: 1 });
    expect(out).toEqual([{ target: "Pepperoni", sources: ["Peperoni"] }]);
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

describe("suggestMerges — conflicting descriptor guard (cured vs natural)", () => {
  function stubFetch(handlers: {
    aliases?: MergeAlias[];
    ai?: { suggestions: MergeSuggestion[] } | "fail";
  }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown, ok = true, status = 200) =>
          ({ ok, status, json: async () => body }) as Response;
        if (url.includes("/api/merge-aliases")) return json({ aliases: handlers.aliases ?? [] });
        if (url.includes("/api/denied-merges")) return json({ denied: [] });
        if (url.includes("/api/ai/suggest-merges")) {
          if (handlers.ai === "fail" || !handlers.ai) return json({ error: "nope" }, false, 403);
          return json(handlers.ai);
        }
        return json({}, false, 404);
      }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips a cured↔natural pairing from AI output (AI-success path)", async () => {
    stubFetch({
      ai: {
        suggestions: [
          { target: "Pepperoni Cured", sources: ["Pepperoni Natural"] },
          { target: "Mozzarella", sources: ["Mozarella"] },
        ],
      },
    });
    const res = await suggestMerges([
      "Pepperoni Cured",
      "Pepperoni Natural",
      "Mozzarella",
      "Mozarella",
    ]);
    expect(res.usedAi).toBe(true);
    expect(res.suggestions).toHaveLength(1);
    expect(res.suggestions[0].target).toBe("Mozzarella");
  });

  it("strips a remembered cured↔natural pairing (AI-fallback path)", async () => {
    stubFetch({
      aliases: [{ externalName: "Pepperoni Cured", canonicalName: "Pepperoni Natural" }],
      ai: "fail",
    });
    const res = await suggestMerges(["Pepperoni Cured", "Pepperoni Natural"]);
    expect(res.usedAi).toBe(false);
    expect(res.suggestions).toEqual([]);
  });
});
