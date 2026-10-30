import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import express from "express";
import pg from "pg";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SPEC_IMPORT_PARSE_VERSION } from "@workspace/spec-import";
import { goldSourceDigest } from "../lib/importGoldApproval";

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
let importHistoryRoute: typeof import("./importHistory");
let enhancedErrorMessages: typeof import("../middlewares/errorMessagesEnhanced")["enhancedErrorMessages"];
let seedRoles: () => Promise<void>;
let recordSession: typeof import("../lib/authSessions")["recordSession"];
let signLegacyTokenForTests: typeof import("../lib/auth")["signLegacyTokenForTests"];
let observabilityMiddleware: typeof import("../lib/observability")["observabilityMiddleware"];
const originalGoldEnabled = process.env.IMPORT_GOLD_ENABLED;
const originalGoldCleanupEnabled = process.env.IMPORT_GOLD_CLEANUP_ENABLED;
const originalGoldSourceApproved = process.env.IMPORT_GOLD_SOURCE_USE_APPROVED;
const originalGoldRetentionApproved = process.env.IMPORT_GOLD_RETENTION_APPROVED;
const originalGoldApprovalRecordRef = process.env.IMPORT_GOLD_APPROVAL_RECORD_REF;
const originalGoldPrivacyReviewStatus = process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS;
const originalGoldLocalEnabled = process.env.IMPORT_GOLD_LOCAL_ENABLED;
const originalGoldLocalBaseUrl = process.env.IMPORT_GOLD_LOCAL_BASE_URL;
const sessionTokens = new Map<string, string>();
type PreviewBody = {
  expectedStateHash: string;
  before: Record<string, Record<string, unknown>[]>;
  after: Record<string, Record<string, unknown>[]>;
  baseline: { status: string; operationId?: string; before: Record<string, Record<string, unknown>[]> };
};
type ReceiptBody = {
  import: { summary: { appliedValues?: Record<string, Record<string, unknown>[]> } };
  imports: Array<{ summary: { appliedValues?: Record<string, Record<string, unknown>[]> } }>;
};

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
  ({ observabilityMiddleware } = await import("../lib/observability"));
  ({ enhancedErrorMessages } = await import("../middlewares/errorMessagesEnhanced"));
  tables = await import("@workspace/db");
  db = tables.db; pool = tables.pool;
  route = await import("./importOperations");
  importHistoryRoute = await import("./importHistory");
  const importQcRoute = await import("./importQcReviews");
  const qcWorkflowRoute = await import("./qcWorkflows");
  seedRoles = (await import("../lib/roles")).seedRoles;
  const { requireAuth } = await import("../middlewares/requireAuth");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => { (req as any).log = { info() {}, warn() {}, error() {}, debug() {} }; next(); });
  app.use(observabilityMiddleware);
  app.use("/api", requireAuth, route.default, importHistoryRoute.default, importQcRoute.default, qcWorkflowRoute.default);
  // Match app.ts's terminal production error middleware so route failures in this
  // integration harness exercise the same JSON response contract as production.
  app.use(enhancedErrorMessages);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  route?.setImportOperationFailureHookForTest();
  route?.setImportGoldProviderForTest();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool?.end();
  if (adminPool) await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await adminPool?.end();
  process.env.DATABASE_URL = originalUrl;
  if (originalGoldEnabled === undefined) delete process.env.IMPORT_GOLD_ENABLED;
  else process.env.IMPORT_GOLD_ENABLED = originalGoldEnabled;
  if (originalGoldCleanupEnabled === undefined) delete process.env.IMPORT_GOLD_CLEANUP_ENABLED;
  else process.env.IMPORT_GOLD_CLEANUP_ENABLED = originalGoldCleanupEnabled;
  if (originalGoldSourceApproved === undefined) delete process.env.IMPORT_GOLD_SOURCE_USE_APPROVED;
  else process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = originalGoldSourceApproved;
  if (originalGoldRetentionApproved === undefined) delete process.env.IMPORT_GOLD_RETENTION_APPROVED;
  else process.env.IMPORT_GOLD_RETENTION_APPROVED = originalGoldRetentionApproved;
  if (originalGoldApprovalRecordRef === undefined) delete process.env.IMPORT_GOLD_APPROVAL_RECORD_REF;
  else process.env.IMPORT_GOLD_APPROVAL_RECORD_REF = originalGoldApprovalRecordRef;
  if (originalGoldPrivacyReviewStatus === undefined) delete process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS;
  else process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS = originalGoldPrivacyReviewStatus;
  if (originalGoldLocalEnabled === undefined) delete process.env.IMPORT_GOLD_LOCAL_ENABLED;
  else process.env.IMPORT_GOLD_LOCAL_ENABLED = originalGoldLocalEnabled;
  if (originalGoldLocalBaseUrl === undefined) delete process.env.IMPORT_GOLD_LOCAL_BASE_URL;
  else process.env.IMPORT_GOLD_LOCAL_BASE_URL = originalGoldLocalBaseUrl;
}, 120_000);

