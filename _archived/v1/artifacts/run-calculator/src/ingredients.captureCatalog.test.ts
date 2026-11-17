// @vitest-environment jsdom
// Catalog capture — best-effort "newly typed ingredient names join the
// factory-wide catalog" glue (unified ingredient universe). Locks in:
// skip-existing (case-insensitive), insert-only-new, and swallow-all-errors.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureIngredientNamesToCatalog } from "./ingredients";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("captureIngredientNamesToCatalog", () => {
  const calls: FetchCall[] = [];
  let listBody: unknown;
  let listOk: boolean;
  let saveOk: boolean;

  beforeEach(() => {
    calls.length = 0;
    listBody = { items: [] };
    listOk = true;
    saveOk = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (!init || !init.method || init.method === "GET") {
          return jsonResponse(listBody, listOk, listOk ? 200 : 500);
        }
        return jsonResponse({ items: [] }, saveOk, saveOk ? 200 : 403);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function postedItems(): Array<{ name: string; categories: string[] }> {
    const post = calls.find((c) => c.init?.method === "POST");
    if (!post) return [];
    return (JSON.parse(String(post.init!.body)) as { items: Array<{ name: string; categories: string[] }> }).items;
  }

  it("does nothing (no fetch at all) for empty or blank-only input", async () => {
    await captureIngredientNamesToCatalog([], "mix");
    await captureIngredientNamesToCatalog(["   ", ""], "mix");
    expect(calls).toEqual([]);
  });

  it("POSTs only names missing from the catalog, tagged with the category", async () => {
    listBody = {
      items: [{ id: "i1", name: "Mozzarella", categories: ["cheese"], mergedInto: null, enabled: true }],
    };
    await captureIngredientNamesToCatalog(["Mozzarella", "Basil"], "cheese");
    const items = postedItems();
    expect(items.map((i) => i.name)).toEqual(["Basil"]);
    expect(items[0].categories).toEqual(["cheese"]);
  });

  it("skips existing names case-insensitively and dedupes the input list", async () => {
    listBody = {
      items: [{ id: "i1", name: "Diced Onion", categories: ["mix"], mergedInto: null, enabled: true }],
    };
    await captureIngredientNamesToCatalog(
      ["diced onion", "DICED ONION", "Salt", " salt ", "Salt"],
      "mix",
    );
    expect(postedItems().map((i) => i.name)).toEqual(["Salt"]);
  });

  it("does not POST when everything already exists", async () => {
    listBody = {
      items: [{ id: "i1", name: "Flour", categories: ["dough"], mergedInto: null, enabled: true }],
    };
    await captureIngredientNamesToCatalog(["Flour"], "dough");
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("swallows a failed catalog list (e.g. offline)", async () => {
    listOk = false;
    await expect(
      captureIngredientNamesToCatalog(["Basil"], "mix"),
    ).resolves.toBeUndefined();
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("swallows a rejected save (e.g. non-manager 403)", async () => {
    saveOk = false;
    await expect(
      captureIngredientNamesToCatalog(["Basil"], "mix"),
    ).resolves.toBeUndefined();
  });
});
