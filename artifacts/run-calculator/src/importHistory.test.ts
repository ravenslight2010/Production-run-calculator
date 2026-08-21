import { afterEach, describe, expect, it, vi } from "vitest";
import { recordImportHistory } from "./importHistory";

describe("recordImportHistory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports a history-storage failure without changing the already-committed import result", async () => {
    const committedResult = {
      profilesUpdated: 3,
      recipesUpdated: 2,
      importCommitted: true,
    };
    const before = structuredClone(committedResult);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Failed to save import history" }),
      { status: 503, headers: { "content-type": "application/json" } },
    )));

    await expect(recordImportHistory({
      importType: "spec",
      sourceLabel: "weekly-spec.xlsx",
      status: "complete",
      summary: { counts: { updated: 2 } },
    })).rejects.toThrow("Save import history failed (503)");

    expect(committedResult).toEqual(before);
    expect(committedResult.importCommitted).toBe(true);
  });
});