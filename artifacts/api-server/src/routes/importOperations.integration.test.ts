import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SPEC_IMPORT_PARSE_VERSION } from "@workspace/spec-import";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
let db: typeof import("@workspace/db").db;
let pool: typeof import("@workspace/db").pool;
let adminPool: pg.Pool;
let dbName: string;
let originalUrl: string | undefined;
let server: Server;
let baseUrl: string;
let tables: typeof import("@workspace/db");
let route: typeof import("./importOperations");
let seedRoles: () => Promise<void>;
let recordSession: typeof import("../lib/authSessions")["recordSession"];
let signLegacyTokenForTests: typeof import("../lib/auth")["signLegacyTokenForTests"];

let runImportSourceRetention: typeof import("../lib/importSourceRetention")["runImportSourceRetention"];
const sessionTokens = new Map<string, string>();

beforeAll(async () => {
  originalUrl = process.env.DATABASE_URL;
  if (!originalUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  adminPool = new pg.Pool({ connectionString: originalUrl });
  dbName = `helium_import_operations_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(originalUrl); url.pathname = `/${dbName}`;
  const pushed = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8",
  });
  if (pushed.status !== 0) throw new Error(`${pushed.stdout}\n${pushed.stderr}`);
  process.env.DATABASE_URL = url.toString();
  ({ signLegacyTokenForTests } = await import("../lib/auth"));
  ({ recordSession } = await import("../lib/authSessions"));
  ({ runImportSourceRetention } = await import("../lib/importSourceRetention"));
  tables = await import("@workspace/db");
  ({ IMPORT_SOURCE_RETENTION_MS: retentionMs } = await import("@workspace/db/schema"));
  db = tables.db; pool = tables.pool;
  route = await import("./importOperations");
  seedRoles = (await import("../lib/roles")).seedRoles;
  const { requireAuth } = await import("../middlewares/requireAuth");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => { (req as any).log = { info() {}, warn() {}, error() {}, debug() {} }; next(); });
  app.use((req, _res, next) => { (req as any).log = { info() {}, warn() {}, error() {}, debug() {} }; next(); });
  app.use((req, _res, next) => { (req as any).log = { info() {}, warn() {}, error() {}, debug() {} }; next(); });
  app.use((req, _res, next) => { (req as any).log = { info() {}, warn() {}, error() {}, debug() {} }; next(); });
  app.use("/api", requireAuth, route.default);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  route?.setImportOperationFailureHookForTest();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool?.end();
  if (adminPool) await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await adminPool?.end();
  process.env.DATABASE_URL = originalUrl;
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${tables.importOperationsTable}, ${tables.importHistoryTable}, ${tables.brandProfilesTable}, ${tables.mixesTable}, ${tables.specImportAliasesTable}, ${tables.authSessionsTable}, ${tables.userRolesTable}, ${tables.usersTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(tables.usersTable).values([
    { id: "inventory", username: "inventory", passwordHash: "x" },
    { id: "profiles", username: "profiles", passwordHash: "x" },
    { id: "sandbox", username: "sandbox", passwordHash: "x", sandbox: true },
  ]);
  await db.insert(tables.userRolesTable).values([
    { userId: "inventory", role: "manager" },
    { userId: "profiles", role: "operator" },
    { userId: "sandbox", role: "manager" },
  ]);
  sessionTokens.clear();
  for (const user of ["inventory", "profiles", "sandbox"]) {
    const token = signLegacyTokenForTests(user);
    sessionTokens.set(user, token);
    await recordSession(user, token);
  }
});

function headers(user = "inventory") {
  const token = sessionTokens.get(user);
  if (!token) throw new Error(`No test session established for ${user}`);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}
function change(id = "mix-atomic") {
  return {
    importType: "premix", sourceLabel: "reviewed.xlsx",
    changes: { mixes: { upsert: [{ id, name: "Atomic Mix", brand: "", flavor: "", batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0, components: [], isPrep: false, enabled: true }] } },
  };
}
async function apply(operationId: string, body: Record<string, unknown>, user = "inventory") {
  return fetch(`${baseUrl}/api/import-operations/${operationId}/apply`, {
    method: "POST", headers: headers(user), body: JSON.stringify(body),
  });
}

describe("atomic import operations", () => {
  it("rejects source evidence from a retired parser without persisting an operation", async () => {
    const response = await apply("oversized-operation-001", {
      importType: "premix", sourceLabel: "oversized.xlsx",
      changes: { mixes: { upsert: oversized } },
    });
    expect(response.status).toBe(400);
    expect(await db.select().from(tables.importOperationsTable)
      .where(eq(tables.importOperationsTable.id, "distill-retired-parser-0001"))).toHaveLength(0);
  });

  it("exports only completed, live, source-backed spec Applies to a manager", async () => {
    const sourceEvidence = {
      sourceText: "=== SHEET: Spec ===\nBrand\tAlpine Foods\nFlavor\tFour Cheese",
      parseVersion: SPEC_IMPORT_PARSE_VERSION,
    };
    const applied = await apply("mixed-capability-undo-0001", mixedBody);
    expect(applied.status).toBe(200);
    const before = await db.select().from(tables.importOperationsTable)
      .where(sql`${tables.importOperationsTable.id} IN ('retention-applied-000001', 'retention-undone-000001')`);

    const historyBefore = await db.select().from(tables.importHistoryTable)
      .where(sql`${tables.importHistoryTable.operationId} IN ('retention-applied-000001', 'retention-undone-000001')`);
    expect(before?.status).toBe("applied");

    const response = await apply("oversized-operation-001", {
      importType: "premix", sourceLabel: "oversized.xlsx",
      changes: { mixes: { upsert: oversized } },
    });
    expect(response.status).toBe(200);
    const page = await response.json() as { records: Array<Record<string, unknown>> };

    const applySource = async (operationId: string, label: string) => {
      const result = await apply(operationId, {
        importType: "spec",
        sourceLabel: `${label}.xlsx`,
        sourceEvidence: { sourceText: `private source for ${label}`, parseVersion: "41" },
        changes: {
          brandProfiles: {
            upsert: [{
              key: `${label.toLowerCase()}__flavor`,
              brand: label,
              flavor: "Flavor",
              values: { pizzasPerCase: 12 },
              crustValues: {},
              updatedAtMs: Date.now(),
            }],
          },
        },
      });
      expect(result.status).toBe(200);
      return result.json() as Promise<any>;
    };
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({
      operationId: "distill-authorized-0001",
      scope: "live",
      status: "applied",
      actorCapability: "manage-profiles",
      sourceText: sourceEvidence.sourceText,
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      parseVersion: SPEC_IMPORT_PARSE_VERSION,
    });
    expect(page.records[0]).not.toHaveProperty("actorId");
    expect(page.records[0]).not.toHaveProperty("sourceLabel");
    const after = await db.select().from(tables.importOperationsTable)
      .where(sql`${tables.importOperationsTable.id} IN ('retention-applied-000001', 'retention-undone-000001')`);

      const cleaned = after.find((row) => row.id === oldRow.id)!;
    expect(after).toEqual(before);
  });

  it("paginates source-backed evidence without repeating or skipping records", async () => {
    for (const suffix of ["0001", "0002"]) {
      await apply(`distill-page-${suffix}`, {
        importType: "spec",
        sourceLabel: `page-${suffix}.xlsx`,
        sourceEvidence: { sourceText: `Source ${suffix}`, parseVersion: SPEC_IMPORT_PARSE_VERSION },
        changes: {
          brandProfiles: {
            upsert: [{
              key: `brand ${suffix}__flavor`,
              brand: `Brand ${suffix}`,
              flavor: "Flavor",
              values: {},
              crustValues: {},
              updatedAtMs: Number(suffix),
            }],
          },
        },
      });
    }

    const firstResponse = await fetch(
      `${baseUrl}/api/import-operations/distillation-evidence?limit=1`,
      { headers: headers() },
    );
    const first = await (await apply("undo-deletion-000001", {
      importType: "premix", sourceLabel: "delete.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    expect(first.records).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const secondResponse = await fetch(
      `${baseUrl}/api/import-operations/distillation-evidence?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
      { headers: headers() },
    );
    const second = await (await apply("undo-deletion-000002", {
      importType: "premix", sourceLabel: "delete-again.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    expect(second.records).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.records, ...second.records].map((record) => record.operationId)).size).toBe(2);
  });

  it("rejects unauthorized readers and actors, missing-source, sandbox, and undone evidence", async () => {
    const unauthorizedApply = await apply("distill-unauthorized-0001", {
      importType: "spec",
      sourceLabel: "unauthorized.xlsx",
      sourceEvidence: { sourceText: "private", parseVersion: SPEC_IMPORT_PARSE_VERSION },
      changes: { brandProfiles: { upsert: [] } },
    }, "profiles");
    expect(unauthorizedApply.status).toBe(403);

    expect((await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers("profiles"),
    })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers("sandbox"),
    })).status).toBe(403);
    expect((await apply("distill-sandbox-source-0001", {
      importType: "spec",
      sourceLabel: "sandbox-source.xlsx",
      sourceEvidence: { sourceText: "Sandbox source", parseVersion: SPEC_IMPORT_PARSE_VERSION },
      changes: { brandProfiles: { upsert: [] } },
    }, "sandbox")).status).toBe(400);

    await apply("distill-missing-source-0001", {
      importType: "spec",
      sourceLabel: "legacy-no-source.xlsx",
      changes: { brandProfiles: { upsert: [] } },
    });
    const undone = await fetch(`${baseUrl}/api/import-operations/undo-aliases-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: created.operation.resultHash }),
    });
    const undoResponse = await fetch(`${baseUrl}/api/import-operations/retention-undone-000001/undo`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ expectedResultHash: oldUndone.operation.resultHash }),
    });

    const now = Date.now();
    expect(undoResponse.status).toBe(200);

    const response = await apply("oversized-operation-001", {
      importType: "premix", sourceLabel: "oversized.xlsx",
      changes: { mixes: { upsert: oversized } },
    });
    expect(response.status).toBe(200);
    const page = await response.json() as { records: Array<Record<string, unknown>> };

    const applySource = async (operationId: string, label: string) => {
      const result = await apply(operationId, {
        importType: "spec",
        sourceLabel: `${label}.xlsx`,
        sourceEvidence: { sourceText: `private source for ${label}`, parseVersion: "41" },
        changes: {
          brandProfiles: {
            upsert: [{
              key: `${label.toLowerCase()}__flavor`,
              brand: label,
              flavor: "Flavor",
              values: { pizzasPerCase: 12 },
              crustValues: {},
              updatedAtMs: Date.now(),
            }],
          },
        },
      });
      expect(result.status).toBe(200);
      return result.json() as Promise<any>;
    };
    const response = await apply("oversized-operation-001", {
      importType: "premix", sourceLabel: "oversized.xlsx",
      changes: { mixes: { upsert: oversized } },
    });
      expect(response.status).toBe(500);
      expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
      expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);
      route.setImportOperationFailureHookForTest();
    }
  });

  it("retries idempotently and rejects request mismatches", async () => {
    const body = {
      importType: "spec",
      sourceLabel: "aliases.xlsx",
      changes: {
        specImportAliases: {
          upsert: [{ kind: "brand", externalName: "Sheet Brand", canonicalName: "Canonical Brand", context: null }],
        },
      },
    };
    const first = await (await apply("undo-deletion-000001", {
      importType: "premix", sourceLabel: "delete.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    const second = await (await apply("undo-deletion-000002", {
      importType: "premix", sourceLabel: "delete-again.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(1);
    expect((await apply("retry-operation-000001", { ...body, sourceLabel: "different" })).status).toBe(409);
  });

  it("rejects a stale reviewed-state precondition", async () => {
    const response = await apply("oversized-operation-001", {
      importType: "premix", sourceLabel: "oversized.xlsx",
      changes: { mixes: { upsert: oversized } },
    });
    expect(response.status).toBe(409);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
  });

  it("undoes successfully, accepts unrelated edits, and refuses affected edits", async () => {
    const created = await (await apply("undo-aliases-000001", body)).json() as any;
    const resultHash = created.operation.resultHash;
    const firstUndo = await fetch(`${baseUrl}/api/import-operations/undo-success-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: resultHash }),
    });
    expect(firstUndo.status).toBe(200);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);

    const second = await (await apply("undo-deletion-000002", {
      importType: "premix", sourceLabel: "delete-again.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    await db.insert(tables.mixesTable).values({ id: "unrelated", scope: "live", name: "Unrelated", brand: "", flavor: "", batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0, components: [], isPrep: false, enabled: true });
    expect((await fetch(`${baseUrl}/api/import-operations/undo-refuse-000001/undo`, { method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: second.operation.resultHash }) })).status).toBe(200);
    expect(await db.select().from(tables.mixesTable).where(eq(tables.mixesTable.id, "unrelated"))).toHaveLength(1);

    const third = await (await apply("undo-affected-000001", change("affected-again"))).json() as any;
    await db.update(tables.mixesTable).set({ name: "Manager Edit" }).where(and(eq(tables.mixesTable.scope, "live"), eq(tables.mixesTable.id, "affected-again")));
    expect((await fetch(`${baseUrl}/api/import-operations/undo-affected-000001/undo`, { method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: third.operation.resultHash }) })).status).toBe(409);
  });

  it("undoes touched aliases without deleting unrelated aliases", async () => {
    await db.insert(tables.specImportAliasesTable).values({
      scope: "live", kind: "brand", externalName: "Keep Me", canonicalName: "Unrelated", context: null,
    });
    const body = {
      importType: "spec",
      sourceLabel: "aliases.xlsx",
      changes: {
        specImportAliases: {
          upsert: [{ kind: "brand", externalName: "Sheet Brand", canonicalName: "Canonical Brand", context: null }],
        },
      },
    };
    const created = await (await apply("undo-aliases-000001", body)).json() as any;
    const undone = await fetch(`${baseUrl}/api/import-operations/undo-aliases-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: created.operation.resultHash }),
    });
    expect(undone.status).toBe(200);
    const aliases = await db.select().from(tables.specImportAliasesTable);
    expect(aliases.map((row) => row.externalName)).toEqual(["Keep Me"]);
  });

  it("restores imported deletions and refuses after the deleted identity is recreated", async () => {
    const deletedRow = {
      id: "delete-me", scope: "live", name: "Delete Me", brand: "", flavor: "",
      batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0,
      components: [], isPrep: false, enabled: true,
    };
    await db.insert(tables.mixesTable).values(deletedRow);
    const first = await (await apply("undo-deletion-000001", {
      importType: "premix", sourceLabel: "delete.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    const restored = await fetch(`${baseUrl}/api/import-operations/undo-deletion-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: first.operation.resultHash }),
    });
    expect(restored.status).toBe(200);
    expect(await db.select().from(tables.mixesTable).where(eq(tables.mixesTable.id, deletedRow.id))).toHaveLength(1);

    await db.delete(tables.mixesTable).where(eq(tables.mixesTable.id, deletedRow.id));
    await db.insert(tables.mixesTable).values(deletedRow);
    const second = await (await apply("undo-deletion-000002", {
      importType: "premix", sourceLabel: "delete-again.xlsx",
      changes: { mixes: { delete: [deletedRow.id] } },
    })).json() as any;
    await db.insert(tables.mixesTable).values({ ...deletedRow, name: "Manager Recreated" });
    const refused = await fetch(`${baseUrl}/api/import-operations/undo-deletion-000002/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: second.operation.resultHash }),
    });
    expect(refused.status).toBe(409);
  });

  it("rejects oversized change lists without committing a partial import", async () => {
    const oversized = Array.from({ length: 501 }, (_, index) => ({
      id: `oversized-${index}`, name: `Oversized ${index}`, brand: "", flavor: "",
      batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0,
      components: [], isPrep: false, enabled: true,
    }));
    const response = await apply("oversized-operation-001", {
      importType: "premix", sourceLabel: "oversized.xlsx",
      changes: { mixes: { upsert: oversized } },
    });
    expect(response.status).toBe(400);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);
  });

  it("enforces importer capability and live/sandbox scope", async () => {
    expect((await apply("profile-capability-0001", change(), "profiles")).status).toBe(403);
    const sandbox = await apply("sandbox-operation-0001", change("sandbox-id"), "sandbox");
    expect(sandbox.status).toBe(200);
    expect(await db.select().from(tables.mixesTable).where(eq(tables.mixesTable.scope, "live"))).toHaveLength(0);
  });

  it("requires every changed entity capability for apply and undo", async () => {
    await db.update(tables.rolesTable)
      .set({ capabilities: ["manage-profiles"] })
      .where(eq(tables.rolesTable.name, "operator"));

    const mixedBody = {
      importType: "premix",
      sourceLabel: "mixed-capability.xlsx",
      changes: {
        mixes: {
          upsert: [{
            id: "mixed-capability-mix",
            name: "Mixed Capability Mix",
            brand: "",
            flavor: "",
            batchSize: 1,
            daysEarly: 0,
            notes: "",
            amountAlreadyMade: 0,
            components: [],
            isPrep: false,
            enabled: true,
          }],
        },
        specImportAliases: {
          upsert: [{
            kind: "brand",
            externalName: "Mixed Capability",
            canonicalName: "Canonical",
            context: null,
          }],
        },
      },
    };

    const rejectedApply = await apply(
      "mixed-capability-apply-0001",
      { ...mixedBody, importType: "spec" },
      "profiles",
    );
    expect(rejectedApply.status).toBe(403);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);

    const applied = await apply("mixed-capability-undo-0001", mixedBody);
    expect(applied.status).toBe(200);
    const rejectedUndo = await fetch(
      `${baseUrl}/api/import-operations/mixed-capability-undo-0001/undo`,
      {
        method: "POST",
        headers: headers("profiles"),
        body: JSON.stringify({}),
      },
    );
    expect(rejectedUndo.status).toBe(403);
    expect(
      await db.select().from(tables.mixesTable)
        .where(eq(tables.mixesTable.id, "mixed-capability-mix")),
    ).toHaveLength(1);
    expect(
      await db.select().from(tables.specImportAliasesTable)
        .where(eq(tables.specImportAliasesTable.externalName, "Mixed Capability")),
    ).toHaveLength(1);
    expect(
      (await db.select().from(tables.importOperationsTable))
        .find((row) => row.id === "mixed-capability-undo-0001")?.status,
    ).toBe("applied");
  });
});

    const authorizedLiveMetadata = {
      format: "spec-apply-source-v1",
      sourceSha256: "a".repeat(64),
      parseVersion: "41",
      actorCapability: "manage-profiles",
      actorIdSha256: "b".repeat(64),
      sourceText: "should remain in sandbox",
    };

    const historyAfter = await db.select().from(tables.importHistoryTable)
      .where(sql`${tables.importHistoryTable.operationId} IN ('retention-applied-000001', 'retention-undone-000001')`);

    const sandboxAndPending = await db.select().from(tables.importOperationsTable)
      .where(sql`${tables.importOperationsTable.id} IN ('retention-sandbox-000001', 'retention-pending-000001')`);

    const oldApplied = await applySource("retention-applied-000001", "Retention Applied");

      const originalEvidence = oldRow.distillEvidence as Record<string, unknown>;

    const exported = await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers(),
    });

    const expiredAt = new Date(now - retentionMs - 1);

let retentionMs: number;

    const operationHistory = await fetch(`${baseUrl}/api/import-operations/retention-applied-000001`, {
      headers: headers(),
    });

      const cleanedEvidence = cleaned.distillEvidence as Record<string, unknown>;

    const oldUndone = await applySource("retention-undone-000001", "Retention Undone");
