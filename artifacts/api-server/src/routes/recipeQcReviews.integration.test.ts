import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
let db: typeof import("@workspace/db").db;
let pool: typeof import("@workspace/db").pool;
let adminPool: pg.Pool;
let dbName: string;
let originalUrl: string | undefined;
let server: Server;
let baseUrl: string;
let tables: typeof import("@workspace/db");
let seedRoles: () => Promise<void>;
let recordSession: typeof import("../lib/authSessions")["recordSession"];
let signLegacyTokenForTests: typeof import("../lib/auth")["signLegacyTokenForTests"];
let setImportOperationFailureHookForTest: typeof import("./importOperations")["setImportOperationFailureHookForTest"];
const tokens = new Map<string, string>();

beforeAll(async () => {
  originalUrl = process.env.DATABASE_URL;
  if (!originalUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  adminPool = new pg.Pool({ connectionString: originalUrl });
  dbName = `helium_recipe_qc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${dbName}"`);
  const testUrl = new URL(originalUrl);
  testUrl.pathname = `/${dbName}`;
  const pushed = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    encoding: "utf8",
  });
  if (pushed.status !== 0) throw new Error(`${pushed.stdout}\n${pushed.stderr}`);
  process.env.DATABASE_URL = testUrl.toString();
  ({ signLegacyTokenForTests } = await import("../lib/auth"));
  ({ recordSession } = await import("../lib/authSessions"));
  tables = await import("@workspace/db");
  db = tables.db;
  pool = tables.pool;
  seedRoles = (await import("../lib/roles")).seedRoles;
  ({ setImportOperationFailureHookForTest } = await import("./importOperations"));

  const { requireAuth } = await import("../middlewares/requireAuth");
  const [
    doughRoute,
    sauceRoute,
    cheeseRoute,
    mixesRoute,
    importOperationsRoute,
    recipeQcReviewsRoute,
    qcWorkflowsRoute,
  ] = await Promise.all([
    import("./doughRecipes"),
    import("./sauceRecipes"),
    import("./cheeseRecipes"),
    import("./mixes"),
    import("./importOperations"),
    import("./recipeQcReviews"),
    import("./qcWorkflows"),
  ]);
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", requireAuth, doughRoute.default, sauceRoute.default,
    cheeseRoute.default, mixesRoute.default, importOperationsRoute.default,
    recipeQcReviewsRoute.default, qcWorkflowsRoute.default);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  setImportOperationFailureHookForTest?.();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool?.end();
  if (adminPool) await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await adminPool?.end();
  process.env.DATABASE_URL = originalUrl;
}, 120_000);

beforeEach(async () => {
  setImportOperationFailureHookForTest();
  await db.execute(sql`
    TRUNCATE ${tables.qcWorkflowEventsTable}, ${tables.doughRecipesTable},
      ${tables.sauceRecipesTable}, ${tables.cheeseRecipesTable}, ${tables.mixesTable},
      ${tables.importOperationsTable}, ${tables.importHistoryTable}, ${tables.auditLogsTable},
      ${tables.authSessionsTable}, ${tables.userRolesTable}, ${tables.usersTable}
    RESTART IDENTITY CASCADE
  `);
  await seedRoles();
  await db.insert(tables.usersTable).values([
    { id: "recipe-editor", username: "recipe-editor", passwordHash: "x" },
    { id: "recipe-editor-sandbox", username: "recipe-editor-sandbox", passwordHash: "x", sandbox: true },
    { id: "qc-manager", username: "qc-manager", passwordHash: "x" },
    { id: "qc-reader", username: "qc-reader", passwordHash: "x" },
    { id: "qc-sandbox", username: "qc-sandbox", passwordHash: "x", sandbox: true },
    { id: "plain-operator", username: "plain-operator", passwordHash: "x" },
  ]);
  await db.insert(tables.userRolesTable).values([
    { userId: "recipe-editor", role: "manager" },
    { userId: "recipe-editor-sandbox", role: "manager" },
    { userId: "qc-manager", role: "qc-manager" },
    { userId: "qc-reader", role: "qc-operator" },
    { userId: "qc-sandbox", role: "qc-manager" },
    { userId: "plain-operator", role: "operator" },
  ]);
  tokens.clear();
  for (const id of [
    "recipe-editor", "recipe-editor-sandbox", "qc-manager",
    "qc-reader", "qc-sandbox", "plain-operator",
  ]) {
    const token = signLegacyTokenForTests(id);
    tokens.set(id, token);
    await recordSession(id, token);
  }
});

