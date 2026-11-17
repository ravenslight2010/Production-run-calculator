// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareRetainedHistory, fetchRetainedHistoryComparison } from "./retainedHistoryComparison";

const run = { id: "reviewed-run", endedAt: 100, brand: "Synthetic" };
const values = { casesNeeded: 20, skidsCompleted: 1 };
const local = { date: "2026-01-01", runs: [run], runValues: { [run.id]: values } };
const canonical = {
  date: local.date, runId: run.id,
  snapshot: { dayState: { runs: [run] }, runValues: local.runValues },
};
afterEach(() => vi.restoreAllMocks());

describe("retained history comparison", () => {
  it("compares only exact run identities and is independent of property order", () => {
    expect(compareRetainedHistory(local, [canonical])).toBe("identical");
    expect(compareRetainedHistory(local, [{
      ...canonical,
      snapshot: { runValues: { [run.id]: { skidsCompleted: 1, casesNeeded: 20 } }, dayState: { runs: [run] } },
    }])).toBe("identical");
    expect(compareRetainedHistory({ ...canonical }, [canonical])).toBe("identical");
    expect(compareRetainedHistory(local, [])).toBe("unmatched");
  });

  it("distinguishes differences, duplicate identities, and unavailable formats", () => {
    expect(compareRetainedHistory(local, [{
      ...canonical, snapshot: { ...canonical.snapshot, runValues: { [run.id]: { ...values, casesNeeded: 21 } } },
    }])).toBe("different");
    expect(compareRetainedHistory(local, [canonical, canonical])).toBe("ambiguous");
    expect(compareRetainedHistory({ ...local, runs: [run, run] }, [canonical])).toBe("ambiguous");
    for (const record of [null, { date: "2026-02-30" }, { ...local, runs: [] }, { ...local, runValues: {} }]) {
      expect(compareRetainedHistory(record, [canonical])).toBe("unavailable");
    }
    expect(compareRetainedHistory(local, [null])).toBe("unavailable");
    expect(compareRetainedHistory(local, [{ ...canonical, snapshot: {} }])).toBe("unavailable");
  });

  it("reads bounded complete pages without uploading or changing the local copy", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ history: [], nextCursor: "next" }))
      .mockResolvedValueOnce(Response.json({ history: [canonical] }));
    const before = JSON.stringify(local);
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => true)).toBe("identical");
    expect(JSON.stringify(local)).toBe(before);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = new URL(fetch.mock.calls[0][0] as string, "https://fixture.invalid");
    expect([...first.searchParams.entries()]).toEqual([["from", local.date], ["to", local.date], ["limit", "100"]]);
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(fetch.mock.calls.every(([, options]) => options?.method === undefined && options?.body === undefined)).toBe(true);
  });

  it("does not infer absence from a denial, failed page, repeated cursor, or oversized response", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(new Response("", { status: 403 }));
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => true)).toBe("unavailable");
    fetch.mockResolvedValueOnce(Response.json({ history: [], nextCursor: "same" }))
      .mockResolvedValueOnce(Response.json({ history: [], nextCursor: "same" }));
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => true)).toBe("unavailable");
    fetch.mockResolvedValueOnce(new Response(" ".repeat(2_000_001)));
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => true)).toBe("unavailable");
    fetch.mockRejectedValueOnce(new Error("Synthetic offline failure"));
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => true)).toBe("unavailable");
  });

  it("fences account/scope changes and refuses truncated pagination", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => false)).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
    let current = true;
    fetch.mockImplementationOnce(async () => {
      current = false;
      return Response.json({ history: [canonical] });
    });
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => current)).toBe("unavailable");
    fetch.mockReset().mockImplementation(async () => Response.json({ history: [], nextCursor: String(fetch.mock.calls.length) }));
    expect(await fetchRetainedHistoryComparison(local, new AbortController().signal, () => true)).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(10);
  });
});
