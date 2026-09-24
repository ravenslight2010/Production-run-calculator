import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signToken } from "../lib/auth";
import { recordSession } from "../lib/authSessions";

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
  tables = await import("@workspace/db");
  db = tables.db; pool = tables.pool;
  route = await import("./importOperations");
  seedRoles = (await import("../lib/roles")).seedRoles;
  const { requireAuth } = await import("../middlewares/requireAuth");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
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
  await db.execute(sql`TRUNCATE ${tables.importOperationsTable}, ${tables.importHistoryTable}, ${tables.mixesTable}, ${tables.specImportAliasesTable}, ${tables.authSessionsTable}, ${tables.userRolesTable}, ${tables.usersTable} RESTART IDENTITY CASCADE`);
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
    const token = signToken(user);
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
  it("rolls back after failures at domain and history stages", async () => {
    for (const stage of ["after-mixes", "after-history"]) {
      route.setImportOperationFailureHookForTest((actual) => { if (actual === stage) throw new Error("injected"); });
      const response = await apply(`rollback-${stage.replace("-", "")}-001`, change());
      expect(response.status).toBe(500);
      expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
      expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);
      route.setImportOperationFailureHookForTest();
    }
  });

  it("retries idempotently and rejects request mismatches", async () => {
    const body = change();
    const first = await apply("retry-operation-000001", body);
    const second = await apply("retry-operation-000001", body);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(1);
    expect((await apply("retry-operation-000001", { ...body, sourceLabel: "different" })).status).toBe(409);
  });

  it("rejects a stale reviewed-state precondition", async () => {
    const response = await apply("stale-review-000001", { ...change(), expectedStateHash: "0".repeat(64) });
    expect(response.status).toBe(409);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
  });

  it("undoes successfully, accepts unrelated edits, and refuses affected edits", async () => {
    const created = await (await apply("undo-success-000001", change())).json() as any;
    const resultHash = created.operation.resultHash;
    const firstUndo = await fetch(`${baseUrl}/api/import-operations/undo-success-000001/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: resultHash }),
    });
    expect(firstUndo.status).toBe(200);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);

    const second = await (await apply("undo-refuse-000001", change("affected"))).json() as any;
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
});