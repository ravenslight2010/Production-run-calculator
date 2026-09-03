// Integration tests for POST /ai-corrections chain-forwarding (Task #536).
//
// When a name is renamed again after a correction is already recorded, the write
// path must collapse the chain so the AI memory pool never accumulates A→B + B→C
// entries that dropConflictingCorrections would silently discard.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so
// the throwaway DB is created and DATABASE_URL is repointed BEFORE the router is
// imported — hence dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

// The router imports AI routes at load time; mock the provider so no real
// requests are made and pickModel / AI_MODELS remain resolvable.
vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
    },
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let aiCorrectionsTable: DbModule["aiCorrectionsTable"];
let facilityKnowledgeTable: DbModule["facilityKnowledgeTable"];
let aiConversationTurnsTable: DbModule["aiConversationTurnsTable"];
let mergeAliasesTable: DbModule["mergeAliasesTable"];
let importAliasesTable: DbModule["importAliasesTable"];
let specImportAliasesTable: DbModule["specImportAliasesTable"];
let dataHealthRepairBatchesTable: DbModule["dataHealthRepairBatchesTable"];
let auditLogsTable: DbModule["auditLogsTable"];
let ingredientsTable: DbModule["ingredientsTable"];
let brandProfilesTable: DbModule["brandProfilesTable"];
let doughRecipesTable: DbModule["doughRecipesTable"];
let sauceRecipesTable: DbModule["sauceRecipesTable"];
let savedSpecSheetsTable: DbModule["savedSpecSheetsTable"];
let dailySyncTable: DbModule["dailySyncTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_aicorrections_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  aiCorrectionsTable = dbMod.aiCorrectionsTable;
  facilityKnowledgeTable = dbMod.facilityKnowledgeTable;
  aiConversationTurnsTable = dbMod.aiConversationTurnsTable;
  mergeAliasesTable = dbMod.mergeAliasesTable;
  importAliasesTable = dbMod.importAliasesTable;
  specImportAliasesTable = dbMod.specImportAliasesTable;
  dataHealthRepairBatchesTable = dbMod.dataHealthRepairBatchesTable;
  auditLogsTable = dbMod.auditLogsTable;
  ingredientsTable = dbMod.ingredientsTable;
  brandProfilesTable = dbMod.brandProfilesTable;
  doughRecipesTable = dbMod.doughRecipesTable;
  sauceRecipesTable = dbMod.sauceRecipesTable;
  savedSpecSheetsTable = dbMod.savedSpecSheetsTable;
  dailySyncTable = dbMod.dailySyncTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  pool.on("error", () => {});

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerMod.default);

  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${aiCorrectionsTable}, ${facilityKnowledgeTable}, ${aiConversationTurnsTable}, ${mergeAliasesTable}, ${importAliasesTable}, ${specImportAliasesTable}, ${dataHealthRepairBatchesTable}, ${auditLogsTable}, ${ingredientsTable}, ${brandProfilesTable}, ${doughRecipesTable}, ${sauceRecipesTable}, ${savedSpecSheetsTable}, ${dailySyncTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
});

let nextUser = 0;
async function freshManager(): Promise<string> {
  const id = `manager-${nextUser++}-${Math.floor(Math.random() * 1e6)}`;
  await db.insert(usersTable).values({ id, username: id, passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: id, role: "manager" });
  clearUserValidityCache();
  return id;
}

async function freshOperator(): Promise<string> {
  const id = `operator-${nextUser++}-${Math.floor(Math.random() * 1e6)}`;
  await db.insert(usersTable).values({ id, username: id, passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: id, role: "operator" });
  clearUserValidityCache();
  return id;
}

