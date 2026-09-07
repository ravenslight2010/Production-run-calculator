import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeOperationalMutationCursor } from "./operationalMutationCursor";

describe("operational mutation cursor recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
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
});