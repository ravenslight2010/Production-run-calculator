import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importReconciliationRows,
  recordImportHistory,
  requiredImportAction,
  pendingImportHistoryCount,
  retryPendingImportHistory,
  setImportHistoryIdentity,
  type ImportHistoryItem,
} from "./importHistory";

function history(overrides: Partial<ImportHistoryItem> = {}): ImportHistoryItem {
  return {
    id: 1,
    importType: "spec",
    sourceKey: "source-key",
    sourceLabel: "spec.xlsx",
    customerScope: "Aldo's",
    status: "complete",
    summary: {},
    snapshotId: null,
    createdAt: 1,
    ...overrides,
  };
}

describe("import operation history helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    setImportHistoryIdentity(null);
  });

  it("keeps source-only and landed-only measurements visibly non-comparable", () => {
    expect(importReconciliationRows({
      source: { profiles: 3, recipes: 2 },
      landed: { profiles: 2, freezerPulls: 4 },
    })).toEqual([
      { label: "freezerPulls", source: null, landed: 4, delta: null },
      { label: "profiles", source: 3, landed: 2, delta: -1 },
      { label: "recipes", source: 2, landed: null, delta: null },
    ]);
  });

  it("prefers the recorded manager follow-up over a generic recovery prompt", () => {
    expect(requiredImportAction(history({
      status: "partial",
      summary: { followUp: ["Resolve the unmatched brands, then reopen the review."] },
    }))).toBe("Resolve the unmatched brands, then reopen the review.");
  });

  it("offers a saved review for a partial spec result but never claims automatic replay", () => {
    expect(requiredImportAction(history({
      status: "partial",
      snapshotId: 42,
    }))).toMatch(/Reopen the saved review/i);
    expect(requiredImportAction(history({
      importType: "cheese",
      status: "failed",
    }))).toMatch(/Retry from the retained review, or choose the original source file again/i);
  });

  it("retries a transient audit write only for the same user and scope", async () => {
    const input = {
      importType: "spec" as const,
      sourceLabel: "retry-me.xlsx",
      status: "complete" as const,
      summary: { source: { profiles: 1 }, landed: { profiles: 1 } },
    };
    const notice = vi.fn();
    window.addEventListener("import-history-pending", notice);
    setImportHistoryIdentity({ scope: "live", userId: "manager-1" });
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ import: history() }) });
    vi.stubGlobal("fetch", fetch);
    await expect(recordImportHistory(input)).rejects.toThrow("Save import history failed (503)");
    expect(notice).toHaveBeenCalled();
    expect(pendingImportHistoryCount()).toBe(1);
    // Simulates leaving and reopening the workspace after a page reload: only
    // the same authenticated identity may discover this persisted record.
    setImportHistoryIdentity(null);
    setImportHistoryIdentity({ scope: "live", userId: "manager-1" });
    expect(pendingImportHistoryCount()).toBe(1);
    const result = await retryPendingImportHistory();
    expect(result).toEqual({ saved: 1, remaining: 0 });
    const retryBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(retryBody.operationId).toMatch(/[-_a-zA-Z0-9]{16,}/);
    setImportHistoryIdentity({ scope: "sandbox", userId: "manager-1" });
    expect(await retryPendingImportHistory()).toEqual({ saved: 0, remaining: 0 });
    window.removeEventListener("import-history-pending", notice);
  });
});