// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createElement } from "react";
import {
  fetchMasterDataBootstrap,
  MasterDataPolling,
  resetMasterDataTransportCache,
  setMasterDataSlice,
  MASTER_DATA_QUERY_KEY,
} from "./masterData";
import { useIngredients } from "./hooks/useIngredients";
import { useMixes } from "./hooks/useMixes";
import { useCheeseRecipes } from "./hooks/useCheeseRecipes";
import { useNamedRecipes } from "./hooks/useNamedRecipes";

const bootstrapBody = {
  ingredients: [{ id: "i1", name: "Flour", categories: ["dough"], enabled: true }],
  doughRecipes: [{ id: "d1", name: "Dough", components: [], enabled: true }],
  sauceRecipes: [{ id: "s1", name: "Sauce", components: [], enabled: true }],
  cheeseRecipes: [{ id: "c1", name: "Cheese", components: [], enabled: true }],
  mixes: [{ id: "m1", name: "Mix", components: [], enabled: true }],
};

function AllMasterDataConsumers() {
  const ingredients = useIngredients();
  const mixes = useMixes();
  const cheese = useCheeseRecipes();
  const dough = useNamedRecipes("dough");
  const sauce = useNamedRecipes("sauce");
  return createElement(
    "output",
    { "data-testid": "counts" },
    [
      ingredients.items.length,
      mixes.items.length,
      cheese.items.length,
      dough.items.length,
      sauce.items.length,
    ].join(","),
  );
}

