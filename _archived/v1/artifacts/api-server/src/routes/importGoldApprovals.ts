import { Router, type IRouter } from "express";
import { and, desc, eq, gt, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db, importGoldApprovalsTable as approvals } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { completeStoredGoldApproval, goldApprovalInput } from "../lib/importGoldApproval";
import { writeAuditEvent } from "./auditLogs";
import { requireGoldRetentionCapability, requireGoldRetentionRole } from "../lib/importGoldAccess";

// Absolute routes and direct gates remain inspectable by the mutation inventory.
const router: IRouter = Router();

router.get("/import-gold/approvals", requireGoldRetentionCapability, requireGoldRetentionRole, async (req, res) => {
  const before = req.query.before === undefined ? undefined : Number(req.query.before);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) {
    res.status(400).json({ error: "Invalid approval cursor" }); return;
  }
  const recordRef = req.query.recordRef;
  if (recordRef !== undefined && (typeof recordRef !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(recordRef))) {
    res.status(400).json({ error: "Enter an exact opaque approval reference, not a name, address or document." });
    return;
  }
  const scope = currentScope();
  const now = new Date();
  const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const [rows, [expiry]] = await Promise.all([
    db.select().from(approvals).where(and(
      eq(approvals.scope, scope),
      before === undefined ? undefined : lt(approvals.id, before),
      recordRef === undefined ? undefined : eq(approvals.recordRef, recordRef),
    )).orderBy(desc(approvals.id)).limit(51),
    db.select({ count: sql<number>`count(*)::integer` }).from(approvals).where(and(
      eq(approvals.scope, scope), isNotNull(approvals.verifiedAt),
      isNull(approvals.revokedAt), gt(approvals.validUntil, now), lte(approvals.validUntil, dueAt),
    )),
  ]);
  if (!expiry || !Number.isSafeInteger(expiry.count) || expiry.count < 0) {
    throw new Error("Approval-expiry aggregate unavailable");
  }
  const page = rows.slice(0, 50);
  res.json({
    approvals: page, nextBefore: rows.length > 50 ? page[49]!.id : null,
    expiryReminders: { windowDays: 7, expiringCount: expiry.count, asOf: now.toISOString() },
  });
});

router.post("/import-gold/approvals", requireGoldRetentionCapability, requireGoldRetentionRole, async (req, res) => {
  const parsed = goldApprovalInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete approval metadata with opaque references and valid dates is required" }); return;
  }
  const input = parsed.data;
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(approvals).values({
      ...input, scope: currentScope(), createdBy: req.userId!,
      ownerApprovedAt: new Date(input.ownerApprovedAt),
      privacyReviewedAt: new Date(input.privacyReviewedAt), validUntil: new Date(input.validUntil),
    }).onConflictDoNothing().returning();
    if (created) await writeAuditEvent(tx, {
      action: "import_gold_approval_created", resource: "import_gold_approval",
      changes: { outcome: "success", targetId: String(created.id) },
    });
    return created;
  });
  if (!row) { res.status(409).json({ error: "Approval reference already exists in this scope" }); return; }
  res.status(201).json({ approval: row });
});

for (const operation of ["verification", "revocation"] as const) {
  router.post(`/import-gold/approvals/:id/${operation}`, requireGoldRetentionCapability, requireGoldRetentionRole, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || !req.body ||
        Object.keys(req.body).join(",") !== "reviewed" || req.body.reviewed !== true) {
      res.status(400).json({ error: "A valid approval identity and explicit reviewed confirmation are required" }); return;
    }
    const result = await db.transaction<{ status: number; error: string } | { approval: typeof approvals.$inferSelect }>(async (tx) => {
      const [row] = await tx.select().from(approvals).where(and(
        eq(approvals.id, id), eq(approvals.scope, currentScope()),
      )).for("update");
      if (!row) return { status: 404, error: "Approval record not found in this scope" } as const;
      if (operation === "verification" && (row.revokedAt || row.validUntil.getTime() <= Date.now() ||
          !completeStoredGoldApproval(row))) {
        return { status: 409, error: "Revoked, expired or incomplete approval cannot be verified" } as const;
      }
      if (operation === "verification" ? row.verifiedAt : row.revokedAt) return { approval: row };
      const [updated] = await tx.update(approvals).set(operation === "verification"
        ? { verifiedAt: new Date(), verifiedBy: req.userId! }
        : { revokedAt: new Date(), revokedBy: req.userId! },
      ).where(and(eq(approvals.id, id), eq(approvals.scope, currentScope()), isNull(approvals.revokedAt))).returning();
      await writeAuditEvent(tx, {
        action: operation === "verification" ? "import_gold_approval_verified" : "import_gold_approval_revoked",
        resource: "import_gold_approval", changes: { outcome: "success", targetId: String(id) },
      });
      return { approval: updated! };
    });
    if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result);
  });
}

export default router;
