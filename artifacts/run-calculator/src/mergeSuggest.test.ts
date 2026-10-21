import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  clearMergeSuggestionCache,
  denyMerge,
  isCurrentMergeSuggestionRequest,
  saveConfirmedMergeAliasesBestEffort,
  suggestMerges,
} from "./mergeSuggest";
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

  it("invalidates cached suggestions after saving a category-scoped denial", async () => {
    const names = ["Pepperoni", "Peperoni"];
    let denied = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        Promise.resolve({ ok: true, status: 200, json: async () => body }) as Promise<Response>;
      if (url.includes("/api/merge-aliases")) return json({ aliases: [] });
      if (url.includes("/api/denied-merges") && init?.method === "POST") {
        denied = true;
        return json({ denied: [{ nameA: "peperoni", nameB: "pepperoni" }] });
      }
      if (url.includes("/api/denied-merges")) {
        return json({
          denied: denied ? [{ nameA: "peperoni", nameB: "pepperoni" }] : [],
        });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const beforeIgnore = await suggestMerges(names, "dough");
    expect(beforeIgnore.suggestions).toHaveLength(1);
    await denyMerge("Pepperoni", ["Peperoni"], "dough");
    const afterIgnore = await suggestMerges(names, "dough");

    expect(afterIgnore.suggestions).toEqual([]);
    const save = fetchMock.mock.calls.find(([input, init]) =>
      String(input) === "/api/denied-merges" && init?.method === "POST",
    );
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({
      pairs: [{ nameA: "Pepperoni", nameB: "Peperoni" }],
      category: "dough",
    });
  });

  it("sends the brand only for flavor denials", async () => {
    const fetchMock = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ denied: [] }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    await denyMerge("BBQ", ["Barbecue"], "flavor", "Brand A");
    await denyMerge("BBQ", ["Barbecue"], "sauce", "Brand B");

    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies).toEqual([
      {
        pairs: [{ nameA: "BBQ", nameB: "Barbecue" }],
        category: "flavor",
        brand: "Brand A",
      },
      {
        pairs: [{ nameA: "BBQ", nameB: "Barbecue" }],
        category: "sauce",
      },
    ]);
  });

});

describe("saveConfirmedMergeAliasesBestEffort", () => {
  const response = (body: unknown, status = 200): Response =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retargets existing aliases before saving the direct source mapping", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === "POST") return response({ aliases: [] });
      return response({ aliases: [{ externalName: "A", canonicalName: "B" }] });
    }));

    await saveConfirmedMergeAliasesBestEffort(["B"], "C");

    expect(calls.map((call) => call.url)).toEqual([
      "/api/merge-aliases",
      "/api/merge-aliases",
    ]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      aliases: [
        { externalName: "A", canonicalName: "C" },
        { externalName: "B", canonicalName: "C" },
      ],
    });
  });

  it.each([
    { category: "mixes" as const, brand: undefined, expectedGet: "/api/merge-aliases?category=mixes" },
    { category: "dough" as const, brand: undefined, expectedGet: "/api/merge-aliases?category=dough" },
    { category: "sauce" as const, brand: undefined, expectedGet: "/api/merge-aliases?category=sauce" },
    { category: "cheese" as const, brand: undefined, expectedGet: "/api/merge-aliases?category=cheese" },
    { category: "brand" as const, brand: undefined, expectedGet: "/api/merge-aliases?category=brand" },
    { category: "flavor" as const, brand: "Brand A", expectedGet: "/api/merge-aliases?category=flavor&brand=Brand+A" },
  ])("keeps $category aliases in their category and brand scope", async ({ category, brand, expectedGet }) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const aliasesByScope = new Map<string, MergeAlias[]>([
      ["ingredient|", [{ externalName: "A", canonicalName: "B" }]],
      ["mixes|", [{ externalName: "A", canonicalName: "B" }]],
      ["dough|", [{ externalName: "A", canonicalName: "B" }]],
      ["sauce|", [{ externalName: "A", canonicalName: "B" }]],
      ["cheese|", [{ externalName: "A", canonicalName: "B" }]],
      ["brand|", [{ externalName: "A", canonicalName: "B" }]],
      ["flavor|Brand A", [{ externalName: "A", canonicalName: "B" }]],
      ["flavor|Brand B", [{ externalName: "A", canonicalName: "B" }]],
    ]);
    const scopeKey = (scopeCategory: string, scopeBrand?: string) =>
      `${scopeCategory}|${scopeCategory === "flavor" ? scopeBrand ?? "" : ""}`;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const parsedUrl = new URL(url, "http://app.test");
      const queryCategory = parsedUrl.searchParams.get("category") ?? "ingredient";
      const queryBrand = parsedUrl.searchParams.get("brand") ?? undefined;
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          aliases: MergeAlias[];
          category?: string;
          brand?: string;
        };
        aliasesByScope.set(scopeKey(body.category ?? "ingredient", body.brand), body.aliases);
        return response({ aliases: body.aliases });
      }
      return response({ aliases: aliasesByScope.get(scopeKey(queryCategory, queryBrand)) ?? [] });
    }));

    await saveConfirmedMergeAliasesBestEffort(["B"], "C", category, brand);

    expect(calls[0].url).toBe(expectedGet);
    const body = JSON.parse(String(calls[1].init?.body));
    expect(body.category).toBe(category);
    if (category === "flavor") expect(body.brand).toBe(brand);
    else expect(body).not.toHaveProperty("brand");
    expect(body.aliases).toEqual([
      { externalName: "A", canonicalName: "C" },
      { externalName: "B", canonicalName: "C" },
    ]);
    expect(aliasesByScope.get(scopeKey(category, brand))).toEqual(body.aliases);
    const untouchedScope = category === "flavor" ? "flavor|Brand B" : "ingredient|";
    expect(aliasesByScope.get(untouchedScope)).toEqual([{ externalName: "A", canonicalName: "B" }]);
  });

  it("still saves direct aliases when reading the scoped alias list fails", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return init?.method === "POST"
        ? response({ aliases: [] })
        : response({ error: "unavailable" }, 503);
    }));

    await expect(saveConfirmedMergeAliasesBestEffort(["B"], "C", "flavor", "Brand A"))
      .resolves.toBeUndefined();

    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      aliases: [{ externalName: "B", canonicalName: "C" }],
      category: "flavor",
      brand: "Brand A",
    });
  });

  it("does not reject or block when the alias write fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? response({ error: "unavailable" }, 503)
        : response({ aliases: [] }),
    ));

    await expect(saveConfirmedMergeAliasesBestEffort(["B"], "C")).resolves.toBeUndefined();
  });
});