async function post(userId: string, corrections: unknown[]): Promise<Response> {
  return fetch(`${baseUrl}/api/ai-corrections`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${signToken(userId)}`,
    },
    body: JSON.stringify({ corrections }),
  });
}

async function del(userId: string, id: number): Promise<Response> {
  return fetch(`${baseUrl}/api/ai-corrections/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${signToken(userId)}` },
  });
}

async function listCorrections(userId: string): Promise<Array<{ id: number; domain: string; fromText: string; toText: string }>> {
  const res = await fetch(`${baseUrl}/api/ai-corrections`, {
    headers: { authorization: `Bearer ${signToken(userId)}` },
  });
  const body = await res.json() as { corrections: Array<{ id: number; domain: string; fromText: string; toText: string }> };
  return body.corrections;
}

describe("GET, POST, and DELETE /ai-corrections — capability gating", () => {
  it("allows any authenticated operator to read corrections", async () => {
    const operator = await freshOperator();

    const res = await fetch(`${baseUrl}/api/ai-corrections`, {
      headers: { authorization: `Bearer ${signToken(operator)}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ corrections: [] });
  });

  it("rejects an operator write and does not persist the correction", async () => {
    const operator = await freshOperator();

    const res = await post(operator, [
      { domain: "brand", fromText: "Old Brand", toText: "New Brand" },
    ]);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Missing capability: manage-staff" });
    expect(await listCorrections(operator)).toEqual([]);
  });

  it("allows a manager to write and returns the corrections payload", async () => {
    const manager = await freshManager();

    const res = await post(manager, [
      { domain: "brand", fromText: "Old Brand", toText: "New Brand" },
    ]);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      corrections: [
        {
          domain: "brand",
          fromText: "Old Brand",
          toText: "New Brand",
        },
      ],
    });
  });

  it("rejects an operator delete and leaves the correction intact", async () => {
    const manager = await freshManager();
    const operator = await freshOperator();

    const seeded = await post(manager, [
      { domain: "brand", fromText: "Old Brand", toText: "New Brand" },
    ]);
    expect(seeded.status).toBe(200);
    const [{ id }] = await listCorrections(manager);

    const res = await del(operator, id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Missing capability: manage-staff" });
    expect(await listCorrections(manager)).toMatchObject([
      {
        id,
        domain: "brand",
        fromText: "Old Brand",
        toText: "New Brand",
      },
    ]);
  });

  it("allows a manager to delete a correction and returns the remaining corrections", async () => {
    const manager = await freshManager();

    const seeded = await post(manager, [
      { domain: "brand", fromText: "Old Brand", toText: "New Brand" },
      { domain: "flavor", fromText: "Old Flavor", toText: "New Flavor" },
    ]);
    expect(seeded.status).toBe(200);
    const corrections = await listCorrections(manager);
    const deleted = corrections.find((correction) => correction.fromText === "Old Brand");
    expect(deleted).toBeDefined();

    const res = await del(manager, deleted!.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      corrections: [
        {
          domain: "flavor",
          fromText: "Old Flavor",
          toText: "New Flavor",
        },
      ],
    });
    expect(await listCorrections(manager)).toMatchObject([
      {
        domain: "flavor",
        fromText: "Old Flavor",
        toText: "New Flavor",
      },
    ]);
  });
});