describe("master-data bootstrap loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetMasterDataTransportCache();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shares one request across all startup collection consumers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ingredients: [{ id: "i1", name: "Flour", categories: ["dough"], enabled: true }],
        doughRecipes: [{ id: "d1", name: "Dough", components: [], enabled: true }],
        sauceRecipes: [{ id: "s1", name: "Sauce", components: [], enabled: true }],
        cheeseRecipes: [{ id: "c1", name: "Cheese", components: [], enabled: true }],
        mixes: [{ id: "m1", name: "Mix", components: [], enabled: true }],
      })),
    );

    const [first, second, third] = await Promise.all([
      fetchMasterDataBootstrap(),
      fetchMasterDataBootstrap(),
      fetchMasterDataBootstrap(),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.ingredients).toHaveLength(1);
    expect(second.doughRecipes[0]?.name).toBe("Dough");
    expect(third.mixes[0]?.name).toBe("Mix");
  });

  it("allows a later startup attempt after a failed request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ingredients: [], doughRecipes: [], sauceRecipes: [], cheeseRecipes: [], mixes: [],
      })));

    await expect(fetchMasterDataBootstrap()).rejects.toThrow("offline");
    await expect(fetchMasterDataBootstrap()).resolves.toMatchObject({ ingredients: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reuses the server representation with its validator and sends it on the next refresh", async () => {
    const etag = '"master-data-test"';
    const responseHeaders = new Headers({ etag });
    const first = {
      ok: true,
      status: 200,
      headers: responseHeaders,
      json: () => Promise.resolve(bootstrapBody),
    } as unknown as Response;
    const unchanged = {
      ok: true,
      status: 304,
      headers: responseHeaders,
    } as unknown as Response;
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(unchanged);

    const initial = await fetchMasterDataBootstrap();
    const unchangedResult = await fetchMasterDataBootstrap();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        "x-client-id": expect.any(String),
        "if-none-match": etag,
      },
    });
    expect(unchangedResult).toEqual(initial);
  });

  it("uses one active poller, pauses while idle or hidden, and refreshes once on resume", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const body = JSON.stringify(bootstrapBody);
    const responseBytes: number[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      responseBytes.push(new TextEncoder().encode(body).byteLength);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(bootstrapBody),
      } as unknown as Response;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MasterDataPolling,
        null,
        createElement(AllMasterDataConsumers),
      ),
    ));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // The shared useIdle singleton flips after three minutes. The canonical
    // observer has no idle interval, so no further bootstrap request is made.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    const idleCount = fetchSpy.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(idleCount);

    // A new interaction leaves idle and causes exactly one shared refresh.
    await act(async () => {
      window.dispatchEvent(new Event("mousedown"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(idleCount + 1);

    // Hidden pages do not run the shared interval.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const hiddenCount = fetchSpy.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(hiddenCount);

    // The first foreground return is also one deduplicated refresh.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(hiddenCount + 1);
    expect(new Set(responseBytes).size).toBe(1);
    expect(responseBytes.every((bytes) => bytes === new TextEncoder().encode(body).byteLength)).toBe(true);
  });

  it("updates the canonical cache when a manager mutation returns a normalized slice", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(MASTER_DATA_QUERY_KEY, {
      ingredients: [],
      doughRecipes: [],
      sauceRecipes: [],
      cheeseRecipes: [],
      mixes: [],
    });
    const savedMix = { id: "m2", name: "New Mix", components: [], enabled: true };

    setMasterDataSlice(queryClient, "mixes", [savedMix]);

    expect(queryClient.getQueryData<typeof bootstrapBody>(MASTER_DATA_QUERY_KEY)?.mixes).toEqual([savedMix]);
    expect(queryClient.getQueryData(["mixes"])).toEqual([savedMix]);
  });

  it("keeps a manager cache update as the 304 snapshot", async () => {
    const responseHeaders = new Headers({ etag: '"master-data-manager"' });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: responseHeaders,
      json: () => Promise.resolve(bootstrapBody),
    } as unknown as Response);
    await fetchMasterDataBootstrap();

    const queryClient = new QueryClient();
    queryClient.setQueryData(MASTER_DATA_QUERY_KEY, bootstrapBody);
    const savedMix = { id: "m2", name: "New Mix", components: [], enabled: true };
    setMasterDataSlice(queryClient, "mixes", [savedMix]);

    const unchangedResponse = {
      ok: true,
      status: 304,
      headers: responseHeaders,
    } as unknown as Response;
    vi.mocked(fetch).mockResolvedValueOnce(unchangedResponse);
    await expect(fetchMasterDataBootstrap()).resolves.toMatchObject({
      mixes: [savedMix],
    });
  });

  it("does not carry a validator or snapshot across an auth transition", async () => {
    const responseHeaders = new Headers({ etag: 'W/"master-data-old-session"' });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: responseHeaders,
      json: () => Promise.resolve(bootstrapBody),
    } as unknown as Response);
    await fetchMasterDataBootstrap();

    const queryClient = new QueryClient();
    queryClient.setQueryData(MASTER_DATA_QUERY_KEY, bootstrapBody);
    setMasterDataSlice(queryClient, "mixes", [
      { id: "private", name: "Prior Session Mix", components: [], enabled: true },
    ]);
    resetMasterDataTransportCache();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: 'W/"master-data-new-session"' }),
      json: () => Promise.resolve({ ...bootstrapBody, mixes: [] }),
    } as unknown as Response);
    const nextSession = await fetchMasterDataBootstrap();

    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        "x-client-id": expect.any(String),
      },
    });
    expect((fetchSpy.mock.calls[1]?.[1] as RequestInit).headers).not.toHaveProperty("if-none-match");
    expect(nextSession.mixes).toEqual([]);
  });

  it("does not let an old session repopulate transport state after JSON parsing", async () => {
    let resolveJson!: (value: typeof bootstrapBody) => void;
    const json = vi.fn(() => new Promise<typeof bootstrapBody>((resolve) => {
      resolveJson = resolve;
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: 'W/"master-data-old-session"' }),
      json,
    } as unknown as Response);

    const staleRequest = fetchMasterDataBootstrap();
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    resetMasterDataTransportCache();
    resolveJson(bootstrapBody);

    await expect(staleRequest).rejects.toThrow("superseded by a session change");

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ etag: 'W/"master-data-new-session"' }),
      json: () => Promise.resolve(bootstrapBody),
    } as unknown as Response);
    await fetchMasterDataBootstrap();
    expect((fetchSpy.mock.calls[1]?.[1] as RequestInit).headers).not.toHaveProperty("if-none-match");
  });
});