function headers(user = "recipe-editor") {
  const token = tokens.get(user);
  if (!token) throw new Error(`No test session established for ${user}`);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function request(
  pathName: string,
  user: string,
  options: { method?: string; body?: unknown } = {},
) {
  return fetch(`${baseUrl}/api${pathName}`, {
    method: options.method ?? "GET",
    headers: headers(user),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

const makeRecipe = {
  dough: (name: string, updatedAt?: string) => ({
    id: "dough-shared", name, notes: "Synthetic dough", components: [],
    enabled: true, brand: "", flavors: [], ...(updatedAt ? { updatedAt } : {}),
  }),
  sauce: (name: string, updatedAt?: string) => ({
    id: "sauce-shared", name, notes: "Synthetic sauce", components: [],
    enabled: true, brand: "", flavors: [], ...(updatedAt ? { updatedAt } : {}),
  }),
  cheese: (name: string, updatedAt?: string) => ({
    id: "cheese-shared", name, brand: "", flavors: [], shredderSetting: "",
    cellulose: "", notes: "Synthetic cheese", components: [], enabled: true,
    ...(updatedAt ? { updatedAt } : {}),
  }),
  mix: (name: string, updatedAt?: string) => ({
    id: "mix-shared", name, brand: "", flavor: "Synthetic", batchSize: 2,
    daysEarly: 0, notes: "Synthetic mix", amountAlreadyMade: 0, components: [],
    isPrep: false, enabled: true, ...(updatedAt ? { updatedAt } : {}),
  }),
} as const;

const routeFor = {
  dough: "/dough-recipes",
  sauce: "/sauce-recipes",
  cheese: "/cheese-recipes",
  mix: "/mixes",
} as const;

async function saveRecipe(
  family: keyof typeof routeFor,
  recipe: Record<string, unknown>,
  user = "recipe-editor",
) {
  const response = await request(routeFor[family], user, {
    method: "POST",
    body: { items: [recipe] },
  });
  const body = await response.json() as {
    items?: Array<Record<string, unknown>>;
    recipeQcReview?: { status: string; changedCount: number };
  };
  return { response, body };
}

async function recipeDetail(captureId: number, user = "qc-manager") {
  const response = await request(`/qc/recipe-reviews/${captureId}`, user);
  return { response, body: await response.json() as any };
}

function decisionFor(detail: any, decisionId: string, status = "verified") {
  return {
    decisionId,
    status,
    expectedResultHash: detail.resultHash,
    expectedRevision: detail.decisionRevision,
    reason: "Synthetic committed recipe revision review",
  };
}

describe("shared recipe QC review", () => {
  it("captures all four direct recipe saves and exposes only status to record-qc staff", async () => {
    const families = ["dough", "sauce", "cheese", "mix"] as const;
    for (const family of families) {
      const { response, body } = await saveRecipe(family, makeRecipe[family](`Synthetic ${family}`));
      expect(response.status, `${family} save`).toBe(200);
      expect(body.recipeQcReview).toEqual({ status: "applied-awaiting-review", changedCount: 1 });
    }
    const captures = await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed"));
    expect(captures).toHaveLength(4);
    expect(captures.every((event) => event.scope === "live" && event.runId === null)).toBe(true);
    expect(captures.map((event) => event.actorId)).toEqual(Array(4).fill("recipe-editor"));
    expect(captures.every((event) => event.payload.changedFields && event.payload.resultHash)).toBe(true);
    const [mix] = await db.select().from(tables.mixesTable)
      .where(eq(tables.mixesTable.id, "mix-shared"));
    const stockOnly = await saveRecipe("mix", {
      ...makeRecipe.mix("Synthetic mix", mix!.updatedAt.toISOString()),
      amountAlreadyMade: 3,
    });
    expect(stockOnly.response.status).toBe(200);
    expect(stockOnly.body.recipeQcReview).toBeUndefined();
    expect(await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed"))).toHaveLength(4);

    const statusResponse = await request("/qc/recipe-review-statuses", "qc-reader");
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get("cache-control")).toBe("no-store");
    const status = await statusResponse.json() as { items: Array<Record<string, unknown>> };
    expect(status.items).toHaveLength(4);
    expect(status.items.every((item) => item.status === "pending")).toBe(true);
    expect(Object.keys(status.items[0]!).sort()).toEqual(["recipeId", "recipeName", "recipeType", "status"]);

    const managerQueue = await request("/qc/recipe-reviews?status=all", "qc-manager");
    expect(managerQueue.status).toBe(200);
    expect((await managerQueue.json() as { items: unknown[] }).items).toHaveLength(4);
    for (const url of [
      "/qc/recipe-reviews",
      `/qc/recipe-reviews/${captures[0]!.id}`,
    ]) {
      expect((await request(url, "qc-reader")).status).toBe(403);
      expect((await request(url, "plain-operator")).status).toBe(403);
    }
    expect((await saveRecipe("dough", makeRecipe.dough("No new QC edit"), "qc-manager")).response.status).toBe(403);
  });

  it("appends exact, retryable decisions; conflicts stale review; and never changes the applied recipe", async () => {
    const created = await saveRecipe("dough", makeRecipe.dough("Synthetic dough"));
    const capture = (await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed")))[0]!;
    const before = await recipeDetail(capture.id);
    expect(before.body.status).toBe("pending");
    const verify = decisionFor(before.body, "recipe-review-verify-retry-0001");
    const verifiedResponse = await request(`/qc/recipe-reviews/${capture.id}/decisions`, "qc-manager", {
      method: "POST",
      body: verify,
    });
    expect(verifiedResponse.status).toBe(201);
    const receipt = await verifiedResponse.json() as Record<string, unknown>;
    const replay = await request(`/qc/recipe-reviews/${capture.id}/decisions`, "qc-manager", {
      method: "POST",
      body: verify,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json() as Record<string, unknown>).toMatchObject({ ...receipt, replayed: true });

    const updatedAt = String(created.body.items?.[0]?.updatedAt);
    const update = await saveRecipe("dough", makeRecipe.dough("Synthetic dough v2", updatedAt));
    expect(update.response.status).toBe(200);
    expect(update.body.recipeQcReview).toEqual({ status: "applied-awaiting-review", changedCount: 1 });
    const oldDetail = await recipeDetail(capture.id);
    expect(oldDetail.body.status).toBe("superseded");
    const newCapture = (await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed"))
      .orderBy(tables.qcWorkflowEventsTable.id))[1]!;
    const currentDetail = await recipeDetail(newCapture.id);
    expect(currentDetail.body).toMatchObject({ status: "pending", recipeName: "Synthetic dough v2" });

    const stale = await request(`/qc/recipe-reviews/${capture.id}/decisions`, "qc-manager", {
      method: "POST",
      body: { ...decisionFor(oldDetail.body, "recipe-review-stale-revision-0001", "rejected"), expectedRevision: 0 },
    });
    expect(stale.status).toBe(409);

    const rejection = await request(`/qc/recipe-reviews/${newCapture.id}/decisions`, "qc-manager", {
      method: "POST",
      body: decisionFor(currentDetail.body, "recipe-review-reject-new-0001", "rejected"),
    });
    expect(rejection.status).toBe(201);
    expect((await recipeDetail(newCapture.id)).body.status).toBe("rejected");
    const persisted = await request("/dough-recipes", "recipe-editor");
    expect((await persisted.json() as { items: Array<{ name: string }> }).items[0]!.name).toBe("Synthetic dough v2");
    expect(created.response.status).toBe(200);
  });

  it("does not transfer approval between same-name identities when a merge source is removed", async () => {
    const source = await saveRecipe("dough", {
      ...makeRecipe.dough("Synthetic same-name dough"),
      id: "dough-merge-source",
    });
    const sourceCapture = (await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.recordId, "dough:dough-merge-source")))[0]!;
    const target = await saveRecipe("dough", {
      ...makeRecipe.dough("Synthetic same-name dough"),
      id: "dough-merge-target",
    });
    const targetCapture = (await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.recordId, "dough:dough-merge-target")))[0]!;
    expect(source.response.status).toBe(200);
    expect(target.response.status).toBe(200);
    expect(sourceCapture.id).not.toBe(targetCapture.id);

    const sourceDetail = await recipeDetail(sourceCapture.id);
    const verification = await request(
      `/qc/recipe-reviews/${sourceCapture.id}/decisions`,
      "qc-manager",
      {
        method: "POST",
        body: decisionFor(sourceDetail.body, "recipe-review-merge-source-verify-01"),
      },
    );
    expect(verification.status).toBe(201);

    const removedSource = await request("/dough-recipes", "recipe-editor", {
      method: "DELETE",
      body: { ids: ["dough-merge-source"] },
    });
    expect(removedSource.status).toBe(200);
    expect((await recipeDetail(sourceCapture.id)).body).toMatchObject({
      status: "deleted",
      sourceState: "deleted",
      currentName: null,
    });
    expect((await recipeDetail(targetCapture.id)).body).toMatchObject({
      recipeId: "dough-merge-target",
      recipeName: "Synthetic same-name dough",
      status: "pending",
      sourceState: "active",
    });
  });

  it("retains renamed and deleted identities, applies facility-scoped identities, and honors summary redactions", async () => {
    const first = await saveRecipe("cheese", makeRecipe.cheese("Synthetic cheese"));
    const firstCapture = (await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed")))[0]!;
    const renamed = await saveRecipe(
      "cheese",
      makeRecipe.cheese("Synthetic cheese renamed", String(first.body.items?.[0]?.updatedAt)),
    );
    expect(renamed.response.status).toBe(200);
    const old = await recipeDetail(firstCapture.id);
    expect(old.body).toMatchObject({
      status: "superseded",
      sourceState: "renamed",
      currentName: "Synthetic cheese renamed",
    });
    const latestCapture = (await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed"))
      .orderBy(tables.qcWorkflowEventsTable.id))[1]!;

    const redaction = await request(`/qc/events/${latestCapture.id}/redactions`, "qc-manager", {
      method: "POST",
      body: {
        operationId: "b6a08d53-f7d4-402f-a11c-3ba469e3f231",
        reason: "Synthetic privacy review",
        fields: ["payload.summary", "actorId"],
      },
    });
    expect(redaction.status).toBe(201);
    const redacted = await recipeDetail(latestCapture.id);
    expect(redacted.body.summary).toEqual({ redacted: true });
    expect(redacted.body.actorId).toBe("[redacted]");

    const deleted = await request("/cheese-recipes", "recipe-editor", {
      method: "DELETE",
      body: { ids: ["cheese-shared"] },
    });
    expect(deleted.status).toBe(200);
    const deletedDetail = await recipeDetail(latestCapture.id);
    expect(deletedDetail.body).toMatchObject({ status: "deleted", sourceState: "deleted", currentName: null });
    const decision = await request(`/qc/recipe-reviews/${latestCapture.id}/decisions`, "qc-manager", {
      method: "POST",
      body: decisionFor(deletedDetail.body, "recipe-review-deleted-0000001"),
    });
    expect(decision.status).toBe(409);

    const sandboxSave = await saveRecipe("mix", makeRecipe.mix("Synthetic sandbox mix"), "recipe-editor-sandbox");
    expect(sandboxSave.response.status).toBe(200);
    const sandboxStatus = await request("/qc/recipe-review-statuses", "qc-sandbox");
    expect((await sandboxStatus.json() as { items: unknown[] }).items).toHaveLength(1);
    const liveStatus = await request("/qc/recipe-review-statuses", "qc-reader");
    expect((await liveStatus.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it("captures imported recipe batches atomically and leaves no evidence on rollback", async () => {
    const body = {
      importType: "spec",
      sourceLabel: "Synthetic reviewed source",
      changes: {
        doughRecipes: { upsert: [makeRecipe.dough("Imported dough")] },
        sauceRecipes: { upsert: [makeRecipe.sauce("Imported sauce")] },
        cheeseRecipes: { upsert: [makeRecipe.cheese("Imported cheese")] },
        mixes: { upsert: [makeRecipe.mix("Imported mix")] },
      },
    };
    const applied = await request("/import-operations/spec-recipe-review-0001/apply", "recipe-editor", {
      method: "POST",
      body,
    });
    expect(applied.status).toBe(200);
    const receipt = await applied.json() as {
      operation: { result: { recipeQcReview: { status: string; changedCount: number } } };
    };
    expect(receipt.operation.result.recipeQcReview).toEqual({
      status: "applied-awaiting-review",
      changedCount: 4,
    });
    expect(await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed"))).toHaveLength(4);

    setImportOperationFailureHookForTest((stage) => {
      if (stage === "after-recipe-qc-capture") throw new Error("Synthetic atomicity failure");
    });
    const failed = await request("/import-operations/spec-recipe-review-rollback-0001/apply", "recipe-editor", {
      method: "POST",
      body: {
        ...body,
        changes: { mixes: { upsert: [makeRecipe.mix("Rolled back mix")] } },
      },
    });
    expect(failed.status).toBe(500);
    setImportOperationFailureHookForTest();
    expect(await db.select().from(tables.mixesTable)
      .where(eq(tables.mixesTable.id, "mix-shared"))).toHaveLength(1);
    expect(await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed"))).toHaveLength(4);
    expect(await db.select().from(tables.importOperationsTable)
      .where(eq(tables.importOperationsTable.id, "spec-recipe-review-rollback-0001"))).toHaveLength(0);
    const retry = await request("/import-operations/spec-recipe-review-0001/apply", "recipe-editor", {
      method: "POST",
      body,
    });
    expect(retry.status).toBe(200);
    expect((await retry.json() as typeof receipt).operation.result.recipeQcReview.changedCount).toBe(4);
    expect(await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.eventType, "recipe-committed"))).toHaveLength(4);
  });
});