describe("POST /ai-corrections — chain-forwarding (stale-memory prevention)", () => {
  it("collapses A→B + B→C into A→C when B is renamed to C", async () => {
    // Core scenario: OldName→MiddleName recorded, then MiddleName→NewName recorded.
    // Without chain-forwarding both entries would be in the pool and
    // dropConflictingCorrections would silently drop them both.
    const mgr = await freshManager();

    // Step 1: record OldName → MiddleName
    const r1 = await post(mgr, [{ domain: "ingredient", fromText: "OldName", toText: "MiddleName" }]);
    expect(r1.status).toBe(200);

    // Step 2: rename MiddleName → NewName
    const r2 = await post(mgr, [{ domain: "ingredient", fromText: "MiddleName", toText: "NewName" }]);
    expect(r2.status).toBe(200);

    const corrections = await listCorrections(mgr);
    const byFrom = Object.fromEntries(corrections.map((c) => [c.fromText, c.toText]));

    // OldName must now point directly to NewName (chain collapsed).
    expect(byFrom["OldName"]).toBe("NewName");
    // MiddleName → NewName also survives (it is itself a valid correction).
    expect(byFrom["MiddleName"]).toBe("NewName");

    // No entry has toText == some other entry's fromText in the same domain
    // (which is the exact condition that triggers dropConflictingCorrections).
    const froms = new Set(corrections.map((c) => c.fromText.toLowerCase()));
    const tos   = new Set(corrections.map((c) => c.toText.toLowerCase()));
    const conflicts = corrections.filter(
      (c) => froms.has(c.toText.toLowerCase()) || tos.has(c.fromText.toLowerCase()),
    );
    expect(conflicts).toHaveLength(0);
  });

  it("handles a three-hop chain: A→B, B→C, C→D all collapse to the terminal", async () => {
    const mgr = await freshManager();

    await post(mgr, [{ domain: "brand", fromText: "A", toText: "B" }]);
    await post(mgr, [{ domain: "brand", fromText: "B", toText: "C" }]);
    await post(mgr, [{ domain: "brand", fromText: "C", toText: "D" }]);

    const corrections = await listCorrections(mgr);
    const byFrom = Object.fromEntries(corrections.map((c) => [c.fromText, c.toText]));

    expect(byFrom["A"]).toBe("D");
    expect(byFrom["B"]).toBe("D");
    expect(byFrom["C"]).toBe("D");

    // No cross-side conflicts remain.
    const froms = new Set(corrections.map((c) => c.fromText.toLowerCase()));
    const tos   = new Set(corrections.map((c) => c.toText.toLowerCase()));
    const conflicts = corrections.filter(
      (c) => froms.has(c.toText.toLowerCase()) || tos.has(c.fromText.toLowerCase()),
    );
    expect(conflicts).toHaveLength(0);
  });

  it("removes a predecessor that would become a self-mapping after forwarding (cycle collapse)", async () => {
    // A→B exists. Writing B→A would normally create A→B + B→A (a cycle).
    // The write should remove A→B (forwarding would turn it into A→A, a self-map).
    const mgr = await freshManager();

    await post(mgr, [{ domain: "flavor", fromText: "Alpha", toText: "Beta" }]);
    await post(mgr, [{ domain: "flavor", fromText: "Beta", toText: "Alpha" }]);

    const corrections = await listCorrections(mgr);
    // Alpha→Beta must have been deleted (forwarding Alpha→Beta with Beta→Alpha
    // would produce Alpha→Alpha, a self-map — so it is deleted).
    const alphaToBeta = corrections.find((c) => c.fromText === "Alpha" && c.toText === "Beta");
    expect(alphaToBeta).toBeUndefined();

    // Beta→Alpha is the surviving correction (the most recent write wins).
    const betaToAlpha = corrections.find((c) => c.fromText === "Beta" && c.toText === "Alpha");
    expect(betaToAlpha).toBeDefined();
  });

  it("does NOT collapse chains across different domains", async () => {
    // A→B in 'ingredient' and B→C in 'brand' are independent — no forwarding.
    const mgr = await freshManager();

    await post(mgr, [{ domain: "ingredient", fromText: "A", toText: "B" }]);
    await post(mgr, [{ domain: "brand",      fromText: "B", toText: "C" }]);

    const corrections = await listCorrections(mgr);
    const ingredient = corrections.find((c) => c.domain === "ingredient");
    expect(ingredient?.fromText).toBe("A");
    expect(ingredient?.toText).toBe("B"); // unchanged; different domain

    const brand = corrections.find((c) => c.domain === "brand");
    expect(brand?.fromText).toBe("B");
    expect(brand?.toText).toBe("C");
  });

  it("is case-insensitive when detecting chain predecessors", async () => {
    const mgr = await freshManager();

    // Predecessor uses different casing.
    await post(mgr, [{ domain: "recipe", fromText: "oldrecipe", toText: "MidRecipe" }]);
    await post(mgr, [{ domain: "recipe", fromText: "midrecipe", toText: "NewRecipe" }]);

    const corrections = await db.select().from(aiCorrectionsTable);
    const byFrom = Object.fromEntries(
      corrections.map((c) => [c.fromText.toLowerCase(), c.toText]),
    );
    expect(byFrom["oldrecipe"]).toBe("NewRecipe");
    expect(byFrom["midrecipe"]).toBe("NewRecipe");
  });
});

