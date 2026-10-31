import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeOperationalMutationCursor } from "./operationalMutationCursor";
import { queueOperationalIntent, setOperationalIntentIdentity } from "./operationalIntentOutbox";

describe("operational mutation cursor recovery", () => {
  const identity = { scope: "live" as const, userId: "operator-1" };
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    setOperationalIntentIdentity(identity);
  });
  afterEach(() => {
    setOperationalIntentIdentity(null);
    vi.unstubAllGlobals();
  });

  it("advances across non-adoptable outcomes and finishes on the current materialization", async () => {
    const pages = [
      {
        cursor: 100,
        hasMore: true,
        mutations: [
          { cursor: 99, snapshot: { dayState: { runs: [{ id: "current" }] } } },
          { cursor: 100, snapshot: null },
        ],
      },
      {
        cursor: 200,
        hasMore: true,
        mutations: [{ cursor: 200, snapshot: { dayState: { runs: [{ id: "current" }] } } }],
      },
      {
        cursor: 205,
        hasMore: false,
        mutations: [{ cursor: 205, snapshot: { dayState: { runs: [{ id: "current" }] } } }],
      },
    ];
    const request = vi.fn(async () => new Response(JSON.stringify(pages.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", request);
    const adopted: unknown[] = [];
    const identity = { scope: "live" as const, userId: "operator-1" };

    await consumeOperationalMutationCursor(identity, (snapshot) => adopted.push(snapshot));
    expect(request).toHaveBeenCalledTimes(3);
    expect(adopted.at(-1)).toEqual({ dayState: { runs: [{ id: "current" }] } });

    request.mockResolvedValueOnce(new Response(JSON.stringify({
      cursor: 205, hasMore: false, mutations: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await consumeOperationalMutationCursor(identity, () => {
      throw new Error("empty continuation must not adopt");
    });
    expect(String(request.mock.calls.at(-1)?.[0])).toContain("after=205");
  });

  it.each(["other-account", "same-account-return", "scope-switch", "cancel", "pending-command"] as const)(
    "does not adopt or acknowledge a late page after %s", async (boundary) => {
      let finish!: (response: Response) => void;
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
      const adopt = vi.fn();
      const controller = new AbortController();
      const recovery = consumeOperationalMutationCursor(identity, adopt, controller.signal);
      if (boundary === "other-account") setOperationalIntentIdentity({ ...identity, userId: "other" });
      if (boundary === "same-account-return") {
        setOperationalIntentIdentity(null);
        setOperationalIntentIdentity(identity);
      }
      if (boundary === "scope-switch") setOperationalIntentIdentity({ ...identity, scope: "sandbox" });
      if (boundary === "cancel") controller.abort();
      if (boundary === "pending-command") queueOperationalIntent({
        runId: "run-1", action: "pause", observedGeneration: "run-1:1", effectiveAt: Date.now(),
      });
      finish(new Response(JSON.stringify({
        cursor: 1, hasMore: false, mutations: [{ cursor: 1, snapshot: { dayState: {} } }],
      })));
      await recovery;
      expect(adopt).not.toHaveBeenCalled();
      expect(localStorage.getItem("run-calculator:operational-mutation-cursor:v1:live:operator-1")).toBeNull();
    },
  );

  it("retains the cursor on network and malformed page failures", async () => {
    const adopt = vi.fn();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        cursor: 1, mutations: [{ cursor: 2, snapshot: {} }], hasMore: false,
      })));
    vi.stubGlobal("fetch", fetch);
    await expect(consumeOperationalMutationCursor(identity, adopt)).resolves.toBeUndefined();
    await consumeOperationalMutationCursor(identity, adopt);
    expect(adopt).not.toHaveBeenCalled();
    expect(localStorage.getItem("run-calculator:operational-mutation-cursor:v1:live:operator-1")).toBeNull();
  });
});