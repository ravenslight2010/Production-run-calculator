import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyImportOperation,
  clearPendingImportOperation,
  createImportOperationId,
  ImportOperationError,
  listPendingImportOperations,
  readPendingImportOperations,
  retryPendingImportOperation,
  undoImportOperation,
} from "./importOperations";
import { buildSpecImportChanges } from "./specImport";
import { subscribeImportSafetyReview, finishImportSafetyReview, ImportReviewCancelledError } from "./importSafetyReview";

const reviewHash = "a".repeat(64);
let unsubscribeReview: (() => void) | undefined;
function stubOperationFetch(mock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "/api/import-operations/preview"
      ? Promise.resolve(new Response(JSON.stringify({
        expectedStateHash: reviewHash, before: {}, after: {},
        baseline: { status: "unavailable", limitation: "Synthetic legacy baseline" },
      }), { status: 200 }))
      : mock(input, init));
}

beforeEach(() => {
  sessionStorage.clear();
  unsubscribeReview = subscribeImportSafetyReview((review) => { if (review) finishImportSafetyReview(true); });
});

afterEach(() => {
  unsubscribeReview?.();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("import operation client boundary", () => {
  it("keeps cancellation distinct from an ambiguous Apply and immediately permits a fresh review", async () => {
    unsubscribeReview?.();
    let approvals = 0;
    unsubscribeReview = subscribeImportSafetyReview((review) => { if (review) finishImportSafetyReview(++approvals > 1); });
    const id = "import-cancel-then-review";
    const applyFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      operation: { operationId: id, status: "applied", result: {} },
    }), { status: 200 }));
    stubOperationFetch(applyFetch);
    const payload = { importType: "premix" as const, sourceLabel: "Synthetic.xlsx", changes: { mixes: { upsert: [] } } };
    await expect(applyImportOperation(id, payload)).rejects.toBeInstanceOf(ImportReviewCancelledError);
    expect(applyFetch).not.toHaveBeenCalled();
    expect(listPendingImportOperations()).toEqual([]);
    await expect(applyImportOperation(id, payload)).resolves.toMatchObject({ status: "applied" });
    expect(applyFetch).toHaveBeenCalledTimes(1);
  });
  it("builds a bounded spec changes envelope without mutating rows", () => {
    const rows = [{ key: "a__b" }];
    expect(buildSpecImportChanges({
      brandProfiles: { upsert: rows, delete: ["old__row"] },
      mixes: { upsert: [] },
      specImportAliases: { upsert: [{ kind: "brand", externalName: "A", canonicalName: "Acme" }] },
    })).toEqual({
      brandProfiles: { upsert: rows, delete: ["old__row"] },
      specImportAliases: { upsert: [{ kind: "brand", externalName: "A", canonicalName: "Acme" }] },
    });
  });
  it("creates a stable, server-compatible operation identity", () => {
    expect(createImportOperationId()).toMatch(/^import-[a-z0-9-]{16,110}$/i);
  });

  it("requires the canonical applied result before resolving", async () => {
    stubOperationFetch(vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        operation: {
          operationId: "import-operation-001",
          status: "applied",
          result: { mixes: [] },
          resultHash: "hash-1",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));
    await expect(applyImportOperation("import-operation-001", {
      importType: "premix",
      sourceLabel: "reviewed.xlsx",
      changes: { mixes: { upsert: [] } },
    })).resolves.toMatchObject({
      operationId: "import-operation-001",
      status: "applied",
      result: { mixes: [] },
      resultHash: "hash-1",
    });
  });

  it("keeps ambiguous transport failures retryable without reparsing", async () => {
    stubOperationFetch(vi.fn().mockRejectedValue(new Error("offline")));
    await expect(applyImportOperation("import-operation-002", {
      importType: "cheese",
      sourceLabel: "reviewed.xlsx",
      changes: { cheeseRecipes: { upsert: [] } },
    })).rejects.toMatchObject({
      name: "ImportOperationError",
      operationId: "import-operation-002",
    });
  });

  it("recovers the exact pending payload under the same ID and rejects changed reviews", async () => {
    const id = "import-operation-retry-004";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        operation: { operationId: id, status: "applied", result: { ok: true }, resultHash: "hash-4" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    stubOperationFetch(fetchMock);
    const payload = {
      importType: "spec" as const,
      sourceLabel: "reviewed.xlsx",
      changes: { brandProfiles: { upsert: [{ key: "a__b", brand: "A", flavor: "B" }] } },
    };
    await expect(applyImportOperation(id, payload)).rejects.toBeInstanceOf(ImportOperationError);
    await expect(applyImportOperation(id, {
      ...payload,
      changes: { brandProfiles: { upsert: [{ key: "changed", brand: "Changed", flavor: "Review" }] } },
    })).rejects.toThrow(/reviewed changes differ/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listPendingImportOperations()).toContainEqual({ operationId: id, payload: { ...payload, expectedStateHash: reviewHash } });
    await expect(retryPendingImportOperation(id))
      .resolves.toMatchObject({ operationId: id, resultHash: "hash-4" });
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody).toEqual(firstBody);
  });

  it("blocks a new import while another operation is unresolved", async () => {
    const id = "import-operation-pending-005";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        operation: { operationId: id, status: "applied", result: { ok: true } },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    stubOperationFetch(fetchMock);
    const payload = {
      importType: "premix" as const,
      sourceLabel: "reviewed-premix.xlsx",
      changes: { mixes: { upsert: [{ id: "mix-1" }] } },
    };
    await expect(applyImportOperation(id, payload)).rejects.toBeInstanceOf(ImportOperationError);
    await expect(applyImportOperation("import-operation-new-006", {
      importType: "cheese",
      sourceLabel: "different.xlsx",
      changes: { cheeseRecipes: { upsert: [{ id: "recipe-1" }] } },
    })).rejects.toThrow(/earlier import is still unconfirmed/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(retryPendingImportOperation(id)).resolves.toMatchObject({ operationId: id });
    expect(listPendingImportOperations()).toEqual([]);
    clearPendingImportOperation(id);
  });

  it("reports unreadable pending storage instead of treating it as empty", () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("storage blocked");
      },
    });
    expect(readPendingImportOperations()).toEqual({ available: false, operations: [] });
  });

  it("does not send a new operation when the pending record is corrupted", async () => {
    sessionStorage.setItem("run-calculator.pending-import-operations.v1", "{not-json");
    const fetchMock = vi.fn();
    stubOperationFetch(fetchMock);
    await expect(applyImportOperation("import-operation-corrupt-007", {
      importType: "premix",
      sourceLabel: "new.xlsx",
      changes: { mixes: { upsert: [] } },
    })).rejects.toMatchObject({
      name: "ImportOperationError",
      status: 0,
      message: expect.stringContaining("No new import was sent"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept an undo response without the canonical result", async () => {
    stubOperationFetch(vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ operationId: "import-operation-003", status: "undone" }), { status: 200 }),
    ));
    await expect(undoImportOperation("import-operation-003", "hash-1"))
      .rejects.toBeInstanceOf(ImportOperationError);
  });

  it("does not send an import when the exact request cannot be stored for recovery", async () => {
    const fetchMock = vi.fn();
    stubOperationFetch(fetchMock);
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("session storage unavailable");
      },
    });

    try {
      await expect(applyImportOperation("import-operation-no-storage-007", {
        importType: "spec",
        sourceLabel: "Spec workbook",
        changes: { brandProfiles: { upsert: [] } },
      })).rejects.toMatchObject({
        name: "ImportOperationError",
        status: 0,
        message: expect.stringMatching(/no new import was sent/iu),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});