describe("AI memory health check", () => {
  it("is manager-only and its preview does not mutate corrections, facility facts, or conversations", async () => {
    const manager = await freshManager();
    const operator = await freshOperator();
    await db.insert(aiCorrectionsTable).values([
      { scope: "live", domain: "brand", fromText: "Old Mozz", toText: "Middle Mozz" },
      { scope: "live", domain: "brand", fromText: "Middle Mozz", toText: "Whole Mozz" },
    ]);
    await db.insert(facilityKnowledgeTable).values({
      scope: "live",
      domain: "general",
      key: "old-mozz-note",
      fact: "Old Mozz is preferred on the line.",
      source: "retired-tool",
    });
    await db.insert(aiConversationTurnsTable).values({
      userId: manager,
      role: "user",
      content: "Do not include this private conversation in the audit.",
    });
    await db.insert(importAliasesTable).values({
      scope: "live",
      type: "brand",
      externalName: "Old Mozz",
      canonicalName: "Whole Mozz",
    });
    await db.insert(ingredientsTable).values({
      id: "whole-mozz",
      scope: "live",
      name: "Whole Mozz",
      categories: ["cheese"],
      enabled: true,
    });

    const denied = await fetch(`${baseUrl}/api/ai-memory/health-check`, {
      headers: { authorization: `Bearer ${signToken(operator)}` },
    });
    expect(denied.status).toBe(403);

    const beforeCorrections = await db.select().from(aiCorrectionsTable);
    const beforeKnowledge = await db.select().from(facilityKnowledgeTable);
    const beforeTurns = await db.select().from(aiConversationTurnsTable);
    const res = await fetch(`${baseUrl}/api/ai-memory/health-check`, {
      headers: { authorization: `Bearer ${signToken(manager)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      report: {
        conversationHistoryExcluded: boolean;
        correctionFindings: Array<{ status: string }>;
        facilityKnowledgeFindings: Array<{ status: string }>;
        safeRepairs: unknown[];
      };
    };
    expect(body.report.conversationHistoryExcluded).toBe(true);
    expect(body.report.correctionFindings.map((finding) => finding.status)).toContain("outdated-target");
    expect(body.report.facilityKnowledgeFindings[0]?.status).toBe("superseded-name-reference");
    expect(body.report.safeRepairs.length).toBeGreaterThan(0);
    expect(await db.select().from(aiCorrectionsTable)).toEqual(beforeCorrections);
    expect(await db.select().from(facilityKnowledgeTable)).toEqual(beforeKnowledge);
    expect(await db.select().from(aiConversationTurnsTable)).toEqual(beforeTurns);
  });

  it("applies only the current deterministic correction plan atomically", async () => {
    const manager = await freshManager();
    const operator = await freshOperator();
    await db.insert(aiCorrectionsTable).values([
      { scope: "live", domain: "ingredient", fromText: "Legacy Mozz", toText: "Old Target" },
      { scope: "live", domain: "ingredient", fromText: "Duplicate", toText: "Whole Mozz" },
      { scope: "live", domain: "ingredient", fromText: "Duplicate", toText: "Whole Mozz" },
    ]);
    await db.insert(facilityKnowledgeTable).values({
      scope: "live",
      domain: "general",
      key: "keep-me",
      fact: "A natural-language facility fact must remain untouched.",
      source: "retired-tool",
    });
    await db.insert(mergeAliasesTable).values({
      scope: "live",
      category: "ingredient",
      externalName: "Legacy Mozz",
      canonicalName: "Whole Mozz",
    });
    await db.insert(ingredientsTable).values({
      id: "whole-mozz",
      scope: "live",
      name: "Whole Mozz",
      categories: ["cheese"],
      enabled: true,
    });

    const denied = await fetch(`${baseUrl}/api/ai-memory/health-check/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${signToken(operator)}` },
    });
    expect(denied.status).toBe(403);

    const res = await fetch(`${baseUrl}/api/ai-memory/health-check/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${signToken(manager)}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      summary: { deleted: number; retargeted: number };
      before: { safeRepairs: unknown[] };
      after: { safeRepairs: unknown[] };
    };
    expect(body.before.safeRepairs).toHaveLength(2);
    expect(body.summary).toEqual({ deleted: 1, retargeted: 1 });
    expect(body.after.safeRepairs).toHaveLength(0);

    const corrections = await db.select().from(aiCorrectionsTable);
    expect(corrections).toHaveLength(2);
    expect(corrections.find((row) => row.fromText === "Legacy Mozz")?.toText).toBe("Whole Mozz");
    expect(await db.select().from(facilityKnowledgeTable)).toHaveLength(1);
  });
});

describe("profile data health check", () => {
  it("is manager-only, reports without mutation, safely repairs exact links, and preserves started run snapshots", async () => {
    const manager = await freshManager();
    const operator = await freshOperator();
    await db.insert(sauceRecipesTable).values({
      id: "red-hot",
      scope: "live",
      name: "Red Hot Pizza Sauce",
      components: [{ ingredient: "Garlic Sauce", lbs: 200 }],
    });
    await db.insert(savedSpecSheetsTable).values({
      scope: "live",
      label: "authoritative setup",
      data: { profiles: [{ brand: "Corner Booth", flavor: "pepperoni", sauceName: "Red Hot Pizza Sauce" }] },
    });
    await db.insert(brandProfilesTable).values({
      key: "corner booth__pepperoni",
      scope: "live",
      brand: "Corner Booth",
      flavor: "pepperoni",
      values: { frontlineRecipeName: "Mystic Pizza Sauce", frontlineRecipe: [] },
      updatedAtMs: 100,
    });
    await db.insert(dailySyncTable).values({
      scope: "live",
      date: "2099-01-01",
      data: {
        dayState: { runs: [
          { id: "future", brand: "Corner Booth", flavor: "pepperoni" },
          { id: "future-changed", brand: "Corner Booth", flavor: "pepperoni" },
          { id: "started", brand: "Corner Booth", flavor: "pepperoni", startedAt: 1 },
        ] },
        runValues: {
          future: { frontlineRecipeName: "Mystic Pizza Sauce", frontlineRecipe: [] },
          "future-changed": { frontlineRecipeName: "Mystic Pizza Sauce", frontlineRecipe: [] },
          started: { frontlineRecipeName: "Mystic Pizza Sauce", frontlineRecipe: [] },
        },
        runValuesUpdatedAt: { future: 10, "future-changed": 10, started: 10 },
      },
    });

    const denied = await fetch(`${baseUrl}/api/profile-data/health-check`, {
      headers: { authorization: `Bearer ${signToken(operator)}` },
    });
    expect(denied.status).toBe(403);
    const before = await fetch(`${baseUrl}/api/profile-data/health-check`, {
      headers: { authorization: `Bearer ${signToken(manager)}` },
    });
    expect(before.status).toBe(200);
    const report = await before.json() as { report: { safeRepairs: Array<{ id: string; recipeKind: string }>; findings: Array<{ status: string }> } };
    expect(report.report.safeRepairs).toHaveLength(1);
    expect(report.report.safeRepairs[0]?.recipeKind).toBe("sauce");
    expect(report.report.findings.map((item) => item.status)).toContain("missing-recipe");
    const [beforeProfile] = await db.select().from(brandProfilesTable);
    expect((beforeProfile.values as Record<string, unknown>).frontlineRecipeName).toBe("Mystic Pizza Sauce");
    const workspaceResponse = await fetch(`${baseUrl}/api/profile-data/health-workspace`, {
      headers: { authorization: `Bearer ${signToken(manager)}` },
    });
    const workspace = await workspaceResponse.json() as {
      workspace: {
        findings: Array<{
          id: string;
          preview?: { changes?: Array<{ field: string; before: string; after: string }> };
        }>;
      };
    };
    const profilePreview = workspace.workspace.findings.find((finding) =>
      finding.id === report.report.safeRepairs[0]?.id)?.preview;
    expect(profilePreview?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "frontlineRecipeName", before: "Mystic Pizza Sauce", after: "Red Hot Pizza Sauce" }),
      expect.objectContaining({ field: "frontlineRecipe", before: "0 recipe rows", after: expect.stringContaining("Garlic Sauce") }),
    ]));

    const applied = await fetch(`${baseUrl}/api/profile-data/health-check/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signToken(manager)}`,
      },
      body: JSON.stringify({ findingIds: [report.report.safeRepairs[0]?.id] }),
    });
    expect(applied.status).toBe(200);
    const body = await applied.json() as { batchId: string; summary: { repairedProfiles: number; repairedRuns: number }; after: { safeRepairs: unknown[] } };
    expect(body.summary).toEqual({ repairedProfiles: 1, repairedRuns: 2 });
    expect(body.after.safeRepairs).toHaveLength(0);
    const [batch] = await db.select().from(dataHealthRepairBatchesTable);
    expect(batch.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        repairType: "run-values",
        runId: "future",
        beforeStamp: 10,
        afterValues: expect.objectContaining({ frontlineRecipeName: "Red Hot Pizza Sauce" }),
      }),
      expect.objectContaining({
        repairType: "run-values",
        runId: "future-changed",
      }),
    ]));

    const [profile] = await db.select().from(brandProfilesTable);
    expect(profile.values).toMatchObject({
      frontlineRecipeName: "Red Hot Pizza Sauce",
      frontlineRecipe: [{ ingredient: "Garlic Sauce", lbs: 200 }],
    });
    const [day] = await db.select().from(dailySyncTable);
    const data = day.data as Record<string, any>;
    expect(data.runValues.future).toMatchObject({ frontlineRecipeName: "Red Hot Pizza Sauce" });
    expect(data.runValues["future-changed"]).toMatchObject({ frontlineRecipeName: "Red Hot Pizza Sauce" });
    expect(data.runValues.started).toMatchObject({ frontlineRecipeName: "Mystic Pizza Sauce" });

    await db.update(dailySyncTable).set({
      data: {
        ...data,
        runValues: {
          ...data.runValues,
          "future-changed": { ...data.runValues["future-changed"], frontlineRecipeName: "Changed after apply" },
        },
        runValuesUpdatedAt: { ...data.runValuesUpdatedAt, "future-changed": 999 },
      },
    }).where(eq(dailySyncTable.date, "2099-01-01"));

    const undo = await fetch(
      `${baseUrl}/api/profile-data/health-check/batches/${encodeURIComponent(body.batchId)}/undo`,
      { method: "POST", headers: { authorization: `Bearer ${signToken(manager)}` } },
    );
    expect(undo.status).toBe(200);
    expect(await undo.json()).toMatchObject({
      summary: { applied: 1, skipped: 1, failed: 0, repairedRuns: 1 },
    });
    const [restoredProfile] = await db.select().from(brandProfilesTable);
    expect(restoredProfile.updatedAtMs).toBeGreaterThan(profile.updatedAtMs);
    expect(restoredProfile.values).toMatchObject({ frontlineRecipeName: "Mystic Pizza Sauce" });
     const [restoredDay] = await db.select().from(dailySyncTable);
     const restoredData = restoredDay.data as Record<string, any>;
     expect(restoredData.runValues.future).toMatchObject({ frontlineRecipeName: "Mystic Pizza Sauce" });
     expect(restoredData.runValues["future-changed"]).toMatchObject({ frontlineRecipeName: "Changed after apply" });
     expect(restoredData.runValues.started).toMatchObject({ frontlineRecipeName: "Mystic Pizza Sauce" });
    const repeatedUndo = await fetch(
      `${baseUrl}/api/profile-data/health-check/batches/${encodeURIComponent(body.batchId)}/undo`,
      { method: "POST", headers: { authorization: `Bearer ${signToken(manager)}` } },
    );
    expect(repeatedUndo.status).toBe(200);
    expect(await repeatedUndo.json()).toMatchObject({ alreadyUndone: true });
  });

  it("undoes legacy nested future-run snapshots with the same guards as historical batches", async () => {
    const manager = await freshManager();
    const profileKey = "legacy-brand__legacy-flavor";
    const date = "2099-02-01";
    const oldValues = { frontlineRecipeName: "Legacy Sauce" };
    const repairedValues = { frontlineRecipeName: "Corrected Sauce" };

    await db.insert(brandProfilesTable).values({
      key: profileKey,
      scope: "live",
      brand: "Legacy Brand",
      flavor: "legacy flavor",
      values: repairedValues,
      updatedAtMs: 200,
    });
    await db.insert(dailySyncTable).values({
      scope: "live",
      date,
      data: {
        dayState: {
          runs: [
            { id: "legacy-future", brand: "Legacy Brand", flavor: "legacy flavor" },
            { id: "legacy-started", brand: "Legacy Brand", flavor: "legacy flavor", startedAt: 1 },
            { id: "legacy-changed", brand: "Legacy Brand", flavor: "legacy flavor" },
          ],
        },
        runValues: {
          "legacy-future": repairedValues,
          "legacy-started": repairedValues,
          "legacy-changed": { frontlineRecipeName: "Changed after apply" },
        },
        runValuesUpdatedAt: {
          "legacy-future": 201,
          "legacy-started": 201,
          "legacy-changed": 999,
        },
      },
    });
    await db.insert(dataHealthRepairBatchesTable).values({
      id: "legacy-profile-repair",
      scope: "live",
      actor: manager,
      status: "applied",
      records: [{
        profileKey,
        recipeKind: "sauce",
        fields: ["frontlineRecipeName"],
        previousValues: oldValues,
        nextValues: repairedValues,
        afterStamp: 200,
        runs: [
          {
            date,
            runId: "legacy-future",
            fields: ["frontlineRecipeName"],
            beforeValues: oldValues,
            afterValues: repairedValues,
            beforeStamp: 20,
            afterStamp: 201,
          },
          {
            date,
            runId: "legacy-started",
            fields: ["frontlineRecipeName"],
            beforeValues: oldValues,
            afterValues: repairedValues,
            beforeStamp: 20,
            afterStamp: 201,
          },
          {
            date,
            runId: "legacy-changed",
            fields: ["frontlineRecipeName"],
            beforeValues: oldValues,
            afterValues: repairedValues,
            beforeStamp: 20,
            afterStamp: 201,
          },
        ],
      }],
      summary: { applied: 1, skipped: 0, failed: 0, repairedRuns: 3 },
    });

    const undo = await fetch(
      `${baseUrl}/api/profile-data/health-check/batches/legacy-profile-repair/undo`,
      { method: "POST", headers: { authorization: `Bearer ${signToken(manager)}` } },
    );
    expect(undo.status).toBe(200);
    expect(await undo.json()).toMatchObject({
      batchId: "legacy-profile-repair",
      summary: { applied: 1, skipped: 2, failed: 0, repairedRuns: 1 },
    });

    const [restoredProfile] = await db.select().from(brandProfilesTable);
    expect(restoredProfile.values).toMatchObject(oldValues);
    expect(restoredProfile.updatedAtMs).toBeGreaterThan(200);

    const [day] = await db.select().from(dailySyncTable);
    const data = day.data as Record<string, any>;
    expect(data.runValues["legacy-future"]).toMatchObject(oldValues);
    expect(data.runValuesUpdatedAt["legacy-future"]).toBeGreaterThan(201);
    expect(data.runValues["legacy-started"]).toMatchObject(repairedValues);
    expect(data.runValuesUpdatedAt["legacy-started"]).toBe(201);
    expect(data.runValues["legacy-changed"]).toMatchObject({ frontlineRecipeName: "Changed after apply" });
    expect(data.runValuesUpdatedAt["legacy-changed"]).toBe(999);

    const [batch] = await db.select().from(dataHealthRepairBatchesTable);
    expect(batch.status).toBe("undone");
    expect(batch.summary).toMatchObject({ applied: 1, skipped: 2, failed: 0, repairedRuns: 1 });
  });

  it("normalizes an alias finding and applies only the selected repair with guarded undo", async () => {
    const manager = await freshManager();
    await db.insert(importAliasesTable).values([
      { scope: "live", type: "brand", externalName: "Same Name", canonicalName: "Same Name" },
      { scope: "live", type: "brand", externalName: "Keep Me", canonicalName: "Canonical Brand" },
    ]);

    const workspaceResponse = await fetch(`${baseUrl}/api/profile-data/health-workspace`, {
      headers: { authorization: `Bearer ${signToken(manager)}` },
    });
    expect(workspaceResponse.status).toBe(200);
    const workspaceBody = await workspaceResponse.json() as {
      workspace: {
        findings: Array<{
          id: string;
          category: string;
          repairability: string;
          affectedRecord: string;
          preview?: { before: string; after: string };
        }>;
      };
    };
    const aliasFinding = workspaceBody.workspace.findings.find((finding) =>
      finding.category === "aliases" && finding.repairability === "safe");
    expect(aliasFinding).toMatchObject({ category: "aliases", repairability: "safe" });
    expect(aliasFinding?.affectedRecord).toContain("import:");
    expect(aliasFinding?.preview?.before).toBe("Same Name → Same Name");

    const appliedResponse = await fetch(`${baseUrl}/api/profile-data/health-check/apply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signToken(manager)}`,
      },
      body: JSON.stringify({ findingIds: [aliasFinding?.id] }),
    });
    expect(appliedResponse.status).toBe(200);
    const applied = await appliedResponse.json() as {
      batchId: string;
      outcome: { applied: number; skipped: number; failed: number };
    };
    expect(applied.outcome).toEqual(expect.objectContaining({ applied: 1, skipped: 0, failed: 0 }));
    expect((await db.select().from(importAliasesTable)).map((row) => row.externalName)).toEqual(["Keep Me"]);
    expect(await db.select().from(dataHealthRepairBatchesTable)).toHaveLength(1);
    expect((await db.select().from(auditLogsTable)).some((row) => row.action === "profile_data_health_repair")).toBe(true);

    const undoResponse = await fetch(
      `${baseUrl}/api/profile-data/health-check/batches/${encodeURIComponent(applied.batchId)}/undo`,
      { method: "POST", headers: { authorization: `Bearer ${signToken(manager)}` } },
    );
    expect(undoResponse.status).toBe(200);
    expect((await db.select().from(importAliasesTable)).map((row) => row.externalName).sort())
      .toEqual(["Keep Me", "Same Name"]);
  });

  it("keeps legacy master profile-link findings review-only and counts unsupported selections as skipped", async () => {
    const manager = await freshManager();
    await db.insert(doughRecipesTable).values({
      id: "crb-safe-dough",
      scope: "live",
      name: "CRB Dough",
      components: [{ ingredient: "Flour", lbs: 1 }],
      enabled: true,
    });
    await db.insert(brandProfilesTable).values({
      key: "basha-five-cheese-health",
      scope: "live",
      brand: "Basha's Ultra Thin Crust",
      flavor: "5 Cheese",
      values: { doughRecipeName: '11" CRB Recipe', doughRecipe: [] },
      updatedAtMs: Date.now(),
    });

    const workspaceResponse = await fetch(`${baseUrl}/api/profile-data/health-workspace`, {
      headers: { authorization: `Bearer ${signToken(manager)}` },
    });
    expect(workspaceResponse.status).toBe(200);
    const body = await workspaceResponse.json() as {
      workspace: {
        findings: Array<{
          id: string;
          source: string;
          repairability: string;
          sourceRoute: string;
          preview?: { before: string; after: string };
        }>;
        safeRepairs: Array<{ findingId?: string }>;
      };
    };
    const finding = body.workspace.findings.find((item) =>
      item.source === "master-data" && item.id.includes("basha") && item.id.includes("doughRecipeName"));
    expect(finding).toMatchObject({
      repairability: "review",
      sourceRoute: "setupProfiles",
      preview: { before: '11" CRB Recipe', after: "CRB Dough" },
    });
    expect(body.workspace.safeRepairs.some((repair) => repair.findingId === finding?.id)).toBe(false);

    const apply = await fetch(`${baseUrl}/api/profile-data/health-check/apply`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${signToken(manager)}` },
      body: JSON.stringify({ findingIds: [finding?.id] }),
    });
    expect(apply.status).toBe(200);
    expect(await apply.json()).toMatchObject({
      batchId: null,
      outcome: { applied: 0, skipped: 1, failed: 0, repairedRuns: 0 },
    });
  });
});
