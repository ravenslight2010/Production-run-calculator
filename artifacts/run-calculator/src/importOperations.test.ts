import { describe, expect, it, vi } from "vitest";
import {
  applyImportOperation,
  createImportOperationId,
  ImportOperationError,
  undoImportOperation,
} from "./importOperations";
import { buildSpecImportChanges } from "./specImport";

describe("import operation client boundary", () => {
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
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
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(applyImportOperation("import-operation-002", {
      importType: "cheese",
      sourceLabel: "reviewed.xlsx",
      changes: { cheeseRecipes: { upsert: [] } },
    })).rejects.toMatchObject({
      name: "ImportOperationError",
      operationId: "import-operation-002",
    });
  });

  it("retries the persisted byte-equivalent payload under the same operation ID", async () => {
    const id = "import-operation-retry-004";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        operation: { operationId: id, status: "applied", result: { ok: true }, resultHash: "hash-4" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      importType: "spec" as const,
      sourceLabel: "reviewed.xlsx",
      changes: { brandProfiles: { upsert: [{ key: "a__b", brand: "A", flavor: "B" }] } },
    };
    await expect(applyImportOperation(id, payload)).rejects.toBeInstanceOf(ImportOperationError);
    await expect(applyImportOperation(id, {
      ...payload,
      changes: { brandProfiles: { upsert: [{ key: "changed", brand: "Changed", flavor: "Review" }] } },
    })).resolves.toMatchObject({ operationId: id, resultHash: "hash-4" });
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody).toEqual(firstBody);
  });

  it("does not accept an undo response without the canonical result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ operationId: "import-operation-003", status: "undone" }), { status: 200 }),
    ));
    await expect(undoImportOperation("import-operation-003", "hash-1"))
      .rejects.toBeInstanceOf(ImportOperationError);
  });
});