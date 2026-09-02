import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_RESULT_CACHE_NAMESPACE,
  clearAiResultCacheForTests,
  fingerprintAiOperation,
  getOrCreateAiResult,
  type AiResultCacheStore,
} from "./aiResultCache";

type Entry = { value: unknown; expiresAt: Date };

function makeStore(initial?: Entry): AiResultCacheStore & { entry: Entry | null } {
  const store = {
    entry: initial ?? null,
    async read() {
      return store.entry;
    },
    async remove() {
      store.entry = null;
    },
    async write(_scope: string, _key: string, value: unknown, expiresAt: Date) {
      store.entry = { value, expiresAt };
    },
    async prune() {},
  };
  return store;
}

const valid = (value: unknown): value is { answer: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { answer?: unknown }).answer === "string";

function options(store: AiResultCacheStore, load: () => Promise<{ answer: string }>) {
  return {
    operation: "summary",
    key: fingerprintAiOperation({
      operation: "summary",
      model: "test-model",
      system: "system",
      user: "grounded user",
    }),
    store,
    validate: valid,
    load: async () => ({ value: await load() }),
  };
}

afterEach(async () => {
  await clearAiResultCacheForTests();
});

describe("AI result cache", () => {
  it("uses the explicit namespace and stable fingerprint inputs", () => {
    const a = fingerprintAiOperation({
      operation: "summary",
      model: "model-a",
      system: "system",
      user: "same grounded prompt",
    });
    const b = fingerprintAiOperation({
      operation: "summary",
      model: "model-a",
      system: "system",
      user: "same grounded prompt",
    });
    expect(a).toBe(b);
    expect(
      fingerprintAiOperation({
        operation: "summary",
        model: "model-a",
        system: "system",
        user: "second item\nfirst item",
      }),
    ).toBe(
      fingerprintAiOperation({
        operation: "summary",
        model: "model-a",
        system: "system",
        user: "first item\nsecond item",
      }),
    );
    expect(a).not.toBe(
      fingerprintAiOperation({
        operation: "summary",
        model: "model-b",
        system: "system",
        user: "same grounded prompt",
      }),
    );
    expect(AI_RESULT_CACHE_NAMESPACE).toBe("ai-results:v1");
  });

  it("collapses concurrent misses to one loader and then serves the stored value", async () => {
    const store = makeStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async () => {
      await gate;
      return { answer: "one provider result" };
    });

    const first = getOrCreateAiResult(options(store, load));
    const second = getOrCreateAiResult(options(store, load));
    release();

    await expect(first).resolves.toMatchObject({ value: { answer: "one provider result" }, hit: false });
    await expect(second).resolves.toMatchObject({ value: { answer: "one provider result" }, hit: false });
    expect(load).toHaveBeenCalledOnce();

    await expect(getOrCreateAiResult(options(store, load))).resolves.toMatchObject({
      value: { answer: "one provider result" },
      hit: true,
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("ignores expired and malformed entries instead of returning them", async () => {
    const expired = makeStore({ value: { answer: "old" }, expiresAt: new Date(0) });
    const expiredLoad = vi.fn(async () => ({ answer: "fresh" }));
    await expect(getOrCreateAiResult(options(expired, expiredLoad))).resolves.toMatchObject({
      value: { answer: "fresh" },
      hit: false,
    });
    expect(expiredLoad).toHaveBeenCalledOnce();

    const malformed = makeStore({ value: { answer: 42 }, expiresAt: new Date(Date.now() + 60_000) });
    const malformedLoad = vi.fn(async () => ({ answer: "recovered" }));
    await expect(getOrCreateAiResult(options(malformed, malformedLoad))).resolves.toMatchObject({
      value: { answer: "recovered" },
      hit: false,
    });
    expect(malformedLoad).toHaveBeenCalledOnce();
  });

  it("fails open when cache reads or writes are unavailable", async () => {
    const store: AiResultCacheStore = {
      read: async () => {
        throw new Error("cache unavailable");
      },
      remove: async () => {},
      write: async () => {
        throw new Error("cache unavailable");
      },
      prune: async () => {
        throw new Error("cache unavailable");
      },
    };
    const load = vi.fn(async () => ({ answer: "provider still runs" }));

    await expect(getOrCreateAiResult(options(store, load))).resolves.toMatchObject({
      value: { answer: "provider still runs" },
      hit: false,
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not persist fallback-only or oversized results", async () => {
    const fallbackStore = makeStore();
    const fallbackLoad = vi.fn(async () => ({ value: { answer: "fallback" }, cacheable: false }));
    await expect(
      getOrCreateAiResult({ ...options(fallbackStore, async () => ({ answer: "fallback" })), load: fallbackLoad }),
    ).resolves.toMatchObject({ hit: false });
    expect(fallbackStore.entry).toBeNull();

    const oversizedStore = makeStore();
    const oversizedLoad = vi.fn(async () => ({ value: { answer: "x".repeat(600_000) } }));
    await getOrCreateAiResult({
      ...options(oversizedStore, async () => ({ answer: "unused" })),
      load: oversizedLoad,
    });
    expect(oversizedStore.entry).toBeNull();
  });
});