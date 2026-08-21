// HTTP-level coverage for targeted learned-alias deletion.
//
// @workspace/db binds its pool at import time, so this test creates and
// migrates a disposable database before dynamically importing the router.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let specImportAliasesTable: DbModule["specImportAliasesTable"];
let server: Server;
let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let baseUrl: string;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_spec_alias_delete_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const requestScopeMod = await import("../lib/requestScope");
  const routerMod = await import("./specImportAliases");
  db = dbMod.db;
  pool = dbMod.pool;
  specImportAliasesTable = dbMod.specImportAliasesTable;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use((req, _res, next) => {
    const scope = req.header("x-test-scope") === "sandbox" ? "sandbox" : "live";
    requestScopeMod.runWithScope(scope, () => next());
  });
  app.use("/api", routerMod.default);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${specImportAliasesTable} RESTART IDENTITY CASCADE`);
});

type Scope = "live" | "sandbox";
type Alias = {
  kind: string;
  externalName: string;
  canonicalName: string;
  context?: string | null;
};

function headers(scope: Scope): Record<string, string> {
  return { "content-type": "application/json", "x-test-scope": scope };
}

async function deleteAliases(aliases: Alias[], scope: Scope = "live"): Promise<Response> {
  return fetch(`${baseUrl}/api/spec-import-aliases/delete`, {
    method: "POST",
    headers: headers(scope),
    body: JSON.stringify({ aliases }),
  });
}

async function listAliases(scope: Scope = "live"): Promise<Alias[]> {
  const response = await fetch(`${baseUrl}/api/spec-import-aliases`, {
    headers: headers(scope),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { aliases: Alias[] }).aliases;
}

describe("POST /spec-import-aliases/delete", () => {
  it("deletes only exact case-insensitive mappings, respecting context and scope", async () => {
    await db.insert(specImportAliasesTable).values([
      {
        scope: "live",
        kind: "flavor",
        externalName: "Sheet Pepperoni",
        canonicalName: "House Pepperoni",
        context: "Brand A",
      },
      {
        scope: "live",
        kind: "flavor",
        externalName: "SHEET PEPPERONI",
        canonicalName: "HOUSE PEPPERONI",
        context: "Brand B",
      },
      {
        scope: "live",
        kind: "flavor",
        externalName: "Sheet Pepperoni",
        canonicalName: "House Pepperoni",
        context: null,
      },
      {
        scope: "live",
        kind: "flavor",
        externalName: "Sheet Pepperoni",
        canonicalName: "Different Canonical",
        context: "Brand A",
      },
      {
        scope: "live",
        kind: "brand",
        externalName: "Sheet Pepperoni",
        canonicalName: "House Pepperoni",
        context: "Brand A",
      },
      {
        scope: "sandbox",
        kind: "flavor",
        externalName: "Sheet Pepperoni",
        canonicalName: "House Pepperoni",
        context: "Brand A",
      },
    ]);

    const response = await deleteAliases([
      {
        kind: "flavor",
        externalName: " sheet pepperoni ",
        canonicalName: " HOUSE PEPPERONI ",
        context: " brand a ",
      },
    ]);
    expect(response.status).toBe(200);

    expect(await listAliases()).toEqual([
      {
        kind: "flavor",
        externalName: "SHEET PEPPERONI",
        canonicalName: "HOUSE PEPPERONI",
        context: "Brand B",
      },
      {
        kind: "flavor",
        externalName: "Sheet Pepperoni",
        canonicalName: "House Pepperoni",
        context: null,
      },
      {
        kind: "flavor",
        externalName: "Sheet Pepperoni",
        canonicalName: "Different Canonical",
        context: "Brand A",
      },
      {
        kind: "brand",
        externalName: "Sheet Pepperoni",
        canonicalName: "House Pepperoni",
        context: "Brand A",
      },
    ]);
    expect(await listAliases("sandbox")).toEqual([
      {
        kind: "flavor",
        externalName: "Sheet Pepperoni",
        canonicalName: "House Pepperoni",
        context: "Brand A",
      },
    ]);
  });

  it("deletes every context when the requested context is null", async () => {
    await db.insert(specImportAliasesTable).values([
      {
        scope: "live",
        kind: "appType",
        externalName: "Sheet Mix",
        canonicalName: "House Mix",
        context: "Brand A",
      },
      {
        scope: "live",
        kind: "appType",
        externalName: "SHEET MIX",
        canonicalName: "HOUSE MIX",
        context: "Brand B",
      },
      {
        scope: "live",
        kind: "appType",
        externalName: "Sheet Mix",
        canonicalName: "Other Mix",
        context: "Brand A",
      },
    ]);

    const response = await deleteAliases([
      { kind: "appType", externalName: "sheet mix", canonicalName: "house mix", context: null },
    ]);
    expect(response.status).toBe(200);
    expect(await listAliases()).toEqual([
      {
        kind: "appType",
        externalName: "Sheet Mix",
        canonicalName: "Other Mix",
        context: "Brand A",
      },
    ]);
  });

  it.each([
    undefined,
    {},
    { aliases: [{ kind: "not-a-kind", externalName: "a", canonicalName: "b" }] },
  ])("returns 400 for invalid body %#", async (body) => {
    const response = await fetch(`${baseUrl}/api/spec-import-aliases/delete`, {
      method: "POST",
      headers: headers("live"),
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  });
});