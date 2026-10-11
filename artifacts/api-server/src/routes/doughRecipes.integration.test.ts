// Integration test: customers must NOT be wiped when a dough workbook is
// re-imported and the incoming parse has no customer section.
//
// The fix lives in mergeNamedRecipeDoughballVariants (lib): when the incoming
// variant list has no customers for a variant that already has them, the existing
// customers are carried forward.  This file tests the full HTTP round-trip:
//
//   1. POST /api/dough-recipes with variants that carry customers.
//   2. GET  /api/dough-recipes (simulates the client reading the current pool).
//   3. Call mergeNamedRecipeDoughballVariants with the pool + an "incoming"
//      variant list that has NO customers (typical workbook re-import).
//   4. POST the merged result back to /api/dough-recipes.
//   5. GET again and assert customers are still present.
//
// Uses the same disposable-Postgres pattern as cheeseRecipes.integration.test.ts:
// DATABASE_URL is repointed BEFORE any dynamic import pulls in @workspace/db.
// See .agents/memory/integration-test-db-binding.md.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signLegacyTokenForTests } from "../lib/auth";
import {
  mergeNamedRecipeDoughballVariants,
  normalizeNamedRecipes,
  type DoughballVariant,
  type NamedRecipe,
} from "@workspace/named-recipes";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let doughRecipesTable: DbModule["doughRecipesTable"];
let sauceRecipesTable: DbModule["sauceRecipesTable"];
let auditLogsTable: DbModule["auditLogsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "manager-doughtest-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_doughrecipes_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const routerMod = await import("./index");
  const userValidityMod = await import("../lib/userValidity");
  const observabilityMod = await import("../lib/observability");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  doughRecipesTable = dbMod.doughRecipesTable;
  sauceRecipesTable = dbMod.sauceRecipesTable;
  auditLogsTable = dbMod.auditLogsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use(observabilityMod.observabilityMiddleware);
  app.use("/api", routerMod.default);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${doughRecipesTable}, ${sauceRecipesTable}, ${auditLogsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([{ id: MANAGER, username: "manager-dough", passwordHash: "x" }]);
  await db.insert(userRolesTable).values([{ userId: MANAGER, role: "manager" }]);
});

const AUTH = () => ({ authorization: `Bearer ${signLegacyTokenForTests(MANAGER)}` });

async function postDoughRecipes(items: NamedRecipe[]): Promise<NamedRecipe[]> {
  const res = await fetch(`${baseUrl}/api/dough-recipes`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH() },
    body: JSON.stringify({ items }),
  });
  expect(res.status).toBe(200);
  return normalizeNamedRecipes(((await res.json()) as { items: unknown }).items);
}

async function getDoughRecipes(): Promise<NamedRecipe[]> {
  const res = await fetch(`${baseUrl}/api/dough-recipes`, {
    headers: AUTH(),
  });
  expect(res.status).toBe(200);
  return normalizeNamedRecipes(((await res.json()) as { items: unknown }).items);
}

async function postSauceRecipes(items: NamedRecipe[]): Promise<{ status: number; items: NamedRecipe[] }> {
  const res = await fetch(`${baseUrl}/api/sauce-recipes`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH() },
    body: JSON.stringify({ items }),
  });
  return {
    status: res.status,
    items: normalizeNamedRecipes(((await res.json()) as { items?: unknown }).items),
  };
}

async function getSauceRecipes(): Promise<NamedRecipe[]> {
  const res = await fetch(`${baseUrl}/api/sauce-recipes`, {
    headers: AUTH(),
  });
  expect(res.status).toBe(200);
  return normalizeNamedRecipes(((await res.json()) as { items: unknown }).items);
}

function namedRecipe(overrides: Partial<NamedRecipe> = {}): NamedRecipe {
  return {
    id: "recipe-1",
    name: "House Recipe",
    notes: "",
    components: [{ ingredient: "Flour", lbs: 10 }],
    enabled: true,
    brand: "",
    flavors: [],
    ...overrides,
  };
}

async function rawPostNamedRecipe(path: string, item: NamedRecipe, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH(), ...headers },
    body: JSON.stringify({ items: [item] }),
  });
}

async function rawDeleteNamedRecipe(path: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...AUTH() },
    body: JSON.stringify({ ids: [id] }),
  });
}