beforeEach(async () => {
  route?.setImportOperationFailureHookForTest();
  process.env.IMPORT_GOLD_ENABLED = "true";
  delete process.env.IMPORT_GOLD_CLEANUP_ENABLED;
  process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = "true";
  process.env.IMPORT_GOLD_RETENTION_APPROVED = "true";
  process.env.IMPORT_GOLD_APPROVAL_RECORD_REF = "synthetic-approval";
  process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS = "not_required";
  delete process.env.IMPORT_GOLD_LOCAL_ENABLED;
  delete process.env.IMPORT_GOLD_LOCAL_BASE_URL;
  route?.setImportGoldProviderForTest();
  await db.execute(sql`TRUNCATE ${tables.qcWorkflowEventsTable}, ${tables.cheeseRecipesTable}, ${tables.importGoldScoresTable}, ${tables.importGoldRetentionTable}, ${tables.importGoldCasesTable}, ${tables.importOperationsTable}, ${tables.importHistoryTable}, ${tables.savedSpecSheetsTable}, ${tables.auditLogsTable}, ${tables.factoryKvTable}, ${tables.brandProfilesTable}, ${tables.mixesTable}, ${tables.doughRecipesTable}, ${tables.sauceRecipesTable}, ${tables.specImportAliasesTable}, ${tables.authSessionsTable}, ${tables.userRolesTable}, ${tables.usersTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.delete(tables.importGoldApprovalsTable);
  await db.insert(tables.usersTable).values([
    { id: "inventory", username: "inventory", passwordHash: "x" },
    { id: "inventory-peer", username: "inventory-peer", passwordHash: "x" },
    { id: "profiles", username: "profiles", passwordHash: "x" },
    { id: "sandbox", username: "sandbox", passwordHash: "x", sandbox: true },
    { id: "qc-reviewer", username: "qc-reviewer", passwordHash: "x" },
    { id: "qc-peer", username: "qc-peer", passwordHash: "x" },
  ]);
  await db.insert(tables.userRolesTable).values([
    { userId: "inventory", role: "manager" },
    { userId: "inventory-peer", role: "manager" },
    { userId: "profiles", role: "operator" },
    { userId: "sandbox", role: "manager" },
    { userId: "qc-reviewer", role: "qc-manager" },
    { userId: "qc-peer", role: "qc-manager" },
  ]);
  sessionTokens.clear();
  for (const user of ["inventory", "inventory-peer", "profiles", "sandbox", "qc-reviewer", "qc-peer"]) {
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
async function enableLocalGoldScoring(enabled = true, user = "inventory") {
  return fetch(`${baseUrl}/api/import-gold/local-scoring`, {
    method: "PATCH",
    headers: headers(user),
    body: JSON.stringify({ enabled }),
  });
}
function change(id = "mix-atomic") {
  return {
    importType: "premix", sourceLabel: "reviewed.xlsx",
    changes: { mixes: { upsert: [{ id, name: "Atomic Mix", brand: "", flavor: "", batchSize: 1, daysEarly: 0, notes: "", amountAlreadyMade: 0, components: [], isPrep: false, enabled: true }] } },
  };
}

type QcDetail = {
  operationId: string; resultHash: string; qcStatus: string; revision: number;
  applyStatus: string; evidenceAvailable: boolean; summary: unknown;
  decisions: Array<{ id: number; reason: string; actorId: string; status: string }>;
  undo: { available: boolean; guidance: string };
};
async function qcDetail(operationId: string, user = "qc-reviewer") {
  const response = await fetch(`${baseUrl}/api/qc/import-reviews/${operationId}`, { headers: headers(user) });
  expect(response.status).toBe(200);
  return response.json() as Promise<QcDetail>;
}
function qcDecision(operationId: string, body: Record<string, unknown>, user = "qc-reviewer") {
  return fetch(`${baseUrl}/api/qc/import-reviews/${operationId}/decisions`, {
    method: "POST", headers: headers(user), body: JSON.stringify(body),
  });
}
function decisionFor(detail: QcDetail, decisionId: string, status = "verified") {
  return { decisionId, expectedResultHash: detail.resultHash, expectedRevision: detail.revision, status, reason: "Synthetic committed-result review" };
}

describe("import QC review", () => {
  it("captures bounded normalized before/after evidence atomically for every committed import type, separate from Gold Lab", async () => {
    for (const importType of ["spec", "premix", "cheese"]) {
      const id = `qc-capture-${importType}-0001`;
      const input = { ...change(`qc-${importType}`), importType };
      input.changes.mixes.upsert[0].name = "Synthétique Δ QC";
      input.changes.mixes.upsert[0].notes = "PRIVATE_SOURCE_NOTES";
      // Cheese imports may only change cheese recipes.
      const body = importType === "cheese" ? {
        importType, sourceLabel: "PRIVATE_FILENAME.xlsx",
        changes: { cheeseRecipes: { upsert: [{ id: "qc-cheese", name: "Synthetic cheese", components: [], enabled: true }] } },
      } : input;
      const applied = await apply(id, body);
      expect(applied.status).toBe(200);
      const detail = await qcDetail(id);
      expect(detail).toMatchObject({ qcStatus: "pending", revision: 0, applyStatus: "applied", evidenceAvailable: true });
      const [operation] = await db.select().from(tables.importOperationsTable).where(eq(tables.importOperationsTable.id, id));
      expect(detail.resultHash).toBe(operation.resultHash);
      expect(JSON.stringify(detail.summary)).not.toMatch(/PRIVATE_SOURCE_NOTES|PRIVATE_FILENAME|sourceText|distillEvidence/);
      expect(detail.undo.available).toBe(false); // manage-qc grants no importer writes
      expect((await qcDetail(id, "inventory")).undo.available).toBe(true);
    }
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(0);
  });

  it("audits verify/reject, rejects stale revisions/hashes and preserves exact dropped-response retries", async () => {
    const id = "qc-decisions-operation-0001";
    expect((await apply(id, change())).status).toBe(200);
    const detail = await qcDetail(id);
    const first = decisionFor(detail, "qc-decision-retry-0001");
    const saved = await qcDecision(id, first);
    expect(saved.status).toBe(201);
    const receipt = await saved.json() as { revision: number };
    const replay = await qcDecision(id, first);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ revision: receipt.revision, replayed: true });
    expect((await qcDecision(id, { ...first, reason: "Changed retry" })).status).toBe(409);
    expect((await qcDecision(id, first, "qc-peer")).status).toBe(409);
    expect((await qcDecision(id, { ...first, decisionId: "qc-stale-revision-0001", status: "rejected" })).status).toBe(409);
    expect((await qcDecision(id, { ...first, decisionId: "qc-stale-hash-000001", expectedResultHash: "0".repeat(64) })).status).toBe(409);
    const verified = await qcDetail(id);
    expect(verified.qcStatus).toBe("verified");
    expect((await qcDecision(id, { ...decisionFor(verified, "qc-reject-operation-0001", "rejected"), reason: "   " })).status).toBe(400);
    expect((await qcDecision(id, decisionFor(verified, "qc-reject-operation-0001", "rejected"), "qc-peer")).status).toBe(201);
    const rejected = await qcDetail(id);
    expect(rejected).toMatchObject({ qcStatus: "rejected", applyStatus: "applied" });
    expect(rejected.decisions.map((event) => event.actorId)).toEqual(["qc-peer", "qc-reviewer"]);
    expect(rejected.undo.guidance).toMatch(/does not undo/);
    expect((await db.select().from(tables.mixesTable))[0].batchSize).toBe(1);
    const events = await db.select().from(tables.qcWorkflowEventsTable);
    expect(events.filter((event) => event.eventType !== "recipe-committed")).toHaveLength(3); // import capture plus two decisions
    expect(events.filter((event) => event.eventType === "recipe-committed")).toHaveLength(1);
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.runId === null)).toBe(true);
    const badges = await fetch(`${baseUrl}/api/qc/import-review-badges`, { headers: headers("profiles") });
    expect(await badges.json()).toEqual({ pending: 0, rejected: 1 });
    const redacted = await fetch(`${baseUrl}/api/qc/events/${rejected.decisions[0].id}/redactions`, {
      method: "POST", headers: headers("qc-peer"), body: JSON.stringify({
        operationId: "c36103dd-f785-4339-8af7-e327e8720079", reason: "Synthetic privacy request", fields: ["payload.reason"],
      }),
    });
    expect(redacted.status).toBe(201);
    expect((await qcDetail(id)).decisions[0].reason).toBe("[redacted]");
  });

  it("allows only one concurrent reviewer at the same revision", async () => {
    const id = "qc-concurrent-operation-0001";
    expect((await apply(id, change())).status).toBe(200);
    const detail = await qcDetail(id);
    const outcomes = await Promise.all([
      qcDecision(id, decisionFor(detail, "qc-reviewer-one-000001")),
      qcDecision(id, decisionFor(detail, "qc-reviewer-two-000001", "rejected"), "qc-peer"),
    ]);
    expect(outcomes.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await qcDetail(id)).decisions).toHaveLength(1);
  });

  it("excludes failed/in-progress Applies, rolls back QC capture on failure, and cannot verify undone results", async () => {
    const id = "qc-failed-operation-0001";
    route.setImportOperationFailureHookForTest((stage) => { if (stage === "after-history") throw new Error("Synthetic atomic failure"); });
    try { expect((await apply(id, change())).status).toBe(500); }
    finally { route.setImportOperationFailureHookForTest(); }
    expect(await db.select().from(tables.qcWorkflowEventsTable)).toHaveLength(0);
    for (const status of ["applying", "failed"]) {
      await db.insert(tables.importOperationsTable).values({ id: `qc-${status}-operation-0001`, importType: "premix", sourceLabel: "Synthetic", requestHash: "x", resultHash: "a".repeat(64), status });
      expect((await qcDecision(`qc-${status}-operation-0001`, {
        decisionId: `qc-${status}-decision-0001`, expectedResultHash: "a".repeat(64), expectedRevision: 0, status: "verified", reason: "Synthetic",
      })).status).toBe(409);
    }
    const queue = await fetch(`${baseUrl}/api/qc/import-reviews?status=all`, { headers: headers("qc-reviewer") });
    expect(await queue.json()).toMatchObject({ items: [] });
    expect((await apply("qc-undone-operation-0001", change())).status).toBe(200);
    const detail = await qcDetail("qc-undone-operation-0001");
    const undo = await fetch(`${baseUrl}/api/import-operations/qc-undone-operation-0001/undo`, { method: "POST", headers: headers(), body: JSON.stringify({ expectedResultHash: detail.resultHash }) });
    expect(undo.status).toBe(200);
    expect((await qcDecision(detail.operationId, decisionFor(detail, "qc-undone-decision-0001"))).status).toBe(409);
    expect((await qcDetail(detail.operationId)).applyStatus).toBe("undone");
  });

  it("retains interpretable decisions/summary after source expiry, retirement and operation purge; legacy stays unreviewed", async () => {
    const id = "qc-retention-operation-0001";
    expect((await apply(id, { ...change(), importType: "spec", sourceEvidence: {
      sourceText: "SYNTHETIC_PRIVATE_SOURCE", parseVersion: SPEC_IMPORT_PARSE_VERSION,
    } })).status).toBe(200);
    const before = await qcDetail(id);
    expect((await qcDecision(id, decisionFor(before, "qc-retention-decision-0001", "rejected"))).status).toBe(201);
    await db.update(tables.importOperationsTable).set({
      createdAt: new Date(Date.now() - 91 * 86400000),
    }).where(eq(tables.importOperationsTable.id, id));
    const { runImportSourceRetention } = await import("../lib/importSourceRetention");
    expect((await runImportSourceRetention()).sourceTextsRemoved).toBe(1);
    const [expired] = await db.select().from(tables.importOperationsTable).where(eq(tables.importOperationsTable.id, id));
    expect(expired.distillEvidence.sourceText).toBeUndefined();
    expect((await qcDetail(id)).summary).toEqual(before.summary);
    await db.delete(tables.importOperationsTable).where(eq(tables.importOperationsTable.id, id));
    const retained = await qcDetail(id);
    expect(retained).toMatchObject({ qcStatus: "rejected", applyStatus: "source-removed", summary: before.summary, undo: { available: false } });
    expect(retained.decisions[0]).toMatchObject({ status: "rejected", reason: "Synthetic committed-result review" });
    expect((await qcDecision(id, decisionFor(retained, "qc-retired-decision-0001"))).status).toBe(409);
    await db.insert(tables.importOperationsTable).values({
      id: "qc-legacy-operation-0001", importType: "premix", sourceLabel: "Legacy", requestHash: "x", resultHash: "a".repeat(64), status: "applied",
    });
    const legacy = await qcDetail("qc-legacy-operation-0001");
    expect(legacy).toMatchObject({ qcStatus: "pending", evidenceAvailable: false, summary: null, revision: 0 });
    expect((await qcDecision(legacy.operationId, decisionFor(legacy, "qc-legacy-decision-0001"))).status).toBe(409);
  });

  it("respects append-only summary redaction and reports guarded Undo unavailable after an affected edit", async () => {
    const id = "qc-redacted-operation-0001";
    expect((await apply(id, change())).status).toBe(200);
    const detail = await qcDetail(id);
    await db.update(tables.mixesTable).set({ batchSize: 9 }).where(eq(tables.mixesTable.id, "mix-atomic"));
    expect((await qcDetail(id, "inventory")).undo.available).toBe(false);
    const [capture] = await db.select().from(tables.qcWorkflowEventsTable)
      .where(eq(tables.qcWorkflowEventsTable.operationId, `import-commit:${id}`));
    const redacted = await fetch(`${baseUrl}/api/qc/events/${capture.id}/redactions`, {
      method: "POST", headers: headers("qc-reviewer"), body: JSON.stringify({
        operationId: "c36103dd-f785-4339-8af7-e327e8720080", reason: "Synthetic privacy request", fields: ["payload.summary"],
      }),
    });
    expect(redacted.status).toBe(201);
    expect((await qcDetail(id))).toMatchObject({ summary: null, evidenceAvailable: false, qcStatus: "pending" });
    expect((await qcDecision(id, decisionFor(detail, "qc-redacted-decision-0001"))).status).toBe(409);
    const [original] = await db.select().from(tables.qcWorkflowEventsTable).where(eq(tables.qcWorkflowEventsTable.id, capture.id));
    expect(original.payload.summary).toEqual(detail.summary);
  });

  it("bounds and pages status queues without repeating operations and keeps committed evidence append-only", async () => {
    const ids = ["qc-pagination-operation-0001", "qc-pagination-operation-0002"];
    for (const id of ids) expect((await apply(id, change(id))).status).toBe(200);
    const getPage = async (query: string) => {
      const response = await fetch(`${baseUrl}/api/qc/import-reviews?${query}`, { headers: headers("qc-reviewer") });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ items: QcDetail[]; nextCursor: string | null }>;
    };
    const first = await getPage("status=all&limit=1");
    expect(first.items.map((row) => row.operationId)).toEqual([ids[0]]);
    const next = await getPage(`status=all&limit=1&cursor=${first.nextCursor}`);
    expect(next.items.map((row) => row.operationId)).toEqual([ids[1]]);
    expect(next.nextCursor).toBeNull();
    const detail = await qcDetail(ids[0]);
    expect((await qcDecision(ids[0], decisionFor(detail, "qc-pagination-decision-0001"))).status).toBe(201);
    expect((await getPage("status=verified")).items.map((row) => row.operationId)).toEqual([ids[0]]);
    expect((await getPage("status=pending")).items.map((row) => row.operationId)).toEqual([ids[1]]);
    await expect(db.execute(sql`UPDATE qc_workflow_events SET actor_id = 'changed' WHERE record_id = ${ids[0]}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM qc_workflow_events WHERE record_id = ${ids[0]}`)).rejects.toThrow();
  });

  it("fences queue/detail/decisions and history while exposing counts only to same-scope staff", async () => {
    const id = "qc-authorization-operation-0001";
    expect((await apply(id, change())).status).toBe(200);
    const detail = await qcDetail(id);
    for (const url of ["/qc/import-reviews", `/qc/import-reviews/${id}`]) {
      expect((await fetch(`${baseUrl}/api${url}`, { headers: headers("profiles") })).status).toBe(403);
      expect((await fetch(`${baseUrl}/api${url}`)).status).toBe(401);
    }
    expect((await qcDecision(id, decisionFor(detail, "qc-denied-decision-0001"), "profiles")).status).toBe(403);
    const badge = await fetch(`${baseUrl}/api/qc/import-review-badges`, { headers: headers("profiles") });
    expect(await badge.json()).toEqual({ pending: 1, rejected: 0 });
    expect(badge.headers.get("cache-control")).toBe("no-store");
    const sandboxBadge = await fetch(`${baseUrl}/api/qc/import-review-badges`, { headers: headers("sandbox") });
    expect(await sandboxBadge.json()).toEqual({ pending: 0, rejected: 0 });
    expect((await fetch(`${baseUrl}/api/qc/import-reviews/${id}`, { headers: headers("sandbox") })).status).toBe(404);
    expect((await qcDecision(id, decisionFor(detail, "qc-sandbox-decision-0001"), "sandbox")).status).toBe(409);
    const history = await fetch(`${baseUrl}/api/qc/history`, { headers: headers("profiles") });
    // Ordinary operator lacks record-qc; a QC operator is checked below.
    expect(history.status).toBe(403);
    await db.update(tables.userRolesTable).set({ role: "qc-operator" }).where(eq(tables.userRolesTable.userId, "profiles"));
    const qcHistory = await fetch(`${baseUrl}/api/qc/history`, { headers: headers("profiles") });
    expect(qcHistory.status).toBe(200);
    expect(await qcHistory.json()).toMatchObject({ items: [] });
    expect((await fetch(`${baseUrl}/api/qc/import-reviews?limit=51`, { headers: headers("inventory") })).status).toBe(400);
  });
});
async function apply(
  operationId: string,
  body: Record<string, unknown>,
  user = "inventory",
  extraHeaders: Record<string, string> = {},
) {
  const capture = body.goldCapture as { input?: unknown; approvalId?: number } | undefined;
  if (capture && typeof capture === "object" && capture.input && capture.approvalId === undefined) {
    const scope = user === "sandbox" ? "sandbox" : "live";
    const sourceDigest = goldSourceDigest(capture.input);
    const fixture = approvalMetadata(sourceDigest, String(body.importType));
    await db.insert(tables.importGoldApprovalsTable).values({
      ...fixture, scope, createdBy: "inventory", verifiedBy: "inventory", verifiedAt: new Date(),
      ownerApprovedAt: new Date(fixture.ownerApprovedAt), privacyReviewedAt: new Date(fixture.privacyReviewedAt),
      validUntil: new Date(fixture.validUntil),
    }).onConflictDoNothing();
    const [approval] = await db.select().from(tables.importGoldApprovalsTable).where(and(
      eq(tables.importGoldApprovalsTable.scope, scope),
      eq(tables.importGoldApprovalsTable.sourceDigest, sourceDigest),
      eq(tables.importGoldApprovalsTable.importType, String(body.importType)),
    ));
    body = { ...body, goldCapture: { ...capture, approvalId: approval!.id } };
  }
  return fetch(`${baseUrl}/api/import-operations/${operationId}/apply`, {
    method: "POST", headers: { ...headers(user), ...extraHeaders }, body: JSON.stringify(body),
  });
}

function approvalMetadata(sourceDigest: string, importType = "premix") {
  return {
    recordRef: "synthetic-approval",
    sourceDigest, importType, purpose: "local_spec_import_accuracy",
    ownerRef: "synthetic-owner", ownerApprovedAt: "2020-01-01T00:00:00.000Z",
    privacyStatus: "not_required", privacyReviewerRef: "synthetic-reviewer",
    privacyReviewedAt: "2020-01-01T00:00:00.000Z", conditionsRef: "synthetic-none",
    externalCopiesRef: "synthetic-copy-handling", backupHandlingRef: "synthetic-backup-handling",
    manualDeletionAccepted: true, conditionsSatisfied: true, retentionDays: 30,
    validUntil: "2099-01-01T00:00:00.000Z",
  };
}

// Test-DB-only triggers stop the first transaction AFTER it has acquired the
// approval row lock. Observing PostgreSQL's actual blocker chain (not elapsed
// time or request start order) proves that the competing route reached the lock.
async function withApprovalTransactionBarrier(
  first: "capture" | "revocation",
  run: (waitForFirst: () => Promise<number>, waitForCompetitor: (pid: number) => Promise<number>,
    release: () => Promise<void>, pending: Promise<Response>[]) => Promise<void>,
) {
  const blocker = await pool.connect();
  const pending: Promise<Response>[] = [];
  const table = first === "capture" ? "mixes" : "import_gold_approvals";
  const event = first === "capture" ? "INSERT" : "UPDATE";
  const key = 3769001;
  const release = async () => { await blocker.query("SELECT pg_advisory_unlock($1)", [key]); };
  try {
    const identity = await blocker.query("SELECT current_database() AS name, pg_backend_pid() AS pid");
    expect(identity.rows[0].name).toBe(dbName);
    await blocker.query("SELECT pg_advisory_lock($1)", [key]);
    await blocker.query(`
      CREATE FUNCTION test_approval_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${key});
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_approval_barrier BEFORE ${event} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION test_approval_barrier();
    `);
    const waitForBlockedBy = async (pid: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const result = await blocker.query(`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))
        `, [pid]);
        if (result.rows.length) return Number(result.rows[0].pid);
      }
      throw new Error(`Expected ${first} transaction blocker chain was not reached`);
    };
    await run(() => waitForBlockedBy(Number(identity.rows[0].pid)), waitForBlockedBy, release, pending);
  } finally {
    // Also unblock and drain requests on assertion failure before removing the
    // trigger or allowing the next test's TRUNCATE to run.
    await release();
    await Promise.allSettled(pending);
    await blocker.query(`
      DROP TRIGGER IF EXISTS test_approval_barrier ON ${table};
      DROP FUNCTION IF EXISTS test_approval_barrier();
    `);
    blocker.release();
  }
}

describe("source approval metadata", () => {
  it.each(["capture", "revocation"] as const)(
    "serializes concurrent source capture and revocation with %s ordered first",
    async (first) => {
      const input = { candidates: [{ name: "Synthetic concurrent approval source" }] };
      const post = (url: string, body: unknown, user = "inventory") => fetch(`${baseUrl}/api${url}`, {
        method: "POST", headers: headers(user), body: JSON.stringify(body),
      });
      const created = await post("/import-gold/approvals", approvalMetadata(goldSourceDigest(input)));
      expect(created.status).toBe(201);
      const { approval } = await created.json() as { approval: { id: number } };
      const approvalPath = `/import-gold/approvals/${approval.id}`;
      expect((await post(`${approvalPath}/verification`, { reviewed: true }, "qc-reviewer")).status).toBe(200);
      const operationId = `approval-race-${first}-operation-0001`;
      const mixId = `approval-race-${first}-mix`;
      const body = { ...change(mixId), goldCapture: { input, approvalId: approval.id } };

      // Neither another scope nor an actor without the capability may mutate
      // this approval or use it to capture a case.
      expect((await post(`${approvalPath}/revocation`, { reviewed: true }, "sandbox")).status).toBe(404);
      expect((await post(`${approvalPath}/revocation`, { reviewed: true }, "profiles")).status).toBe(403);
      expect((await apply(`${operationId}-sandbox`, body, "sandbox")).status).toBe(403);
      expect((await apply(`${operationId}-operator`, body, "profiles")).status).toBe(403);

      await withApprovalTransactionBarrier(first, async (waitForFirst, waitForCompetitor, release, pending) => {
        const capture = () => apply(operationId, body);
        const revoke = () => post(`${approvalPath}/revocation`, { reviewed: true }, "qc-peer");
        const firstRequest = first === "capture" ? capture() : revoke();
        pending.push(firstRequest);
        const firstPid = await waitForFirst();
        const competingRequest = first === "capture" ? revoke() : capture();
        pending.push(competingRequest);
        const competingPid = await waitForCompetitor(firstPid);
        expect(competingPid).not.toBe(firstPid);
        await release();
        const [firstResponse, competingResponse] = await Promise.all([firstRequest, competingRequest]);
        const captureResponse = first === "capture" ? firstResponse : competingResponse;
        const revokeResponse = first === "capture" ? competingResponse : firstResponse;
        expect(revokeResponse.status).toBe(200);
        expect(captureResponse.status).toBe(first === "capture" ? 200 : 403);
        if (first === "revocation") {
          expect(await captureResponse.json()).toEqual({ error: "A verified, matching and current source approval is required" });
        }
      });

      // Retry the same identity and submit distinct new operations after the
      // revocation commit: none may create (or duplicate) domain/history/cases.
      for (const id of [operationId, `${operationId}-late-1`, `${operationId}-late-2`]) {
        const rejected = await apply(id, {
          ...body, ...(id === operationId ? {} : change(`${mixId}-${id.slice(-1)}`)),
        });
        expect(rejected.status).toBe(403);
        expect(await rejected.json()).toEqual({ error: "A verified, matching and current source approval is required" });
      }
      const expectedCount = first === "capture" ? 1 : 0;
      const mixes = await db.select().from(tables.mixesTable);
      const operations = await db.select().from(tables.importOperationsTable);
      const history = await db.select().from(tables.importHistoryTable);
      const cases = await db.select().from(tables.importGoldCasesTable);
      const retention = await db.select().from(tables.importGoldRetentionTable);
      expect(mixes).toHaveLength(expectedCount);
      expect(operations).toHaveLength(expectedCount);
      expect(history).toHaveLength(expectedCount);
      expect(cases).toHaveLength(expectedCount);
      expect(retention).toHaveLength(expectedCount);
      if (first === "capture") {
        expect(mixes[0]).toMatchObject({ id: mixId, scope: "live" });
        expect(operations[0]).toMatchObject({ id: operationId, scope: "live", actorId: "inventory", status: "applied" });
        expect(history[0]).toMatchObject({ operationId, scope: "live", actorId: "inventory" });
        expect(cases[0]).toMatchObject({
          operationId, scope: "live", approvalId: approval.id, createdBy: "inventory", evaluatedInput: input,
        });
        expect(goldSourceDigest(cases[0]!.evaluatedInput)).toBe(goldSourceDigest(input));
        expect(retention[0]).toMatchObject({ scope: "live", caseId: cases[0]!.id });
      }
      const approvals = await db.select().from(tables.importGoldApprovalsTable);
      expect(approvals).toHaveLength(1);
      const [stored] = approvals;
      expect(stored).toMatchObject({
        id: approval.id, scope: "live", createdBy: "inventory", verifiedBy: "qc-reviewer",
        revokedBy: "qc-peer", sourceDigest: goldSourceDigest(input), importType: "premix",
      });
      expect(stored!.verifiedAt).toBeInstanceOf(Date);
      expect(stored!.revokedAt).toBeInstanceOf(Date);
      const audit = (await db.select().from(tables.auditLogsTable))
        .filter((row) => row.resource === "import_gold_approval");
      expect(audit).toHaveLength(3);
      expect(audit.map((row) => row.action).sort()).toEqual([
        "import_gold_approval_created", "import_gold_approval_revoked", "import_gold_approval_verified",
      ]);
      for (const row of audit) {
        expect(row).toMatchObject({
          scope: "live", changes: { outcome: "success", targetId: String(approval.id) },
          actor: row.action === "import_gold_approval_created" ? "inventory"
            : row.action === "import_gold_approval_verified" ? "qc-reviewer" : "qc-peer",
        });
        expect(Object.keys(row.changes).sort()).toEqual(["outcome", "targetId"]);
      }
    },
  );

  it("requires explicit review, binds exact scoped input, and fences revocation without enabling capture", async () => {
    process.env.IMPORT_GOLD_APPROVAL_RECORD_REF = "synthetic-approval";
    const input = { candidates: [{ name: "Synthetic approved source" }] };
    const metadata = approvalMetadata(goldSourceDigest(input));
    const post = (url: string, body: unknown, user = "inventory") => fetch(`${baseUrl}/api${url}`, {
      method: "POST", headers: headers(user), body: JSON.stringify(body),
    });
    expect((await post("/import-gold/approvals", metadata, "profiles")).status).toBe(403);
    expect((await post("/import-gold/approvals", { ...metadata, ownerRef: "private@example.com" })).status).toBe(400);
    expect((await post("/import-gold/approvals", { ...metadata, privacyStatus: "pending" })).status).toBe(400);
    const created = await post("/import-gold/approvals", metadata);
    expect(created.status).toBe(201);
    const { approval } = await created.json() as { approval: { id: number; verifiedAt: null } };
    expect(approval.verifiedAt).toBeNull();
    const readApproval = async (user = "inventory") => {
      const response = await fetch(`${baseUrl}/api/import-gold/approvals`, { headers: headers(user) });
      expect(response.status).toBe(200);
      const page = await response.json() as { approvals: Array<Record<string, unknown>> };
      return page.approvals.find((row) => row.id === approval.id);
    };
    expect(await readApproval("qc-reviewer")).toMatchObject({
      ...metadata, id: approval.id, verifiedAt: null, revokedAt: null,
    });
    expect((await post("/import-gold/approvals", metadata)).status).toBe(409);
    const capture = { ...change("source-approved"), goldCapture: { input, approvalId: approval.id } };
    const unbound = await post("/import-operations/source-unbound-approval-0001/apply", {
      ...change("source-unbound"), goldCapture: { input },
    });
    expect(unbound.status).toBe(403);
    expect((await apply("source-approval-pending-0001", capture)).status).toBe(403);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    expect((await post(`/import-gold/approvals/${approval.id}/verification`, { reviewed: true }, "sandbox")).status).toBe(404);
    expect((await post(`/import-gold/approvals/${approval.id}/verification`, { reviewed: false })).status).toBe(400);
    expect((await post(`/import-gold/approvals/${approval.id}/verification`, { reviewed: true }, "qc-reviewer")).status).toBe(200);
    expect(await readApproval()).toMatchObject({
      ...metadata, verifiedBy: "qc-reviewer", verifiedAt: expect.any(String), revokedAt: null,
    });
    expect((await apply("source-approval-mismatch-0001", {
      ...capture, goldCapture: { input: { candidates: [] }, approvalId: approval.id },
    })).status).toBe(403);
    process.env.IMPORT_GOLD_ENABLED = "false";
    expect((await apply("source-approval-disabled-0001", capture)).status).toBe(404);
    process.env.IMPORT_GOLD_ENABLED = "true";
    expect((await apply("source-approval-success-0001", capture)).status).toBe(200);
    const [saved] = await db.select().from(tables.importGoldCasesTable);
    expect(saved!.approvalId).toBe(approval.id);
    await db.update(tables.importGoldApprovalsTable).set({ validUntil: new Date("2020-01-01") })
      .where(eq(tables.importGoldApprovalsTable.id, approval.id));
    expect((await apply("source-approval-expired-0001", capture)).status).toBe(403);
    await db.update(tables.importGoldApprovalsTable).set({ validUntil: new Date(metadata.validUntil) })
      .where(eq(tables.importGoldApprovalsTable.id, approval.id));
    process.env.IMPORT_GOLD_APPROVAL_RECORD_REF = "different-reference";
    expect((await apply("source-approval-wrong-ref-0001", capture)).status).toBe(403);
    process.env.IMPORT_GOLD_APPROVAL_RECORD_REF = metadata.recordRef;
    expect((await post(`/import-gold/approvals/${approval.id}/revocation`, { reviewed: true })).status).toBe(200);
    expect(await readApproval("qc-reviewer")).toMatchObject({
      ...metadata, revokedBy: "inventory", revokedAt: expect.any(String),
    });
    expect((await post(`/import-gold/approvals/${approval.id}/verification`, { reviewed: true })).status).toBe(409);
    expect((await apply("source-approval-revoked-0001", capture)).status).toBe(403);
    const sandbox = await fetch(`${baseUrl}/api/import-gold/approvals`, { headers: headers("sandbox") });
    expect(await sandbox.json()).toEqual({ approvals: [], nextBefore: null });
    const events = await db.select().from(tables.auditLogsTable);
    expect(events.filter((row) => row.resource === "import_gold_approval")).toHaveLength(3);
    expect(events.filter((row) => row.resource === "import_gold_approval").every((row) =>
      Object.keys(row.changes).sort().join(",") === "outcome,targetId")).toBe(true);
  });
});

describe("atomic import operations", () => {
  it("preserves premade-crust classification on re-import and leaves new names unclassified", async () => {
    const existing = {
      id: "premade-import-existing",
      name: "Premade Crust",
      notes: "",
      components: [],
      enabled: true,
      isPremadeCrust: true,
      brand: "",
      flavors: [],
    };
    expect((await apply("premade-import-initial", {
      importType: "spec",
      sourceLabel: "synthetic-premade-crust",
      changes: { doughRecipes: { upsert: [existing] } },
    })).status).toBe(200);

    const reimported = { ...existing, notes: "Updated by workbook" };
    delete (reimported as Partial<typeof existing>).isPremadeCrust;
    expect((await apply("premade-import-reimport", {
      importType: "spec",
      sourceLabel: "synthetic-premade-crust",
      changes: { doughRecipes: { upsert: [reimported] } },
    })).status).toBe(200);

    const unclassified = {
      id: "premade-import-unclassified",
      name: "Premade Crust Vendor",
      notes: "",
      components: [],
      enabled: true,
      brand: "",
      flavors: [],
    };
    expect((await apply("premade-import-new-unclassified", {
      importType: "spec",
      sourceLabel: "synthetic-premade-crust",
      changes: { doughRecipes: { upsert: [unclassified] } },
    })).status).toBe(200);

    const stored = await db.select().from(tables.doughRecipesTable);
    expect(stored.find((row) => row.id === existing.id)?.isPremadeCrust).toBe(true);
    expect(stored.find((row) => row.id === unclassified.id)?.isPremadeCrust).toBe(false);
  });

  it("previews the actual normalized write set without learning, applying or writing audit/stock", async () => {
    const body = { ...change(), sourceKey: "synthetic-source" };
    const response = await fetch(`${baseUrl}/api/import-operations/preview`, {
      method: "POST", headers: headers(), body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const preview = await response.json() as PreviewBody;
    expect(preview.expectedStateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.before.mixes).toEqual([]);
    expect(preview.after.mixes[0]).toMatchObject({ id: "mix-atomic", name: "Atomic Mix", batchSize: 1 });
    expect(preview.baseline.status).toBe("unavailable");
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);
    expect(await db.select().from(tables.importHistoryTable)).toHaveLength(0);
    expect(await db.select().from(tables.specImportAliasesTable)).toHaveLength(0);
    expect(await db.select().from(tables.auditLogsTable)).toHaveLength(0);
    const applied = await apply("reviewed-preview-apply", { ...body, expectedStateHash: preview.expectedStateHash });
    expect(applied.status).toBe(200);
    const operation = (await db.select().from(tables.importOperationsTable))[0];
    expect((operation.afterSnapshot as Record<string, unknown[]>).mixes[0]).toMatchObject(preview.after.mixes[0]);
  });

  it("rejects a stale reviewed fingerprint without changing the peer's data", async () => {
    expect((await apply("preview-peer-initial", change())).status).toBe(200);
    const proposal = change();
    proposal.changes.mixes.upsert[0].batchSize = 2;
    const response = await fetch(`${baseUrl}/api/import-operations/preview`, {
      method: "POST", headers: headers(), body: JSON.stringify(proposal),
    });
    const preview = await response.json() as PreviewBody;
    const peer = change();
    peer.changes.mixes.upsert[0].batchSize = 7;
    expect((await apply("preview-peer-edit", peer)).status).toBe(200);
    const rejected = await apply("preview-stale-review", { ...proposal, expectedStateHash: preview.expectedStateHash });
    expect(rejected.status).toBe(409);
    expect((await rejected.json() as { error: string }).error).toMatch(/changed|review/i);
    expect((await db.select().from(tables.mixesTable))[0].batchSize).toBe(7);
    expect(await db.select().from(tables.importOperationsTable).where(eq(tables.importOperationsTable.id, "preview-stale-review"))).toHaveLength(0);
  });

  it("selects only the last successful same-scope/source/type Apply and skips undone operations", async () => {
    const body = { ...change(), sourceKey: "source-A" };
    expect((await apply("preview-source-first", body)).status).toBe(200);
    const second = { ...change(), sourceKey: "source-A" };
    second.changes.mixes.upsert[0].batchSize = 3;
    expect((await apply("preview-source-second", second)).status).toBe(200);
    const undo = await fetch(`${baseUrl}/api/import-operations/preview-source-second/undo`, {
      method: "POST", headers: headers(), body: JSON.stringify({ reason: "Synthetic review verification" }),
    });
    expect(undo.status).toBe(200);
    expect((await apply("preview-sandbox-source", { ...change("sandbox-row"), sourceKey: "source-A" }, "sandbox")).status).toBe(200);
    expect((await apply("preview-other-source", { ...change("other-row"), sourceKey: "source-B" })).status).toBe(200);
    const response = await fetch(`${baseUrl}/api/import-operations/preview`, {
      method: "POST", headers: headers(), body: JSON.stringify(body),
    });
    const preview = await response.json() as PreviewBody;
    expect(preview.baseline.operationId).toBe("preview-source-first");
    expect(preview.baseline.before.mixes[0].batchSize).toBe(1);
    expect(JSON.stringify(preview)).not.toContain("sandbox-row");
    expect(JSON.stringify(preview)).not.toContain("other-row");
  });

  it("bounds preview requests and requires both importer and entity capabilities", async () => {
    for (const [body, status] of [
      [{ ...change(), changes: { unknown: { upsert: [] } } }, 400],
      [{ ...change(), sourceKey: "x".repeat(301) }, 400],
      [{ ...change(), changes: { mixes: { upsert: Array.from({ length: 501 }, () => ({ id: "x" })) } } }, 400],
    ] as const) {
      const response = await fetch(`${baseUrl}/api/import-operations/preview`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      expect(response.status).toBe(status);
    }
    const denied = await fetch(`${baseUrl}/api/import-operations/preview`, { method: "POST", headers: headers("profiles"), body: JSON.stringify(change()) });
    expect(denied.status).toBe(403);
    const unauthenticated = await fetch(`${baseUrl}/api/import-operations/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change()) });
    expect(unauthenticated.status).toBe(401);
  });

  it("keeps bounded local applied-value receipts scoped and excludes source/formula fields", async () => {
    const input = {
      importType: "shipping", operationId: "preview-local-receipt", sourceKey: "guide-A", sourceLabel: "Synthetic guide",
      status: "complete", summary: { appliedValues: { profiles: [{ key: "A", brand: "A", flavor: "", pizzasPerCase: 12 }] }, persistence: "local-verified" },
    };
    const saved = await fetch(`${baseUrl}/api/import-history`, { method: "POST", headers: headers(), body: JSON.stringify(input) });
    expect(saved.status).toBe(201);
    const rows = await fetch(`${baseUrl}/api/import-history?type=shipping&status=complete&sourceKey=guide-A`, { headers: headers() });
    expect((await rows.json() as ReceiptBody).imports[0].summary.appliedValues?.profiles[0].pizzasPerCase).toBe(12);
    const sandbox = await fetch(`${baseUrl}/api/import-history?type=shipping&sourceKey=guide-A`, { headers: headers("sandbox") });
    expect((await sandbox.json() as ReceiptBody).imports).toEqual([]);
    const otherSource = await fetch(`${baseUrl}/api/import-history?type=shipping&sourceKey=guide-B`, { headers: headers() });
    expect((await otherSource.json() as ReceiptBody).imports).toEqual([]);
    const unsafe = await fetch(`${baseUrl}/api/import-history`, { method: "POST", headers: headers(), body: JSON.stringify({
      ...input, operationId: "preview-unsafe-receipt", summary: { appliedValues: { profiles: [{ key: "A", formula: "=SUM(B1:B9)" }] }, persistence: "local-verified" },
    }) });
    expect(unsafe.status).toBe(201);
    expect((await unsafe.json() as ReceiptBody).import.summary.appliedValues).toBeUndefined();
  });
  it("records value-free imported create, update, and delete events for cheese, dough, sauce, and mix recipes", async () => {
    const dough = {
      id: "import-audit-dough",
      name: "PRIVATE_DOUGH_NAME",
      brand: "PRIVATE_DOUGH_BRAND",
      flavors: ["PRIVATE_DOUGH_FLAVOR"],
      notes: "PRIVATE_DOUGH_NOTES",
      components: [{ ingredient: "PRIVATE_DOUGH_INGREDIENT", lbs: 10 }],
      doughballWeightOz: 8,
      doughballsPerTray: 30,
      doughballVariants: [{ label: "PRIVATE_DOUGH_VARIANT", weightOz: 8, perTray: 30 }],
    };
    const sauce = {
      id: "import-audit-sauce",
      name: "PRIVATE_SAUCE_NAME",
      brand: "PRIVATE_SAUCE_BRAND",
      flavors: ["PRIVATE_SAUCE_FLAVOR"],
      notes: "PRIVATE_SAUCE_NOTES",
      components: [{ ingredient: "PRIVATE_SAUCE_INGREDIENT", lbs: 10 }],
    };
    const mix = {
      id: "import-audit-mix",
      name: "PRIVATE_MIX_NAME",
      brand: "PRIVATE_MIX_BRAND",
      flavor: "PRIVATE_MIX_FLAVOR",
      batchSize: 3,
      daysEarly: 2,
      notes: "PRIVATE_MIX_NOTES",
      amountAlreadyMade: 1,
      components: [{ ingredient: "PRIVATE_MIX_INGREDIENT", perPizza: 2 }],
      isPrep: true,
      enabled: true,
    };
    const cheese = {
      id: "import-audit-cheese",
      name: "PRIVATE_CHEESE_NAME",
      brand: "PRIVATE_CHEESE_BRAND",
      flavors: ["PRIVATE_CHEESE_FLAVOR"],
      shredderSetting: "PRIVATE_CHEESE_SHREDDER_SETTING",
      cellulose: "PRIVATE_CHEESE_CELLULOSE",
      notes: "PRIVATE_CHEESE_NOTES",
      components: [{ ingredient: "PRIVATE_CHEESE_INGREDIENT", lbs: 10 }],
      enabled: true,
    };
    const changesFor = (recipes: {
      cheese: typeof cheese;
      dough: typeof dough;
      sauce: typeof sauce;
      mix: typeof mix;
    }) => ({
      importType: "spec",
      sourceLabel: "private-recipe-source.xlsx",
      changes: {
        cheeseRecipes: { upsert: [recipes.cheese] },
        doughRecipes: { upsert: [recipes.dough] },
        sauceRecipes: { upsert: [recipes.sauce] },
        mixes: { upsert: [recipes.mix] },
      },
    });
    const createdResponse = await apply(
      "import-audit-create-0001",
      changesFor({ cheese, dough, sauce, mix }),
      "inventory",
      { "x-correlation-id": "client-supplied-correlation" },
    );
    expect(createdResponse.status).toBe(200);
    const createdCorrelationId = createdResponse.headers.get("x-correlation-id");
    expect(createdCorrelationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(createdCorrelationId).not.toBe("client-supplied-correlation");

    const updatedCheese = { ...cheese, shredderSetting: "UPDATED_CHEESE_SHREDDER_SETTING" };
    const updatedDough = { ...dough, notes: "UPDATED_DOUGH_NOTES" };
    const updatedSauce = { ...sauce, brand: "UPDATED_SAUCE_BRAND" };
    const updatedMix = { ...mix, batchSize: 4 };
    const updatedResponse = await apply("import-audit-update-0001", changesFor({
      cheese: updatedCheese,
      dough: updatedDough,
      sauce: updatedSauce,
      mix: updatedMix,
    }));
    expect(updatedResponse.status).toBe(200);
    const updatedCorrelationId = updatedResponse.headers.get("x-correlation-id");
    expect(updatedCorrelationId).toMatch(/^[0-9a-f-]{36}$/u);

    const noOpChanges = changesFor({
      cheese: updatedCheese,
      dough: updatedDough,
      sauce: updatedSauce,
      mix: updatedMix,
    });
    const noOpResponse = await apply("import-audit-noop-0001", {
      ...noOpChanges,
      changes: {
        ...noOpChanges.changes,
        cheeseRecipes: {
          ...noOpChanges.changes.cheeseRecipes,
          delete: ["missing-import-audit-recipe"],
        },
        doughRecipes: {
          ...noOpChanges.changes.doughRecipes,
          delete: ["missing-import-audit-recipe"],
        },
      },
    });
    expect(noOpResponse.status).toBe(200);

    const deleteResponse = await apply("import-audit-delete-0001", {
      importType: "spec",
      sourceLabel: "private-recipe-source.xlsx",
      changes: {
        cheeseRecipes: { delete: [cheese.id] },
        doughRecipes: { delete: [dough.id] },
        sauceRecipes: { delete: [sauce.id] },
        mixes: { delete: [mix.id] },
      },
    });
    expect(deleteResponse.status).toBe(200);
    const deleteCorrelationId = deleteResponse.headers.get("x-correlation-id");
    expect(deleteCorrelationId).toMatch(/^[0-9a-f-]{36}$/u);

    const auditRows = (await db.select().from(tables.auditLogsTable))
      .sort((left, right) => left.id - right.id);
    const families = [
      {
        family: "cheese_recipe",
        id: cheese.id,
        fields: [
          "name", "brand", "flavors", "shredderSetting", "cellulose",
          "notes", "components", "enabled",
        ],
        updatedFields: ["shredderSetting"],
      },
      {
        family: "dough_recipe",
        id: dough.id,
        fields: [
          "name", "notes", "components", "enabled", "isPremadeCrust", "brand", "flavors",
          "doughballWeightOz", "doughballsPerTray", "doughballVariants",
        ],
        updatedFields: ["notes"],
      },
      {
        family: "sauce_recipe",
        id: sauce.id,
        fields: ["name", "notes", "components", "enabled", "brand", "flavors"],
        updatedFields: ["brand"],
      },
      {
        family: "mix_recipe",
        id: mix.id,
        fields: [
          "name", "brand", "flavor", "batchSize", "daysEarly", "notes",
          "amountAlreadyMade", "components", "isPrep", "enabled",
        ],
        updatedFields: ["batchSize"],
      },
    ];
    expect(auditRows).toHaveLength(12);
    for (const recipe of families) {
      const events = auditRows.filter((row) => row.resource === `${recipe.family}:${recipe.id}`);
      expect(events.map((row) => row.action)).toEqual([
        `${recipe.family}_created`,
        `${recipe.family}_updated`,
        `${recipe.family}_deleted`,
      ]);
      expect(events.map((row) => row.actor)).toEqual(["inventory", "inventory", "inventory"]);
      expect(events.map((row) => row.changes)).toEqual([
        { fieldNames: recipe.fields, correlationId: createdCorrelationId },
        { fieldNames: recipe.updatedFields, correlationId: updatedCorrelationId },
        { fieldNames: recipe.fields, correlationId: deleteCorrelationId },
      ]);
    }
    expect(auditRows.some((row) =>
      (row.changes as Record<string, unknown>).correlationId === noOpResponse.headers.get("x-correlation-id"),
    )).toBe(false);

    const auditPayload = JSON.stringify(auditRows);
    for (const privateValue of [
      "PRIVATE_CHEESE_NAME", "PRIVATE_CHEESE_BRAND", "PRIVATE_CHEESE_FLAVOR",
      "PRIVATE_CHEESE_SHREDDER_SETTING", "PRIVATE_CHEESE_CELLULOSE",
      "PRIVATE_CHEESE_NOTES", "PRIVATE_CHEESE_INGREDIENT",
      "UPDATED_CHEESE_SHREDDER_SETTING",
      "PRIVATE_DOUGH_NAME", "PRIVATE_DOUGH_BRAND", "PRIVATE_DOUGH_FLAVOR",
      "PRIVATE_DOUGH_NOTES", "PRIVATE_DOUGH_INGREDIENT", "PRIVATE_DOUGH_VARIANT",
      "UPDATED_DOUGH_NOTES", "PRIVATE_SAUCE_NAME", "PRIVATE_SAUCE_BRAND",
      "PRIVATE_SAUCE_FLAVOR", "PRIVATE_SAUCE_NOTES", "PRIVATE_SAUCE_INGREDIENT",
      "UPDATED_SAUCE_BRAND", "PRIVATE_MIX_NAME", "PRIVATE_MIX_BRAND",
      "PRIVATE_MIX_FLAVOR", "PRIVATE_MIX_NOTES", "PRIVATE_MIX_INGREDIENT",
    ]) {
      expect(auditPayload).not.toContain(privateValue);
    }
  });

  it("rejects source evidence from a retired parser without persisting an operation", async () => {
    const response = await apply("distill-retired-parser-0001", {
      ...change("retired-parser"),
      importType: "spec",
      sourceEvidence: {
        sourceText: "Retired parser fixture",
        parseVersion: String(Number(SPEC_IMPORT_PARSE_VERSION) - 1),
      },
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
    const applied = await apply("distill-authorized-0001", {
      importType: "spec",
      sourceLabel: "private-source.xlsx",
      sourceEvidence,
      changes: {
        brandProfiles: {
          upsert: [{
            key: "alpine foods__four cheese",
            brand: "Alpine Foods",
            flavor: "Four Cheese",
            values: { pizzasPerCase: 12 },
            crustValues: {},
            updatedAtMs: 1,
          }],
        },
      },
    });
    expect(applied.status).toBe(200);
    const before = (await db.select().from(tables.importOperationsTable))
      .find((row) => row.id === "distill-authorized-0001");
    expect(before?.status).toBe("applied");

    const response = await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    const page = await response.json() as {
      records: Array<Record<string, unknown>>;
      nextCursor: string | null;
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
    const after = (await db.select().from(tables.importOperationsTable))
      .find((row) => row.id === "distill-authorized-0001");
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
    const first = await firstResponse.json() as {
      records: Array<{ operationId: string }>;
      nextCursor: string | null;
    };
    expect(first.records).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const secondResponse = await fetch(
      `${baseUrl}/api/import-operations/distillation-evidence?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
      { headers: headers() },
    );
    const second = await secondResponse.json() as {
      records: Array<{ operationId: string }>;
      nextCursor: string | null;
    };
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
    const undone = await (await apply("distill-undone-source-0001", {
      importType: "spec",
      sourceLabel: "undone-source.xlsx",
      sourceEvidence: { sourceText: "Undone source", parseVersion: SPEC_IMPORT_PARSE_VERSION },
      changes: {
        brandProfiles: {
          upsert: [{
            key: "undone brand__flavor",
            brand: "Undone Brand",
            flavor: "Flavor",
            values: {},
            crustValues: {},
            updatedAtMs: 2,
          }],
        },
      },
    })).json() as any;
    const undoResponse = await fetch(`${baseUrl}/api/import-operations/distill-undone-source-0001/undo`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ expectedResultHash: undone.operation.resultHash }),
    });
    expect(undoResponse.status).toBe(200);

    const response = await fetch(`${baseUrl}/api/import-operations/distillation-evidence`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    const page = await response.json() as { records: Array<Record<string, unknown>> };
    expect(page.records).toHaveLength(0);
  });

  it("rolls back after failures at domain and history stages", async () => {
    const rollbackBody = {
      ...change(),
      changes: {
        ...change().changes,
        cheeseRecipes: {
          upsert: [{
            id: "rollback-cheese-recipe",
            name: "Rollback Cheese",
            brand: "Brand",
            flavors: [],
            shredderSetting: "",
            cellulose: "",
            notes: "",
            components: [],
            enabled: true,
          }],
        },
      },
    };
    for (const stage of ["after-mixes", "after-recipe-audit", "after-history"]) {
      route.setImportOperationFailureHookForTest((actual) => { if (actual === stage) throw new Error("injected"); });
      const response = await apply(`rollback-${stage.replace("-", "")}-001`, rollbackBody);
      expect(response.status).toBe(500);
      expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
      expect(await db.select().from(tables.cheeseRecipesTable)).toHaveLength(0);
      expect(await db.select().from(tables.importOperationsTable)).toHaveLength(0);
      expect(await db.select().from(tables.auditLogsTable)).toHaveLength(0);
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

  it("attaches only an owned saved-spec snapshot to its existing import-history row", async () => {
    const operationId = "snapshot-enrichment-000001";
    const sourceKey = "fixture-spec-sheet";
    const committed = await apply(operationId, {
      ...change(),
      importType: "spec",
      sourceLabel: "fixture-spec-sheet.png",
      sourceKey,
    });
    expect(committed.status).toBe(200);
    const [original] = await db.select().from(tables.importHistoryTable)
      .where(eq(tables.importHistoryTable.operationId, operationId));
    expect(original?.snapshotId).toBeNull();

    const [sandboxSnapshot] = await db.insert(tables.savedSpecSheetsTable).values({
      scope: "sandbox",
      label: "sandbox snapshot",
      sourceKey,
      data: { profiles: [], recipes: [] },
    }).returning();
    const historyRequest = (snapshotId: number) => fetch(`${baseUrl}/api/import-history`, {
      method: "POST",
      headers: headers("inventory"),
      body: JSON.stringify({
        operationId,
        importType: "spec",
        sourceKey,
        sourceLabel: "fixture-spec-sheet.png",
        status: "complete",
        summary: { snapshotId },
      }),
    });
    const foreignAttempt = await historyRequest(sandboxSnapshot.id);
    expect(foreignAttempt.status).toBe(201);
    expect(((await foreignAttempt.json()) as { import: { snapshotId: number | null } }).import.snapshotId)
      .toBeNull();

    const [unrelatedSnapshot] = await db.insert(tables.savedSpecSheetsTable).values({
      scope: "live",
      label: "unrelated live snapshot",
      sourceKey: "another-spec-sheet",
      data: { profiles: [], recipes: [] },
    }).returning();
    const unrelatedAttempt = await historyRequest(unrelatedSnapshot.id);
    expect(((await unrelatedAttempt.json()) as { import: { snapshotId: number | null } }).import.snapshotId)
      .toBeNull();

    const [liveSnapshot] = await db.insert(tables.savedSpecSheetsTable).values({
      scope: "live",
      label: "live snapshot",
      sourceKey,
      data: { profiles: [], recipes: [] },
    }).returning();
    const attached = await historyRequest(liveSnapshot.id);
    expect(attached.status).toBe(201);
    expect(((await attached.json()) as { import: { snapshotId: number | null } }).import.snapshotId)
      .toBe(liveSnapshot.id);
    const [persisted] = await db.select().from(tables.importHistoryTable)
      .where(eq(tables.importHistoryTable.operationId, operationId));
    expect(persisted?.snapshotId).toBe(String(liveSnapshot.id));
    expect(await db.select().from(tables.importHistoryTable)
      .where(eq(tables.importHistoryTable.operationId, operationId))).toHaveLength(1);
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

    const second = await (await apply("undo-refuse-000001", change("unrelated-target"))).json() as any;
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

  it("captures only a successfully applied human result and isolates cases by scope", async () => {
    const goldCapture = { input: { candidates: [{ name: "Reviewed Mix" }] } };
    const saved = await apply("gold-capture-success-0001", {
      ...change("gold-captured-mix"),
      goldCapture,
    });
    expect(saved.status).toBe(200);
    const liveCases = await db.select().from(tables.importGoldCasesTable).where(eq(tables.importGoldCasesTable.scope, "live"));
    expect(liveCases).toHaveLength(1);
    const liveRetention = await db.select().from(tables.importGoldRetentionTable).where(eq(tables.importGoldRetentionTable.scope, "live"));
    expect(liveRetention).toMatchObject([{
      caseId: liveCases[0]!.id,
      capturedAt: liveCases[0]!.createdAt,
      deleteBy: new Date(liveCases[0]!.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    }]);
    expect(liveCases[0]?.evaluatedInput).toEqual(goldCapture.input);
    expect(liveCases[0]?.expectedResult.mixes).toEqual([
      expect.objectContaining({ name: "Atomic Mix", batchSize: 1 }),
    ]);
    const originalReceipt = await saved.json();
    const concurrentRetries = await Promise.all(Array.from({ length: 4 }, () =>
      apply("gold-capture-success-0001", { ...change("gold-captured-mix"), goldCapture })));
    for (const response of concurrentRetries) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(originalReceipt);
    }
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(1);

    route.setImportOperationFailureHookForTest((stage) => {
      if (stage === "after-history") throw new Error("injected apply rollback");
    });
    const failed = await apply("gold-capture-failure-0001", {
      ...change("gold-capture-failed-mix"),
      goldCapture,
    });
    route.setImportOperationFailureHookForTest();
    expect(failed.status).toBe(500);
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(1);
    expect(await db.select().from(tables.mixesTable).where(eq(tables.mixesTable.id, "gold-capture-failed-mix"))).toHaveLength(0);

    const sandbox = await apply("gold-capture-sandbox-0001", {
      ...change("gold-sandbox-mix"),
      goldCapture,
    }, "sandbox");
    expect(sandbox.status).toBe(200);
    const sandboxList = await fetch(`${baseUrl}/api/import-gold/cases`, { headers: headers("sandbox") });
    expect(sandboxList.status).toBe(200);
    expect((await sandboxList.json() as { cases: unknown[] }).cases).toHaveLength(1);
    expect(await db.select().from(tables.importGoldCasesTable).where(eq(tables.importGoldCasesTable.scope, "sandbox"))).toHaveLength(1);
    const crossScopeMutation = await fetch(`${baseUrl}/api/import-gold/cases/${liveCases[0]!.id}/exclusion`, {
      method: "PATCH",
      headers: headers("sandbox"),
      body: JSON.stringify({ excluded: true }),
    });
    expect(crossScopeMutation.status).toBe(404);
  });

  it("never retroactively captures an opted-out Apply on a retry", async () => {
    const input = change("gold-opted-out-mix");
    const first = await apply("gold-opted-out-operation-0001", input);
    expect(first.status).toBe(200);
    const receipt = await first.json();
    const retry = await apply("gold-opted-out-operation-0001", {
      ...input,
      goldCapture: { input: { candidates: [{ name: "Synthetic review" }] } },
    });
    // Capture options belong to the original request hash; a changed retry is
    // rejected rather than retroactively collecting an initially opted-out input.
    expect(retry.status).toBe(409);
    const unchangedRetry = await apply("gold-opted-out-operation-0001", input);
    expect(unchangedRetry.status).toBe(200);
    expect(await unchangedRetry.json()).toEqual(receipt);
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(0);
  });

  it("reports invalid local configuration without probing and rejects production test overrides", async () => {
    process.env.IMPORT_GOLD_LOCAL_ENABLED = "true";
    process.env.IMPORT_GOLD_LOCAL_BASE_URL = "http://169.254.169.254/private";
    expect((await enableLocalGoldScoring()).status).toBe(200);
    const configResponse = await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() });
    expect(configResponse.status).toBe(200);
    expect(await configResponse.json()).toMatchObject({ enabled: true, localConfigured: false });
    const scoreResponse = await fetch(`${baseUrl}/api/import-gold/score`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ provider: "local", providerOverride: "untrusted-http-hook" }),
    });
    expect(scoreResponse.status).toBe(503);
    expect(await scoreResponse.json()).toEqual({ error: "The local evaluator is not configured" });
    expect(await db.select().from(tables.importGoldScoresTable)).toHaveLength(0);
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => route.setImportGoldProviderForTest(async () => ({}))).toThrow("Test provider unavailable");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("lists, excludes, exports, and deletes only manager-visible scoped cases", async () => {
    const applied = await apply("gold-controls-operation-001", {
      ...change("gold-controls-mix"),
      goldCapture: { input: { candidates: [{ name: "Controls" }] } },
    });
    expect(applied.status).toBe(200);
    const listed = await fetch(`${baseUrl}/api/import-gold/cases?limit=5`, { headers: headers() });
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as { cases: Array<{ id: number; excluded: boolean; evaluatedInput?: unknown; scores: unknown[] }> };
    expect(listBody.cases).toHaveLength(1);
    expect(listBody.cases[0]).toMatchObject({ excluded: false, scores: [] });
    expect(listBody.cases[0]).not.toHaveProperty("evaluatedInput");
    const caseId = listBody.cases[0]!.id;

    process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS = "pending";
    const disabledCaseRoutes = await Promise.all([
      fetch(`${baseUrl}/api/import-gold/cases`, { headers: headers() }),
      fetch(`${baseUrl}/api/import-gold/export.jsonl`, { headers: headers() }),
      fetch(`${baseUrl}/api/import-gold/score`, {
        method: "POST", headers: headers(), body: JSON.stringify({ provider: "local" }),
      }),
      fetch(`${baseUrl}/api/import-gold/cases/${caseId}/exclusion`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ excluded: true }),
      }),
      fetch(`${baseUrl}/api/import-gold/cases/${caseId}`, { method: "DELETE", headers: headers() }),
    ]);
    expect(disabledCaseRoutes.map((response) => response.status)).toEqual([200, 200, 403, 404, 404]);
    expect((await disabledCaseRoutes[0]!.json() as { cases: unknown[] }).cases).toEqual([]);
    expect(await disabledCaseRoutes[1]!.text()).toBe("");
    process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS = "not_required";

    const invalidLimit = await fetch(`${baseUrl}/api/import-gold/cases?limit=101`, { headers: headers() });
    expect(invalidLimit.status).toBe(400);
    const excluded = await fetch(`${baseUrl}/api/import-gold/cases/${caseId}/exclusion`, {
      method: "PATCH", headers: headers(), body: JSON.stringify({ excluded: true }),
    });
    expect(excluded.status).toBe(200);
    const excludedExport = await fetch(`${baseUrl}/api/import-gold/export.jsonl`, { headers: headers() });
    expect(await excludedExport.text()).toBe("");

    const restored = await fetch(`${baseUrl}/api/import-gold/cases/${caseId}/exclusion`, {
      method: "PATCH", headers: headers(), body: JSON.stringify({ excluded: false }),
    });
    expect(restored.status).toBe(200);
    const exported = await fetch(`${baseUrl}/api/import-gold/export.jsonl`, { headers: headers() });
    expect(exported.status).toBe(403);
    expect(await exported.json()).toEqual({ error: "Local-evaluation approval does not authorize case exports" });

    const deleted = await fetch(`${baseUrl}/api/import-gold/cases/${caseId}`, { method: "DELETE", headers: headers() });
    expect(deleted.status).toBe(204);
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(0);
  });

  it("audits standard Gold Lab case deletion atomically within the active scope", async () => {
    const [liveCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "live",
      operationId: "synthetic-standard-delete-live-001",
      importType: "premix",
      sourceLabel: "Synthetic standard deletion fixture",
      evaluatedInput: { candidates: [{ name: "Synthetic input" }] },
      expectedResult: { mixes: [{ name: "Synthetic expected result" }] },
      createdBy: "inventory",
    }).returning({ id: tables.importGoldCasesTable.id });
    const [sandboxCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "sandbox",
      operationId: "synthetic-standard-delete-sandbox-001",
      importType: "cheese",
      sourceLabel: "Synthetic sandbox deletion fixture",
      evaluatedInput: { recipes: [{ name: "Synthetic sandbox input" }] },
      expectedResult: { recipes: [{ name: "Synthetic sandbox expected result" }] },
      createdBy: "sandbox",
    }).returning({ id: tables.importGoldCasesTable.id });
    await db.insert(tables.importGoldScoresTable).values({
      scope: "live",
      caseId: liveCase!.id,
      provider: "local",
      status: "scored",
      accuracy: 1,
      comparedFields: 1,
      equalFields: 1,
      fieldDiffs: [{ field: "synthetic", expected: "Synthetic", predicted: "Synthetic" }],
    });

    const sandboxCannotDeleteLiveCase = await fetch(`${baseUrl}/api/import-gold/cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers("sandbox"),
    });
    expect(sandboxCannotDeleteLiveCase.status).toBe(404);
    const liveCannotDeleteSandboxCase = await fetch(`${baseUrl}/api/import-gold/cases/${sandboxCase!.id}`, {
      method: "DELETE", headers: headers(),
    });
    expect(liveCannotDeleteSandboxCase.status).toBe(404);
    expect(await db.select().from(tables.auditLogsTable)
      .where(eq(tables.auditLogsTable.action, "import_gold_case_deleted"))).toHaveLength(0);

    await pool.query(`
      CREATE FUNCTION fail_import_gold_standard_delete_audit_for_test() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'import_gold_case_deleted' THEN
          RAISE EXCEPTION 'test-only forced standard deletion audit insert failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER fail_import_gold_standard_delete_audit_for_test
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_import_gold_standard_delete_audit_for_test()
    `);
    let failedDeleteStatus = 0;
    try {
      const failedDelete = await fetch(`${baseUrl}/api/import-gold/cases/${liveCase!.id}`, {
        method: "DELETE", headers: headers(),
      });
      failedDeleteStatus = failedDelete.status;
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS fail_import_gold_standard_delete_audit_for_test ON audit_logs");
      await pool.query("DROP FUNCTION IF EXISTS fail_import_gold_standard_delete_audit_for_test()");
    }
    expect(failedDeleteStatus).toBe(500);
    expect(await db.select().from(tables.importGoldCasesTable)
      .where(eq(tables.importGoldCasesTable.id, liveCase!.id))).toHaveLength(1);
    expect(await db.select().from(tables.importGoldScoresTable)
      .where(eq(tables.importGoldScoresTable.caseId, liveCase!.id))).toHaveLength(1);
    expect(await db.select().from(tables.auditLogsTable)
      .where(eq(tables.auditLogsTable.action, "import_gold_case_deleted"))).toHaveLength(0);

    const deleted = await fetch(`${baseUrl}/api/import-gold/cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers(),
    });
    expect(deleted.status).toBe(204);
    expect(await db.select().from(tables.importGoldCasesTable)
      .where(eq(tables.importGoldCasesTable.id, liveCase!.id))).toHaveLength(0);
    expect(await db.select().from(tables.importGoldScoresTable)
      .where(eq(tables.importGoldScoresTable.caseId, liveCase!.id))).toHaveLength(0);
    const deletionAudit = await db.select().from(tables.auditLogsTable)
      .where(eq(tables.auditLogsTable.action, "import_gold_case_deleted"));
    expect(deletionAudit).toHaveLength(1);
    expect(deletionAudit[0]).toMatchObject({
      scope: "live",
      actor: "inventory",
      resource: "import_gold_case",
      changes: { outcome: "success", targetId: String(liveCase!.id) },
    });
    expect(deletionAudit[0]!.changes).toEqual({
      outcome: "success",
      targetId: String(liveCase!.id),
    });
    expect(JSON.stringify(deletionAudit[0])).not.toMatch(/Synthetic input|Synthetic expected result|fieldDiffs/);
    expect(await db.select().from(tables.importGoldCasesTable)
      .where(eq(tables.importGoldCasesTable.id, sandboxCase!.id))).toHaveLength(1);
  });

  it("allows scoped metadata-only cleanup after approval withdrawal without reopening Gold Lab reads", async () => {
    process.env.IMPORT_GOLD_ENABLED = "false";
    process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = "false";
    process.env.IMPORT_GOLD_RETENTION_APPROVED = "false";
    process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS = "pending";
    process.env.IMPORT_GOLD_CLEANUP_ENABLED = "false";

    const rejectedCapture = await apply("gold-cleanup-capture-disabled-001", {
      ...change("gold-cleanup-capture-disabled"),
      goldCapture: { input: { candidates: [{ name: "Synthetic capture must stay disabled" }] } },
    });
    expect(rejectedCapture.status).toBe(404);
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(0);
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases`, { headers: headers() })).status).toBe(404);

    const [liveCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "live",
      operationId: "synthetic-cleanup-case-live-001",
      importType: "premix",
      sourceLabel: "Synthetic cleanup fixture",
      evaluatedInput: { candidates: [{ name: "SYNTHETIC_PRIVATE_INPUT" }] },
      expectedResult: { mixes: [{ name: "SYNTHETIC_PRIVATE_EXPECTED" }] },
      createdBy: "inventory",
    }).returning({ id: tables.importGoldCasesTable.id });
    const [sandboxCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "sandbox",
      operationId: "synthetic-cleanup-case-sandbox-001",
      importType: "cheese",
      sourceLabel: "Synthetic sandbox cleanup fixture",
      evaluatedInput: { recipes: [{ name: "SYNTHETIC_SANDBOX_INPUT" }] },
      expectedResult: { recipes: [{ name: "SYNTHETIC_SANDBOX_EXPECTED" }] },
      createdBy: "sandbox",
    }).returning({ id: tables.importGoldCasesTable.id });
    await db.insert(tables.importGoldScoresTable).values({
      scope: "live",
      caseId: liveCase!.id,
      provider: "local",
      status: "scored",
      accuracy: 1,
      comparedFields: 1,
      equalFields: 1,
      fieldDiffs: [{ field: "synthetic", expected: "SYNTHETIC_PRIVATE_EXPECTED", predicted: "SYNTHETIC_PRIVATE_PREDICTED" }],
    });

    process.env.IMPORT_GOLD_CLEANUP_ENABLED = "true";
    const configResponse = await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() });
    expect(configResponse.status).toBe(200);
    expect(await configResponse.json()).toMatchObject({
      enabled: false,
      cleanupEnabled: true,
      localConfigured: false,
      localAvailable: false,
      localScoringSwitchAvailable: false,
      localScoringEnabled: false,
      syntheticFixtureAvailable: false,
      geminiConfigured: false,
    });

    const listed = await fetch(`${baseUrl}/api/import-gold/cleanup-cases`, { headers: headers() });
    expect(listed.status).toBe(200);
    const listBody = await listed.json() as { cases: Array<Record<string, unknown>> };
    expect(listBody.cases).toHaveLength(1);
    expect(listBody.cases[0]).toEqual(expect.objectContaining({
      id: liveCase!.id,
      importType: "premix",
    }));
    expect(Object.keys(listBody.cases[0]!).sort()).toEqual(["createdAt", "id", "importType"]);
    expect(JSON.stringify(listBody)).not.toMatch(/SYNTHETIC_PRIVATE|sourceLabel|scores|fieldDiffs|evaluatedInput|expectedResult/);
    const retentionBeforeCleanup = await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers() });
    expect(retentionBeforeCleanup.status).toBe(200);
    const retentionBeforeRows = (await retentionBeforeCleanup.json() as {
      records: Array<{ caseId: number; status: string }>;
    }).records;
    expect(retentionBeforeRows.find((record) => record.caseId === liveCase!.id)?.status).toBe("within_limit");

    const ordinaryList = await fetch(`${baseUrl}/api/import-gold/cases`, { headers: headers() });
    expect(ordinaryList.status).toBe(404);
    const exported = await fetch(`${baseUrl}/api/import-gold/export.jsonl`, { headers: headers() });
    expect(exported.status).toBe(404);
    expect((await fetch(`${baseUrl}/api/import-gold/synthetic-review`, {
      headers: headers(),
    })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/import-gold/synthetic-apply`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ fixtureVersion: "synthetic-mix-v1", reviewed: true }),
    })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/import-gold/local-scoring`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ enabled: true }),
    })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/import-gold/cases/${liveCase!.id}/exclusion`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ excluded: true }),
    })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/import-gold/cases/${liveCase!.id}`, {
      method: "DELETE",
      headers: headers(),
    })).status).toBe(404);
    for (const provider of ["local", "gemini"] as const) {
      expect((await fetch(`${baseUrl}/api/import-gold/score`, {
        method: "POST", headers: headers(), body: JSON.stringify({ provider }),
      })).status).toBe(404);
    }
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(2);
    expect(await db.select().from(tables.importGoldScoresTable).where(eq(tables.importGoldScoresTable.caseId, liveCase!.id))).toHaveLength(1);

    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases`, { headers: headers("profiles") })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers("profiles"),
    })).status).toBe(403);
    const sandboxList = await fetch(`${baseUrl}/api/import-gold/cleanup-cases`, { headers: headers("sandbox") });
    expect(sandboxList.status).toBe(200);
    expect((await sandboxList.json() as { cases: Array<{ id: number }> }).cases.map((item) => item.id)).toEqual([sandboxCase!.id]);
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers("sandbox"),
    })).status).toBe(404);

    await db.update(tables.userRolesTable).set({ role: "operator" }).where(eq(tables.userRolesTable.userId, "inventory"));
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases`, { headers: headers() })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers(),
    })).status).toBe(403);
    expect(await db.select().from(tables.importGoldCasesTable).where(eq(tables.importGoldCasesTable.id, liveCase!.id))).toHaveLength(1);
    await db.update(tables.userRolesTable).set({ role: "manager" }).where(eq(tables.userRolesTable.userId, "inventory"));

    await pool.query(`
      CREATE FUNCTION fail_import_gold_cleanup_audit_for_test() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'import_gold_case_deleted' THEN
          RAISE EXCEPTION 'SYNTHETIC_PRIVATE forced audit INSERT INTO audit_logs SECRET_STACK_TRACE';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER fail_import_gold_cleanup_audit_for_test
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_import_gold_cleanup_audit_for_test()
    `);
    let failedCleanupStatus = 0;
    let failedCleanupContentType: string | null = null;
    let failedCleanupBody: unknown;
    try {
      const failedCleanup = await fetch(`${baseUrl}/api/import-gold/cleanup-cases/${liveCase!.id}`, {
        method: "DELETE", headers: headers(),
      });
      failedCleanupStatus = failedCleanup.status;
      failedCleanupContentType = failedCleanup.headers.get("content-type");
      failedCleanupBody = await failedCleanup.json();
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS fail_import_gold_cleanup_audit_for_test ON audit_logs");
      await pool.query("DROP FUNCTION IF EXISTS fail_import_gold_cleanup_audit_for_test()");
    }
    expect(failedCleanupStatus).toBe(500);
    expect(failedCleanupContentType).toMatch(/application\/json/);
    expect(failedCleanupBody).toEqual({
      error: "Something went wrong on the server. Our team has been notified. Please try again later.",
    });
    expect(JSON.stringify(failedCleanupBody)).not.toMatch(
      /SYNTHETIC_PRIVATE|INSERT INTO|audit_logs|SECRET_STACK_TRACE/,
    );
    expect(await db.select().from(tables.importGoldCasesTable).where(eq(tables.importGoldCasesTable.id, liveCase!.id))).toHaveLength(1);
    expect(await db.select().from(tables.importGoldScoresTable).where(eq(tables.importGoldScoresTable.caseId, liveCase!.id))).toHaveLength(1);
    expect(await db.select().from(tables.auditLogsTable)
      .where(eq(tables.auditLogsTable.action, "import_gold_case_deleted"))).toHaveLength(0);

    const deleted = await fetch(`${baseUrl}/api/import-gold/cleanup-cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers(),
    });
    expect(deleted.status).toBe(204);
    expect(await db.select().from(tables.importGoldCasesTable).where(eq(tables.importGoldCasesTable.id, liveCase!.id))).toHaveLength(0);
    expect(await db.select().from(tables.importGoldScoresTable).where(eq(tables.importGoldScoresTable.caseId, liveCase!.id))).toHaveLength(0);
    const cleanupAudit = await db.select().from(tables.auditLogsTable)
      .where(eq(tables.auditLogsTable.action, "import_gold_case_deleted"));
    expect(cleanupAudit).toHaveLength(1);
    expect(cleanupAudit[0]).toMatchObject({
      scope: "live",
      actor: "inventory",
      resource: "import_gold_case",
      changes: { outcome: "success", targetId: String(liveCase!.id) },
    });
    expect(cleanupAudit[0]!.changes).toEqual({
      outcome: "success",
      targetId: String(liveCase!.id),
    });
    expect(JSON.stringify(cleanupAudit[0])).not.toMatch(/SYNTHETIC_PRIVATE|fieldDiffs|evaluatedInput|expectedResult/);
    const retentionAfterCleanup = await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers() });
    const retentionAfterRows = (await retentionAfterCleanup.json() as {
      records: Array<{ caseId: number; status: string }>;
    }).records;
    expect(retentionAfterRows.find((record) => record.caseId === liveCase!.id)?.status)
      .toBe("verification_needed");
    const verifiedAfterCleanup = await fetch(
      `${baseUrl}/api/import-gold/retention/${liveCase!.id}/verification`,
      { method: "POST", headers: headers("qc-reviewer") },
    );
    expect(verifiedAfterCleanup.status).toBe(200);
    expect(await verifiedAfterCleanup.json()).toMatchObject({
      caseId: liveCase!.id,
      verifiedBy: "qc-reviewer",
    });

    const retry = await fetch(`${baseUrl}/api/import-gold/cleanup-cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers(),
    });
    expect(retry.status).toBe(404);
    expect(await db.select().from(tables.auditLogsTable)
      .where(eq(tables.auditLogsTable.action, "import_gold_case_deleted"))).toHaveLength(1);
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases/0`, {
      method: "DELETE", headers: headers(),
    })).status).toBe(400);

    process.env.IMPORT_GOLD_CLEANUP_ENABLED = "false";
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases`, { headers: headers() })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/import-gold/cleanup-cases/${sandboxCase!.id}`, {
      method: "DELETE", headers: headers(),
    })).status).toBe(404);
    expect(await db.select().from(tables.importGoldCasesTable).where(eq(tables.importGoldCasesTable.id, sandboxCase!.id))).toHaveLength(1);
  });

  it("tracks scoped deadlines and records manual deletion verification for either manager role", async () => {
    const capturedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const [liveCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "live",
      operationId: "retention-live-case",
      importType: "spec",
      sourceLabel: "Synthetic fixture",
      evaluatedInput: { synthetic: true },
      expectedResult: { synthetic: true },
      createdAt: capturedAt,
    }).returning({ id: tables.importGoldCasesTable.id });
    const [sandboxCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "sandbox",
      operationId: "retention-sandbox-case",
      importType: "spec",
      sourceLabel: "Synthetic fixture",
      evaluatedInput: { synthetic: true },
      expectedResult: { synthetic: true },
      createdAt: capturedAt,
    }).returning({ id: tables.importGoldCasesTable.id });
    const [secondLiveCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "live",
      operationId: "retention-live-case-second",
      importType: "spec",
      sourceLabel: "Synthetic fixture",
      evaluatedInput: { synthetic: true },
      expectedResult: { synthetic: true },
      createdAt: capturedAt,
    }).returning({ id: tables.importGoldCasesTable.id });
    const dueSoonCapturedAt = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000);
    const [dueSoonLiveCase] = await db.insert(tables.importGoldCasesTable).values({
      scope: "live",
      operationId: "retention-live-case-due-soon",
      importType: "spec",
      sourceLabel: "Synthetic fixture",
      evaluatedInput: { synthetic: true },
      expectedResult: { synthetic: true },
      createdAt: dueSoonCapturedAt,
    }).returning({ id: tables.importGoldCasesTable.id });
    expect(liveCase).toBeDefined();
    expect(sandboxCase).toBeDefined();
    expect(secondLiveCase).toBeDefined();
    expect(dueSoonLiveCase).toBeDefined();

    const livePage = await fetch(`${baseUrl}/api/import-gold/retention?limit=1`, { headers: headers() });
    expect(livePage.status).toBe(200);
    const firstPage = await livePage.json() as {
      records: Array<{ caseId: number; capturedAt: string; deleteBy: string; status: string; verifiedAt: string | null }>;
      hasMore: boolean;
      nextOffset: number | null;
    };
    expect(firstPage.records).toMatchObject([{
      caseId: liveCase!.id,
      capturedAt: capturedAt.toISOString(),
      deleteBy: new Date(capturedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: "overdue",
      verifiedAt: null,
    }]);
    expect(firstPage.records[0]).not.toHaveProperty("evaluatedInput");
    expect(firstPage.records[0]).not.toHaveProperty("expectedResult");
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextOffset).toBe(1);
    const secondLivePage = await fetch(`${baseUrl}/api/import-gold/retention?limit=1&offset=1`, { headers: headers() });
    expect((await secondLivePage.json() as { records: Array<{ caseId: number }> }).records)
      .toMatchObject([{ caseId: secondLiveCase!.id }]);

    // This matching record sorts after the first unfiltered page, but status
    // filtering must happen before pagination so it is still returned at offset 0.
    const dueSoonPage = await fetch(
      `${baseUrl}/api/import-gold/retention?limit=1&status=due_soon`,
      { headers: headers() },
    );
    expect(dueSoonPage.status).toBe(200);
    expect(await dueSoonPage.json()).toMatchObject({
      records: [{ caseId: dueSoonLiveCase!.id, status: "due_soon" }],
      hasMore: false,
      nextOffset: null,
    });
    const qcFilteredPage = await fetch(
      `${baseUrl}/api/import-gold/retention?limit=1&status=overdue`,
      { headers: headers("qc-reviewer") },
    );
    expect(qcFilteredPage.status).toBe(200);
    expect((await qcFilteredPage.json() as { records: Array<{ caseId: number; status: string }> }).records)
      .toMatchObject([{ caseId: liveCase!.id, status: "overdue" }]);
    expect((await fetch(`${baseUrl}/api/import-gold/retention?status=not-a-retention-status`, {
      headers: headers(),
    })).status).toBe(400);

    const sandboxPage = await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers("sandbox") });
    expect((await sandboxPage.json() as { records: Array<{ caseId: number }> }).records)
      .toMatchObject([{ caseId: sandboxCase!.id }]);
    const sandboxFilteredPage = await fetch(
      `${baseUrl}/api/import-gold/retention?status=overdue`,
      { headers: headers("sandbox") },
    );
    expect((await sandboxFilteredPage.json() as { records: Array<{ caseId: number }> }).records)
      .toMatchObject([{ caseId: sandboxCase!.id }]);
    expect((await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers("qc-reviewer") })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers("profiles") })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/import-gold/retention?limit=101`, { headers: headers() })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/import-gold/retention?offset=-1`, { headers: headers() })).status).toBe(400);

    const wrongScope = await fetch(`${baseUrl}/api/import-gold/retention/${liveCase!.id}/verification`, {
      method: "POST", headers: headers("sandbox"),
    });
    expect(wrongScope.status).toBe(404);
    const cannotVerifyExistingCase = await fetch(`${baseUrl}/api/import-gold/retention/${liveCase!.id}/verification`, {
      method: "POST", headers: headers("qc-reviewer"),
    });
    expect(cannotVerifyExistingCase.status).toBe(409);
    await db.insert(tables.importGoldScoresTable).values({
      scope: "live",
      caseId: liveCase!.id,
      provider: "local",
      status: "scored",
      accuracy: 1,
      comparedFields: 1,
      equalFields: 1,
      fieldDiffs: [],
    });

    const deleted = await fetch(`${baseUrl}/api/import-gold/cases/${liveCase!.id}`, {
      method: "DELETE", headers: headers(),
    });
    expect(deleted.status).toBe(204);
    expect(await db.select().from(tables.importGoldScoresTable)
      .where(eq(tables.importGoldScoresTable.caseId, liveCase!.id))).toHaveLength(0);
    const pending = await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers() });
    const pendingRecords = (await pending.json() as { records: Array<{ caseId: number; status: string }> }).records;
    expect(pendingRecords.find((record) => record.caseId === liveCase!.id))
      .toMatchObject({ caseId: liveCase!.id, status: "verification_needed" });

    const verified = await fetch(`${baseUrl}/api/import-gold/retention/${liveCase!.id}/verification`, {
      method: "POST", headers: headers("qc-reviewer"),
    });
    expect(verified.status).toBe(200);
    const verification = await verified.json() as { caseId: number; verifiedAt: string; verifiedBy: string };
    expect(verification).toMatchObject({ caseId: liveCase!.id, verifiedBy: "qc-reviewer" });
    const afterReload = await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers() });
    const reloadedRecords = (await afterReload.json() as {
      records: Array<{ caseId: number; status: string; verifiedAt: string | null }>;
    }).records;
    expect(reloadedRecords.find((record) => record.caseId === liveCase!.id))
      .toMatchObject({ caseId: liveCase!.id, status: "verified", verifiedAt: verification.verifiedAt });

    const idempotentRetry = await fetch(`${baseUrl}/api/import-gold/retention/${liveCase!.id}/verification`, {
      method: "POST", headers: headers(),
    });
    expect(await idempotentRetry.json()).toEqual(verification);
    expect((await fetch(`${baseUrl}/api/import-gold/retention/${liveCase!.id}/verification`, {
      method: "POST", headers: headers("profiles"),
    })).status).toBe(403);

    const secondDeleted = await fetch(`${baseUrl}/api/import-gold/cases/${secondLiveCase!.id}`, {
      method: "DELETE", headers: headers(),
    });
    expect(secondDeleted.status).toBe(204);
    const managerVerification = await fetch(`${baseUrl}/api/import-gold/retention/${secondLiveCase!.id}/verification`, {
      method: "POST", headers: headers("inventory-peer"),
    });
    expect(managerVerification.status).toBe(200);
    expect(await managerVerification.json()).toMatchObject({
      caseId: secondLiveCase!.id,
      verifiedBy: "inventory-peer",
    });

    process.env.IMPORT_GOLD_ENABLED = "false";
    process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = "false";
    process.env.IMPORT_GOLD_RETENTION_APPROVED = "false";
    const retainedAfterGateWithdrawal = await fetch(`${baseUrl}/api/import-gold/retention`, { headers: headers() });
    expect(retainedAfterGateWithdrawal.status).toBe(200);
    expect((await retainedAfterGateWithdrawal.json() as { records: Array<{ caseId: number }> }).records)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ caseId: liveCase!.id }),
        expect.objectContaining({ caseId: secondLiveCase!.id }),
      ]));
  });

  it("keeps reminder-relevant retention rows ordered across pages before verified records", async () => {
    const now = Date.now();
    const caseRows = await db.insert(tables.importGoldCasesTable).values([
      {
        scope: "live",
        operationId: "retention-order-overdue",
        importType: "spec",
        sourceLabel: "Synthetic fixture",
        evaluatedInput: { synthetic: true },
        expectedResult: { synthetic: true },
        createdAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
      },
      {
        scope: "live",
        operationId: "retention-order-due-soon",
        importType: "spec",
        sourceLabel: "Synthetic fixture",
        evaluatedInput: { synthetic: true },
        expectedResult: { synthetic: true },
        createdAt: new Date(now - 28 * 24 * 60 * 60 * 1000),
      },
      {
        scope: "live",
        operationId: "retention-order-within-limit",
        importType: "spec",
        sourceLabel: "Synthetic fixture",
        evaluatedInput: { synthetic: true },
        expectedResult: { synthetic: true },
        createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
      },
    ]).returning({ id: tables.importGoldCasesTable.id });
    const [overdueCase, dueSoonCase, withinLimitCase] = caseRows;
    expect(overdueCase).toBeDefined();
    expect(dueSoonCase).toBeDefined();
    expect(withinLimitCase).toBeDefined();

    const verificationNeededCaseId = 900001;
    const verifiedCaseId = 900002;
    await db.insert(tables.importGoldRetentionTable).values([
      {
        scope: "live",
        caseId: verificationNeededCaseId,
        capturedAt: new Date(now - 26 * 24 * 60 * 60 * 1000),
        deleteBy: new Date(now + 4 * 24 * 60 * 60 * 1000),
      },
      {
        scope: "live",
        caseId: verifiedCaseId,
        capturedAt: new Date(now - 50 * 24 * 60 * 60 * 1000),
        deleteBy: new Date(now - 20 * 24 * 60 * 60 * 1000),
        verifiedAt: new Date(now - 24 * 60 * 60 * 1000),
        verifiedBy: "synthetic-reviewer",
      },
    ]);

    const sandboxCase = await db.insert(tables.importGoldCasesTable).values({
      scope: "sandbox",
      operationId: "retention-order-sandbox",
      importType: "spec",
      sourceLabel: "Synthetic fixture",
      evaluatedInput: { synthetic: true },
      expectedResult: { synthetic: true },
      createdAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
    }).returning({ id: tables.importGoldCasesTable.id });

    const managerPages: Array<{
      records: Array<{ caseId: number; status: string; verifiedAt: string | null; verifiedBy: string | null }>;
      hasMore: boolean;
      nextOffset: number | null;
    }> = [];
    for (const offset of [0, 2, 4]) {
      const response = await fetch(`${baseUrl}/api/import-gold/retention?limit=2&offset=${offset}`, {
        headers: headers(),
      });
      expect(response.status).toBe(200);
      managerPages.push(await response.json() as typeof managerPages[number]);
    }

    expect(managerPages.map((page) => page.records.map((record) => record.status))).toEqual([
      ["overdue", "due_soon"],
      ["verification_needed", "within_limit"],
      ["verified"],
    ]);
    expect(managerPages.map((page) => [page.hasMore, page.nextOffset])).toEqual([
      [true, 2],
      [true, 4],
      [false, null],
    ]);
    expect(managerPages.flatMap((page) => page.records.map((record) => record.caseId))).toEqual([
      overdueCase!.id,
      dueSoonCase!.id,
      verificationNeededCaseId,
      withinLimitCase!.id,
      verifiedCaseId,
    ]);
    expect(managerPages.flatMap((page) => page.records)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        caseId: verifiedCaseId,
        verifiedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        verifiedBy: "synthetic-reviewer",
      }),
    ]));
    for (const record of managerPages.flatMap((page) => page.records)) {
      expect(record).not.toHaveProperty("evaluatedInput");
      expect(record).not.toHaveProperty("expectedResult");
    }

    const qcResponse = await fetch(`${baseUrl}/api/import-gold/retention?limit=2&offset=0`, {
      headers: headers("qc-reviewer"),
    });
    expect(qcResponse.status).toBe(200);
    expect(await qcResponse.json()).toEqual(managerPages[0]);

    const sandboxResponse = await fetch(`${baseUrl}/api/import-gold/retention`, {
      headers: headers("sandbox"),
    });
    expect(sandboxResponse.status).toBe(200);
    expect((await sandboxResponse.json() as { records: Array<{ caseId: number; status: string }> }).records)
      .toMatchObject([{ caseId: sandboxCase[0]!.id, status: "overdue" }]);
  });

  it("filters every retention status before pagination without exposing payloads or crossing scope and role boundaries", async () => {
    const statuses = [
      "within_limit", "due_soon", "overdue", "deletion_incomplete", "verification_needed", "verified",
    ] as const;
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expectedIds = new Map<string, number[]>();
    for (const status of statuses) {
      const ids: number[] = [];
      for (let index = 0; index < 2; index += 1) {
        const deleteBy = new Date(now + (status === "within_limit" ? 14 : status === "due_soon" ? 3 : -1) * day);
        const capturedAt = new Date(deleteBy.getTime() - 30 * day);
        // A case in another scope must not count as present for the live
        // register. This also lets us model orphaned scoped score history
        // without dropping the score-to-case foreign key.
        const caseScope = ["deletion_incomplete", "verification_needed"].includes(status) ? "sandbox" : "live";
        const [caseRow] = await db.insert(tables.importGoldCasesTable).values({
          scope: caseScope,
          operationId: `synthetic-filter-${status}-${index}`,
          importType: "premix",
          sourceLabel: "SYNTHETIC_PRIVATE_LABEL",
          evaluatedInput: { privateFixture: "SYNTHETIC_PRIVATE_INPUT" },
          expectedResult: { privateFixture: "SYNTHETIC_PRIVATE_RESULT" },
          createdAt: capturedAt,
        }).returning({ id: tables.importGoldCasesTable.id });
        ids.push(caseRow!.id);
        await db.insert(tables.importGoldRetentionTable).values({
          scope: "live",
          caseId: caseRow!.id,
          capturedAt,
          deleteBy,
          verifiedAt: status === "verified" ? new Date(now) : null,
          verifiedBy: status === "verified" ? "synthetic-manager" : null,
        });
        if (status === "deletion_incomplete") {
          await db.insert(tables.importGoldScoresTable).values(["local", "gemini"].map((provider) => ({
            scope: "live", caseId: caseRow!.id, provider, status: "scored",
            fieldDiffs: [{ privateFixture: "SYNTHETIC_PRIVATE_SCORE" }],
          })));
        }
      }
      expectedIds.set(status, ids);
    }
    for (const status of statuses) {
      const first = await fetch(`${baseUrl}/api/import-gold/retention?status=${status}&limit=1`, {
        headers: headers(),
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { records: Array<{ caseId: number; status: string }>; hasMore: boolean; nextOffset: number | null };
      expect(firstBody.records).toHaveLength(1);
      expect(firstBody.records[0]).toMatchObject({ caseId: expectedIds.get(status)![0], status });
      expect(Object.keys(firstBody.records[0]!).sort())
        .toEqual(["capturedAt", "caseId", "deleteBy", "status", "verifiedAt", "verifiedBy"]);
      expect(JSON.stringify(firstBody)).not.toMatch(/SYNTHETIC_PRIVATE|sourceLabel|fieldDiffs|evaluatedInput|expectedResult/);
      expect(firstBody.hasMore).toBe(true);
      expect(firstBody.nextOffset).toBe(1);
      const next = await fetch(`${baseUrl}/api/import-gold/retention?status=${status}&limit=1&offset=1`, {
        headers: headers("qc-reviewer"),
      });
      expect(next.status).toBe(200);
      const nextBody = await next.json() as typeof firstBody;
      expect(nextBody.records).toHaveLength(1);
      expect(nextBody.records[0]).toMatchObject({ caseId: expectedIds.get(status)![1], status });
      expect(nextBody.hasMore).toBe(false);
      expect(nextBody.nextOffset).toBeNull();
      const empty = await fetch(`${baseUrl}/api/import-gold/retention?status=${status}&limit=1&offset=2`, {
        headers: headers(),
      });
      expect(await empty.json()).toEqual({ records: [], hasMore: false, nextOffset: null });
    }
    const sandbox = await fetch(`${baseUrl}/api/import-gold/retention?status=verified`, { headers: headers("sandbox") });
    expect(await sandbox.json()).toEqual({ records: [], hasMore: false, nextOffset: null });
    expect((await fetch(`${baseUrl}/api/import-gold/retention?status=overdue`, { headers: headers("profiles") })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/import-gold/retention?status=overdue`)).status).toBe(401);
    for (const query of ["status=unknown", "status=", "status=overdue&status=due_soon"]) {
      const invalid = await fetch(`${baseUrl}/api/import-gold/retention?${query}`, { headers: headers() });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "Invalid retention status" });
    }
  });

  it("gates capture and manager controls, bounds input, and records provider errors without failing the batch", async () => {
    const unauthorized = await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers("profiles") });
    expect(unauthorized.status).toBe(403);
    expect((await apply("gold-capture-not-manager-001", {
      ...change("gold-not-manager"),
      goldCapture: { input: { candidates: [] } },
    }, "profiles")).status).toBe(403);

    process.env.IMPORT_GOLD_ENABLED = "false";
    expect((await apply("gold-capture-disabled-001", {
      ...change("gold-disabled"),
      goldCapture: { input: { candidates: [] } },
    })).status).toBe(404);
    process.env.IMPORT_GOLD_ENABLED = "true";
    process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = "false";
    expect((await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() })).status).toBe(200);
    expect((await (await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() })).json() as { enabled: boolean }).enabled).toBe(false);
    process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = "true";

    process.env.IMPORT_GOLD_RETENTION_APPROVED = "false";
    expect(((await (await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() })).json()) as { enabled: boolean }).enabled).toBe(false);
    process.env.IMPORT_GOLD_RETENTION_APPROVED = "true";
    const captureWhileApprovalMissing = async (operationId: string) => apply(operationId, {
      ...change(operationId),
      goldCapture: { input: { candidates: [{ name: "Synthetic case" }] } },
    });
    process.env.IMPORT_GOLD_APPROVAL_RECORD_REF = "  ";
    expect(((await (await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() })).json()) as { enabled: boolean }).enabled).toBe(false);
    expect((await captureWhileApprovalMissing("gold-capture-no-approval-ref-001")).status).toBe(404);
    process.env.IMPORT_GOLD_APPROVAL_RECORD_REF = "synthetic-approval";
    process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS = "pending";
    expect(((await (await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() })).json()) as { enabled: boolean }).enabled).toBe(false);
    expect((await captureWhileApprovalMissing("gold-capture-pending-privacy-001")).status).toBe(404);
    process.env.IMPORT_GOLD_PRIVACY_REVIEW_STATUS = "not_required";
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(0);

    const oversized = await apply("gold-capture-oversized-001", {
      ...change("gold-oversized"),
      goldCapture: { input: { candidates: [{ detail: "x".repeat(101 * 1024) }] } },
    });
    expect(oversized.status).toBe(400);
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(0);
    const sensitiveExpectedBody = change("gold-sensitive-expected");
    (sensitiveExpectedBody.changes.mixes.upsert[0] as { notes: string }).notes = "contact owner@example.com";
    const sensitiveExpected = await apply("gold-capture-sensitive-expected-001", {
      ...sensitiveExpectedBody,
      goldCapture: { input: { candidates: [{ name: "Safe reviewed input" }] } },
    });
    expect(sensitiveExpected.status).toBe(422);
    expect(await db.select().from(tables.importGoldCasesTable)).toHaveLength(0);
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);

    const saved = await apply("gold-soft-error-0001", {
      ...change("gold-soft-error"),
      goldCapture: { input: { candidates: [{ name: "Provider outage case" }] } },
    });
    const secondSaved = await apply("gold-score-success-0001", {
      ...change("gold-score-success"),
      goldCapture: { input: { candidates: [{ name: "Score normally case" }] } },
    });
    const cases = await db.select({ id: tables.importGoldCasesTable.id, evaluatedInput: tables.importGoldCasesTable.evaluatedInput })
      .from(tables.importGoldCasesTable).orderBy(tables.importGoldCasesTable.id);
    process.env.IMPORT_GOLD_LOCAL_ENABLED = "true";
    expect((await enableLocalGoldScoring()).status).toBe(200);
    route.setImportGoldProviderForTest(async (_provider, input) => {
      const candidate = (input.candidates as Array<{ name?: string }>)[0];
      if (candidate?.name === "Provider outage case") throw new Error("provider_unavailable");
      return { mixes: [{ name: "Model prediction" }] };
    });
    const scored = await fetch(`${baseUrl}/api/import-gold/score`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ provider: "local", caseIds: cases.map(({ id }) => id) }),
    });
    expect(saved.status).toBe(200);
    expect(secondSaved.status).toBe(200);
    expect(scored.status).toBe(200);
    const response = await scored.json() as { scoredCount: number; errorCount: number; results: Array<{ status: string; errorCode?: string; fieldDiffs?: unknown[] }> };
    expect(response.scoredCount).toBe(1);
    expect(response.errorCount).toBe(1);
    expect(response.results.find((result) => result.status === "error")).toMatchObject({ status: "error", errorCode: "provider_unavailable" });
    expect(response.results.find((result) => result.status === "scored")?.fieldDiffs?.length).toBeGreaterThan(0);
    expect(await db.select().from(tables.importGoldScoresTable)).toHaveLength(2);
    const appliedMixes = await db.select().from(tables.mixesTable);
    expect(appliedMixes).toHaveLength(2);
    expect(appliedMixes.some((mix) => mix.name === "Model prediction")).toBe(false);

    const successfulCaseId = cases.find(({ evaluatedInput }) =>
      (evaluatedInput.candidates as Array<{ name?: string }>)[0]?.name === "Score normally case")!.id;
    route.setImportGoldProviderForTest(async () => ({ mixes: [{ name: "Unexpected shape" }], unexpected: true }));
    const invalidOutput = await fetch(`${baseUrl}/api/import-gold/score`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ provider: "local", caseIds: [successfulCaseId] }),
    });
    expect(invalidOutput.status).toBe(200);
    expect(await invalidOutput.json()).toMatchObject({
      errorCount: 1,
      results: [{ status: "error", errorCode: "invalid_output" }],
    });
    expect(await db.select().from(tables.importGoldScoresTable)).toHaveLength(3);
  });

  it("keeps local scoring and the fixed synthetic review separate from real-source approval", async () => {
    process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = "false";
    process.env.IMPORT_GOLD_LOCAL_ENABLED = "true";
    const configResponse = await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() });
    expect(configResponse.status).toBe(200);
    expect(await configResponse.json()).toMatchObject({
      enabled: false,
      localConfigured: true,
      localScoringSwitchAvailable: true,
      localScoringEnabled: false,
      syntheticFixtureAvailable: true,
    });

    expect((await enableLocalGoldScoring(true, "profiles")).status).toBe(403);
    const reviewResponse = await fetch(`${baseUrl}/api/import-gold/synthetic-review`, { headers: headers() });
    expect(reviewResponse.status).toBe(200);
    const review = await reviewResponse.json() as {
      fixtureVersion: string; input: Record<string, unknown>; expectedResult: Record<string, unknown>;
      applyEffect: string;
    };
    expect(review).toMatchObject({
      fixtureVersion: "synthetic-mix-v1",
      applyEffect: expect.stringContaining("does not change recipes, inventory"),
      input: { candidates: [{ name: "Synthetic Sample Mix" }] },
      expectedResult: { mixes: [{ name: "Synthetic Sample Mix" }] },
    });
    expect((await fetch(`${baseUrl}/api/import-gold/synthetic-apply`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ fixtureVersion: review.fixtureVersion, reviewed: false }),
    })).status).toBe(400);
    const applyBody = { fixtureVersion: review.fixtureVersion, reviewed: true };
    const applied = await fetch(`${baseUrl}/api/import-gold/synthetic-apply`, {
      method: "POST", headers: headers(), body: JSON.stringify(applyBody),
    });
    expect(applied.status).toBe(201);
    const first = await applied.json() as { caseId: number; created: boolean };
    expect(first.created).toBe(true);
    const duplicate = await fetch(`${baseUrl}/api/import-gold/synthetic-apply`, {
      method: "POST", headers: headers(), body: JSON.stringify(applyBody),
    });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ caseId: first.caseId, created: false });
    expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    expect((await db.select().from(tables.importGoldCasesTable)).map((row) => row.sourceLabel))
      .toEqual(["Synthetic local scoring fixture"]);

    expect((await fetch(`${baseUrl}/api/import-gold/score`, {
      method: "POST", headers: headers(), body: JSON.stringify({ provider: "local" }),
    })).status).toBe(403);
    expect((await enableLocalGoldScoring()).status).toBe(200);
    const managerConfig = await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() });
    expect(await managerConfig.json()).toMatchObject({
      enabled: false,
      localScoringSwitchAvailable: true,
      localScoringEnabled: true,
      syntheticFixtureAvailable: true,
    });
    const peerDeviceConfig = await fetch(`${baseUrl}/api/import-gold/config`, {
      headers: headers("inventory-peer"),
    });
    expect(await peerDeviceConfig.json()).toMatchObject({
      localScoringSwitchAvailable: true,
      localScoringEnabled: true,
      syntheticFixtureAvailable: true,
    });
    route.setImportGoldProviderForTest(async () => review.expectedResult);
    const scored = await fetch(`${baseUrl}/api/import-gold/score`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ provider: "local", caseIds: [first.caseId] }),
    });
    expect(scored.status).toBe(200);
    expect(await scored.json()).toMatchObject({ scoredCount: 1, errorCount: 0 });
    expect(await db.select().from(tables.importGoldScoresTable)).toMatchObject([
      { caseId: first.caseId, provider: "local", status: "scored" },
    ]);

    const realCapture = await apply("gold-real-source-stays-blocked-001", {
      ...change("gold-real-source-stays-blocked"),
      goldCapture: { input: { candidates: [{ name: "not permitted" }] } },
    });
    expect(realCapture.status).toBe(404);
    expect((await db.select().from(tables.importGoldCasesTable)).map((row) => row.sourceLabel))
      .toEqual(["Synthetic local scoring fixture"]);
    expect((await fetch(`${baseUrl}/api/import-gold/score`, {
      method: "POST", headers: headers(), body: JSON.stringify({ provider: "gemini" }),
    })).status).toBe(404);

    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(((await (await fetch(`${baseUrl}/api/import-gold/config`, { headers: headers() })).json()) as {
        localScoringSwitchAvailable: boolean; localScoringEnabled: boolean; syntheticFixtureAvailable: boolean;
      })).toMatchObject({ localScoringSwitchAvailable: false, localScoringEnabled: false, syntheticFixtureAvailable: false });
      expect((await enableLocalGoldScoring(false)).status).toBe(404);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("uses the bounded local JSON contract and retains a retry after provider failure", async () => {
    process.env.IMPORT_GOLD_ENABLED = "false";
    process.env.IMPORT_GOLD_SOURCE_USE_APPROVED = "false";
    process.env.IMPORT_GOLD_RETENTION_APPROVED = "false";
    process.env.IMPORT_GOLD_LOCAL_ENABLED = "true";
    route.setImportGoldProviderForTest();

    let expectedResult: Record<string, unknown> | undefined;
    const evaluatorRequests: Array<{
      hasResponseFormat: boolean;
      model: unknown;
      maxTokens: unknown;
      stream: unknown;
      roles: unknown[];
    }> = [];
    const evaluator = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
          response.statusCode = 404;
          response.end();
          return;
        }
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body) as Record<string, unknown>;
        } catch {
          response.statusCode = 400;
          response.end();
          return;
        }
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        evaluatorRequests.push({
          hasResponseFormat: Object.hasOwn(payload, "response_format"),
          model: payload.model,
          maxTokens: payload.max_tokens,
          stream: payload.stream,
          roles: messages.map((message) =>
            message && typeof message === "object" && "role" in message
              ? (message as { role: unknown }).role
              : null,
          ),
        });
        response.setHeader("content-type", "application/json");
        if (Object.hasOwn(payload, "response_format")) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: { type: "invalid_request_error" } }));
          return;
        }
        if (evaluatorRequests.length === 1) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: { type: "provider_unavailable" } }));
          return;
        }
        response.statusCode = 200;
        const prediction = JSON.stringify(expectedResult);
        response.end(JSON.stringify({
          choices: [{
            message: {
              content: evaluatorRequests.length === 2
                ? `<think>synthetic wrapper</think>\n${prediction}`
                : `${prediction}\n${prediction}`,
            },
          }],
        }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      evaluator.once("error", reject);
      evaluator.listen(0, "127.0.0.1", resolve);
    });
    const evaluatorAddress = evaluator.address() as AddressInfo;
    process.env.IMPORT_GOLD_LOCAL_BASE_URL = `http://127.0.0.1:${evaluatorAddress.port}/v1`;

    try {
      const reviewResponse = await fetch(`${baseUrl}/api/import-gold/synthetic-review`, {
        headers: headers(),
      });
      expect(reviewResponse.status).toBe(200);
      const review = await reviewResponse.json() as {
        fixtureVersion: string;
        expectedResult: Record<string, unknown>;
      };
      expectedResult = review.expectedResult;
      const applied = await fetch(`${baseUrl}/api/import-gold/synthetic-apply`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ fixtureVersion: review.fixtureVersion, reviewed: true }),
      });
      expect(applied.status).toBe(201);
      const { caseId } = await applied.json() as { caseId: number };
      expect((await enableLocalGoldScoring()).status).toBe(200);

      const scoreSyntheticCase = () => fetch(`${baseUrl}/api/import-gold/score`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ provider: "local", caseIds: [caseId] }),
      });
      const failedAttempt = await scoreSyntheticCase();
      expect(failedAttempt.status).toBe(200);
      expect(await failedAttempt.json()).toMatchObject({
        scoredCount: 0,
        errorCount: 1,
        results: [{ caseId, provider: "local", status: "error", errorCode: "provider_unavailable" }],
      });

      const retry = await scoreSyntheticCase();
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({
        scoredCount: 1,
        errorCount: 0,
        results: [{ caseId, provider: "local", status: "scored", accuracy: 100 }],
      });
      const ambiguousOutput = await scoreSyntheticCase();
      expect(ambiguousOutput.status).toBe(200);
      expect(await ambiguousOutput.json()).toMatchObject({
        scoredCount: 0,
        errorCount: 1,
        results: [{ caseId, provider: "local", status: "error", errorCode: "invalid_output" }],
      });
      expect(evaluatorRequests).toHaveLength(3);
      expect(evaluatorRequests.every((request) =>
        request.hasResponseFormat === false &&
        request.model === "qwen3.5-9b-q3_k_m" &&
        request.maxTokens === 256 &&
        request.stream === false &&
        JSON.stringify(request.roles) === JSON.stringify(["system", "user"]),
      )).toBe(true);
      const persistedScores = await db.select({
        provider: tables.importGoldScoresTable.provider,
        status: tables.importGoldScoresTable.status,
        errorCode: tables.importGoldScoresTable.errorCode,
      }).from(tables.importGoldScoresTable)
        .where(eq(tables.importGoldScoresTable.caseId, caseId))
        .orderBy(tables.importGoldScoresTable.id);
      expect(persistedScores).toEqual([
        { provider: "local", status: "error", errorCode: "provider_unavailable" },
        { provider: "local", status: "scored", errorCode: null },
        { provider: "local", status: "error", errorCode: "invalid_output" },
      ]);
      expect(await db.select().from(tables.mixesTable)).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => evaluator.close(() => resolve()));
    }
  });

  it("compares nested values by field without mutating the applied result", () => {
    const comparison = route.compareImportGoldFields(
      { recipes: [{ name: "A", rows: [{ ingredient: "Salt", lbs: 1 }] }] },
      { recipes: [{ name: "A", rows: [{ ingredient: "Salt", lbs: 2 }] }] },
    );
    expect(comparison.comparedFields).toBe(3);
    expect(comparison.equalFields).toBe(2);
    expect(comparison.accuracy).toBeCloseTo(66.67, 1);
    expect(comparison.fieldDiffs).toEqual([
      { field: "recipes[0].rows[0].lbs", expected: 1, predicted: 2 },
    ]);
  });
});