describe("dough and sauce recipe audit attribution", () => {
  const cases = [
    {
      family: "dough_recipe",
      path: "/api/dough-recipes",
      recipe: namedRecipe({
        id: "audit-dough-recipe",
        name: "PRIVATE_DOUGH_NAME",
        brand: "PRIVATE_DOUGH_BRAND",
        flavors: ["PRIVATE_DOUGH_FLAVOR"],
        notes: "PRIVATE_DOUGH_NOTES",
        components: [{ ingredient: "PRIVATE_DOUGH_INGREDIENT", lbs: 10 }],
        doughballWeightOz: 8,
        doughballsPerTray: 30,
      }),
      createdFields: [
        "name", "notes", "components", "enabled", "brand", "flavors",
        "doughballWeightOz", "doughballsPerTray", "doughballVariants",
      ],
      privateValues: [
        "PRIVATE_DOUGH_NAME", "PRIVATE_DOUGH_BRAND", "PRIVATE_DOUGH_FLAVOR",
        "PRIVATE_DOUGH_NOTES", "PRIVATE_DOUGH_INGREDIENT", "UPDATED_DOUGH_NAME",
        "UPDATED_DOUGH_NOTES", "UPDATED_DOUGH_INGREDIENT",
      ],
      updatedName: "UPDATED_DOUGH_NAME",
      updatedNotes: "UPDATED_DOUGH_NOTES",
      updatedIngredient: "UPDATED_DOUGH_INGREDIENT",
    },
    {
      family: "sauce_recipe",
      path: "/api/sauce-recipes",
      recipe: namedRecipe({
        id: "audit-sauce-recipe",
        name: "PRIVATE_SAUCE_NAME",
        brand: "PRIVATE_SAUCE_BRAND",
        flavors: ["PRIVATE_SAUCE_FLAVOR"],
        notes: "PRIVATE_SAUCE_NOTES",
        components: [{ ingredient: "PRIVATE_SAUCE_INGREDIENT", lbs: 10 }],
      }),
      createdFields: ["name", "notes", "components", "enabled", "brand", "flavors"],
      privateValues: [
        "PRIVATE_SAUCE_NAME", "PRIVATE_SAUCE_BRAND", "PRIVATE_SAUCE_FLAVOR",
        "PRIVATE_SAUCE_NOTES", "PRIVATE_SAUCE_INGREDIENT", "UPDATED_SAUCE_NAME",
        "UPDATED_SAUCE_NOTES", "UPDATED_SAUCE_INGREDIENT",
      ],
      updatedName: "UPDATED_SAUCE_NAME",
      updatedNotes: "UPDATED_SAUCE_NOTES",
      updatedIngredient: "UPDATED_SAUCE_INGREDIENT",
    },
  ] as const;

  it.each(cases)("records $family creates, meaningful updates, and deletions without recipe values", async ({
    family,
    path,
    recipe: original,
    createdFields,
    privateValues,
    updatedName,
    updatedNotes,
    updatedIngredient,
  }) => {
    const createdResponse = await rawPostNamedRecipe(path, original, {
      "x-correlation-id": "client-supplied-correlation",
    });
    expect(createdResponse.status).toBe(200);
    const createdCorrelationId = createdResponse.headers.get("x-correlation-id");
    expect(createdCorrelationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(createdCorrelationId).not.toBe("client-supplied-correlation");
    const createdItems = ((await createdResponse.json()) as { items: NamedRecipe[] }).items;
    const createdRecipe = createdItems.find((item) => item.id === original.id);
    expect(createdRecipe).toBeDefined();

    const updatedResponse = await rawPostNamedRecipe(path, {
      ...createdRecipe!,
      name: updatedName,
      notes: updatedNotes,
      components: [{ ingredient: updatedIngredient, lbs: 12 }],
    });
    expect(updatedResponse.status).toBe(200);
    const updatedCorrelationId = updatedResponse.headers.get("x-correlation-id");
    expect(updatedCorrelationId).toMatch(/^[0-9a-f-]{36}$/);
    const updatedItems = ((await updatedResponse.json()) as { items: NamedRecipe[] }).items;
    const updatedRecipe = updatedItems.find((item) => item.id === original.id);
    expect(updatedRecipe).toBeDefined();

    // Saving the same snapshot is not a meaningful recipe update and must not
    // add an extra history row.
    const noOpResponse = await rawPostNamedRecipe(path, updatedRecipe!);
    expect(noOpResponse.status).toBe(200);

    const deletedResponse = await rawDeleteNamedRecipe(path, original.id);
    expect(deletedResponse.status).toBe(200);
    const deletedCorrelationId = deletedResponse.headers.get("x-correlation-id");
    expect(deletedCorrelationId).toMatch(/^[0-9a-f-]{36}$/);

    const resource = `${family}:${original.id}`;
    const auditRows = (await db.select().from(auditLogsTable))
      .filter((row) => row.resource === resource)
      .sort((left, right) => left.id - right.id);
    expect(auditRows).toHaveLength(3);
    expect(auditRows.map((row) => row.action)).toEqual([
      `${family}_created`,
      `${family}_updated`,
      `${family}_deleted`,
    ]);
    expect(auditRows.map((row) => row.actor)).toEqual([MANAGER, MANAGER, MANAGER]);
    expect(auditRows.every((row) => row.createdAt instanceof Date)).toBe(true);
    expect(auditRows.map((row) => row.changes)).toEqual([
      { fieldNames: createdFields, correlationId: createdCorrelationId },
      { fieldNames: ["name", "notes", "components"], correlationId: updatedCorrelationId },
      { fieldNames: createdFields, correlationId: deletedCorrelationId },
    ]);

    const auditPayload = JSON.stringify(auditRows.map((row) => row.changes));
    for (const privateValue of privateValues) expect(auditPayload).not.toContain(privateValue);

    const managerRead = await fetch(`${baseUrl}/api/audit-logs`, { headers: AUTH() });
    expect(managerRead.status).toBe(200);
    const page = await managerRead.json() as { logs: Array<{ action: string; resource: string }> };
    expect(page.logs.filter((row) => row.resource === resource).map((row) => row.action).sort()).toEqual([
      `${family}_created`,
      `${family}_deleted`,
      `${family}_updated`,
    ].sort());
  });
});

describe("POST /dough-recipes — customer preservation on re-import (Bug 1 regression)", () => {
  it("customers survive when the re-import variants have no customers (replace mode)", async () => {
    // Step 1: Create a dough recipe with variants that carry customers.
    const initial: NamedRecipe = {
      id: "dough:crb",
      name: "CRB Dough",
      notes: "",
      components: [{ ingredient: "Flour", lbs: 50 }],
      enabled: true,
      brand: "",
      flavors: [],
      doughballVariants: [
        {
          label: "Hannaford",
          weightOz: 7.6,
          customers: [{ brand: "Hannaford", flavor: "Five Cheese" }],
        } as DoughballVariant,
        {
          label: "Costco",
          weightOz: 9.6,
          customers: [{ brand: "Costco", flavor: "" }],
        } as DoughballVariant,
      ] as DoughballVariant[],
    };
    await postDoughRecipes([initial]);

    // Step 2: Simulate what the web client does for a re-import:
    //   a. GET the current pool (reads back the record with customers).
    const currentPool = await getDoughRecipes();
    expect(currentPool).toHaveLength(1);
    const storedVariants = currentPool[0].doughballVariants ?? [];
    const hannafordBefore = storedVariants.find((v) => v.label === "Hannaford") as DoughballVariant | undefined;
    expect(hannafordBefore?.customers).toBeDefined();
    expect(hannafordBefore?.customers?.length).toBeGreaterThan(0);

    //   b. Call mergeNamedRecipeDoughballVariants — incoming has updated weights
    //      but NO customers (typical workbook re-import without a customer section).
    const incomingVariants = new Map<string, DoughballVariant[]>([
      [
        "crb dough",
        [
          { label: "Hannaford", weightOz: 7.7 }, // updated weight, no customers
          { label: "Costco", weightOz: 9.7 },    // updated weight, no customers
        ],
      ],
    ]);
    const changed = mergeNamedRecipeDoughballVariants(currentPool, incomingVariants, { replace: true });
    // Weight updated → there should be a change recorded.
    expect(changed).toHaveLength(1);

    //   c. POST the merged result back to the server.
    const mergedPool = currentPool.map((r) => changed.find((c) => c.id === r.id) ?? r);
    await postDoughRecipes(mergedPool);

    // Step 3: GET again and assert customers survived.
    const afterReimport = await getDoughRecipes();
    expect(afterReimport).toHaveLength(1);
    const finalVariants = afterReimport[0].doughballVariants ?? [];

    const hannafordAfter = finalVariants.find((v) => v.label === "Hannaford") as DoughballVariant | undefined;
    expect(hannafordAfter?.weightOz).toBe(7.7); // weight updated
    expect(hannafordAfter?.customers).toContainEqual({ brand: "Hannaford", flavor: "Five Cheese" });

    const costcoAfter = finalVariants.find((v) => v.label === "Costco") as DoughballVariant | undefined;
    expect(costcoAfter?.weightOz).toBe(9.7); // weight updated
    expect(costcoAfter?.customers).toContainEqual({ brand: "Costco", flavor: "" });
  });

  it("customers survive a second consecutive re-import with no customers", async () => {
    // Regression: the preservation must hold across MULTIPLE imports, not just
    // the first. If the carry-forward is a one-shot behaviour it would fail here.
    const initial: NamedRecipe = {
      id: "dough:crb2",
      name: "CRB Dough",
      notes: "",
      components: [],
      enabled: true,
      brand: "",
      flavors: [],
      doughballVariants: [
        {
          label: "Lucia's Craft CRB Thick",
          weightOz: 13.8,
          customers: [
            { brand: "Lucia's Craft", flavor: "BBQ Chicken" },
            { brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" },
          ],
        } as DoughballVariant,
      ] as DoughballVariant[],
    };
    await postDoughRecipes([initial]);

    async function reimport(weightOz: number): Promise<NamedRecipe[]> {
      const pool = await getDoughRecipes();
      const incoming = new Map<string, DoughballVariant[]>([
        ["crb dough", [{ label: "Lucia's Craft CRB Thick", weightOz }]],
      ]);
      const changed = mergeNamedRecipeDoughballVariants(pool, incoming, { replace: true });
      const merged = pool.map((r) => changed.find((c) => c.id === r.id) ?? r);
      await postDoughRecipes(merged);
      return getDoughRecipes();
    }

    // Re-import 1: weight bump → changed; customers must survive.
    const after1 = await reimport(13.9);
    expect(after1).toHaveLength(1);
    const thick1 = (after1[0].doughballVariants ?? []).find(
      (v) => v.label === "Lucia's Craft CRB Thick",
    ) as DoughballVariant | undefined;
    expect(thick1?.weightOz).toBe(13.9);
    expect(thick1?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "BBQ Chicken" });
    expect(thick1?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" });

    // Re-import 2: another weight bump → customers must still be there.
    const after2 = await reimport(14.0);
    const thick2 = (after2[0].doughballVariants ?? []).find(
      (v) => v.label === "Lucia's Craft CRB Thick",
    ) as DoughballVariant | undefined;
    expect(thick2?.weightOz).toBe(14.0);
    expect(thick2?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "BBQ Chicken" });
    expect(thick2?.customers).toContainEqual({ brand: "Lucia's Craft", flavor: "Four Cheese Meltdown" });
  });

  it("customers from the incoming list are unioned with existing customers, not replaced", async () => {
    // When the re-import DOES parse customers for a variant, the new ones must be
    // ADDED to (not replace) the existing set — this matches additive union semantics.
    const initial: NamedRecipe = {
      id: "dough:crb3",
      name: "CRB Dough",
      notes: "",
      components: [],
      enabled: true,
      brand: "",
      flavors: [],
      doughballVariants: [
        {
          label: "Hannaford",
          weightOz: 7.6,
          customers: [{ brand: "Hannaford", flavor: "Five Cheese" }],
        } as DoughballVariant,
      ] as DoughballVariant[],
    };
    await postDoughRecipes([initial]);

    const pool = await getDoughRecipes();
    const incoming = new Map<string, DoughballVariant[]>([
      [
        "crb dough",
        [
          {
            label: "Hannaford",
            weightOz: 7.7,
            customers: [{ brand: "Hannaford", flavor: "BBQ Chicken" }], // new flavor
          },
        ],
      ],
    ]);
    const changed = mergeNamedRecipeDoughballVariants(pool, incoming, { replace: true });
    const merged = pool.map((r) => changed.find((c) => c.id === r.id) ?? r);
    await postDoughRecipes(merged);

    const afterReimport = await getDoughRecipes();
    const variant = (afterReimport[0].doughballVariants ?? []).find(
      (v) => v.label === "Hannaford",
    ) as DoughballVariant | undefined;
    // Both the original and the new customer must be present.
    expect(variant?.customers).toContainEqual({ brand: "Hannaford", flavor: "Five Cheese" });
    expect(variant?.customers).toContainEqual({ brand: "Hannaford", flavor: "BBQ Chicken" });
  });
});

describe("POST /dough-recipes — freshness fence", () => {
  async function rawPost(items: NamedRecipe[]) {
    const res = await fetch(`${baseUrl}/api/dough-recipes`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH() },
      body: JSON.stringify({ items }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("rejects stale and missing revisions with the authoritative pool", async () => {
    const created = await postDoughRecipes([namedRecipe({ id: "dough-stale" })]);
    const revision = created[0].updatedAt;
    expect(revision).toBeTruthy();
    await postDoughRecipes([namedRecipe({ id: "dough-stale", name: "Canonical Dough", updatedAt: revision })]);

    const stale = await rawPost([
      namedRecipe({ id: "dough-stale", name: "Stale Dough", updatedAt: revision }),
    ]);
    expect(stale.status).toBe(409);
    expect(stale.body.rejectedIds).toEqual(["dough-stale"]);
    expect((stale.body.items as NamedRecipe[]).find((item) => item.id === "dough-stale")?.name)
      .toBe("Canonical Dough");

    const missing = await rawPost([
      namedRecipe({ id: "dough-stale", name: "Missing Revision Dough" }),
    ]);
    expect(missing.status).toBe(409);
    expect(missing.body.rejectedIds).toEqual(["dough-stale"]);
    expect((await getDoughRecipes()).find((item) => item.id === "dough-stale")?.name)
      .toBe("Canonical Dough");
  });

  it("rejects a mixed batch before either recipe changes", async () => {
    const created = await postDoughRecipes([
      namedRecipe({ id: "dough-a", name: "Dough A" }),
      namedRecipe({ id: "dough-b", name: "Dough B" }),
    ]);
    const oldB = created.find((item) => item.id === "dough-b")?.updatedAt;
    await postDoughRecipes([
      namedRecipe({ id: "dough-a", name: "Dough A canonical", updatedAt: created.find((item) => item.id === "dough-a")?.updatedAt }),
      namedRecipe({ id: "dough-b", name: "Dough B canonical", updatedAt: oldB }),
    ]);
    const current = await getDoughRecipes();
    const attempted = await rawPost([
      namedRecipe({ id: "dough-a", name: "Dough A attempted", updatedAt: current.find((item) => item.id === "dough-a")?.updatedAt }),
      namedRecipe({ id: "dough-b", name: "Dough B attempted", updatedAt: oldB }),
    ]);
    expect(attempted.status).toBe(409);
    expect((attempted.body.items as NamedRecipe[]).find((item) => item.id === "dough-a")?.name)
      .toBe("Dough A canonical");
    expect((attempted.body.items as NamedRecipe[]).find((item) => item.id === "dough-b")?.name)
      .toBe("Dough B canonical");
  });
});

describe("POST /sauce-recipes — freshness fence", () => {
  async function rawPost(items: NamedRecipe[]) {
    const res = await fetch(`${baseUrl}/api/sauce-recipes`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH() },
      body: JSON.stringify({ items }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("rejects stale and missing revisions with the authoritative pool", async () => {
    const created = await postSauceRecipes([namedRecipe({ id: "sauce-stale", name: "House Sauce" })]);
    const revision = created.items[0].updatedAt;
    expect(revision).toBeTruthy();
    await postSauceRecipes([
      namedRecipe({ id: "sauce-stale", name: "Canonical Sauce", updatedAt: revision }),
    ]);

    const stale = await rawPost([
      namedRecipe({ id: "sauce-stale", name: "Stale Sauce", updatedAt: revision }),
    ]);
    expect(stale.status).toBe(409);
    expect(stale.body.rejectedIds).toEqual(["sauce-stale"]);
    expect((stale.body.items as NamedRecipe[]).find((item) => item.id === "sauce-stale")?.name)
      .toBe("Canonical Sauce");

    const missing = await rawPost([
      namedRecipe({ id: "sauce-stale", name: "Missing Revision Sauce" }),
    ]);
    expect(missing.status).toBe(409);
    expect(missing.body.rejectedIds).toEqual(["sauce-stale"]);
    expect((await getSauceRecipes()).find((item) => item.id === "sauce-stale")?.name)
      .toBe("Canonical Sauce");
  });

  it("rejects a mixed batch before either recipe changes", async () => {
    const created = await postSauceRecipes([
      namedRecipe({ id: "sauce-a", name: "Sauce A" }),
      namedRecipe({ id: "sauce-b", name: "Sauce B" }),
    ]);
    const oldB = created.items.find((item) => item.id === "sauce-b")?.updatedAt;
    await postSauceRecipes([
      namedRecipe({ id: "sauce-a", name: "Sauce A canonical", updatedAt: created.items.find((item) => item.id === "sauce-a")?.updatedAt }),
      namedRecipe({ id: "sauce-b", name: "Sauce B canonical", updatedAt: oldB }),
    ]);
    const current = await getSauceRecipes();
    const attempted = await rawPost([
      namedRecipe({ id: "sauce-a", name: "Sauce A attempted", updatedAt: current.find((item) => item.id === "sauce-a")?.updatedAt }),
      namedRecipe({ id: "sauce-b", name: "Sauce B attempted", updatedAt: oldB }),
    ]);
    expect(attempted.status).toBe(409);
    expect((attempted.body.items as NamedRecipe[]).find((item) => item.id === "sauce-a")?.name)
      .toBe("Sauce A canonical");
    expect((attempted.body.items as NamedRecipe[]).find((item) => item.id === "sauce-b")?.name)
      .toBe("Sauce B canonical");
  });
});
