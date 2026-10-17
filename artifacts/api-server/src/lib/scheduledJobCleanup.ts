import { createHash } from "node:crypto";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  min,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  scheduledJobCleanupPlansTable,
  serverJobAttemptsTable,
  serverJobsTable,
} from "@workspace/db";

const PLAN_TTL_MS = 15 * 60_000;
const MAX_GROUPS = 10;
const MAX_MEMBERS_PER_GROUP = 20;
const MAX_CANDIDATES = 50;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export type CleanupManifestMember = {
  id: string;
  actorId: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  attemptReceiptCount: number;
  leaseState: "none" | "valid" | "expired" | "incomplete";
  expiresAt: string;
  finishedAt: string | null;
  rowDigest: string;
  candidate: boolean;
  disposition: string;
};

export type CleanupManifestGroup = {
  scope: string;
  idempotencyKey: string;
  members: CleanupManifestMember[];
};

export type CleanupManifest = {
  version: 1;
  scope: "live";
  generatedAt: string;
  truncated: boolean;
  skippedOversizedGroups: number;
  candidateIds: string[];
  groups: CleanupManifestGroup[];
};

export type CleanupPlanResponse = {
  planId: string;
  manifestDigest: string;
  proposedAt: string;
  expiresAt: string;
  truncated: boolean;
  skippedOversizedGroups: number;
  candidateCount: number;
  candidateIds: string[];
  groups: CleanupManifestGroup[];
};

export type CleanupApplyResult =
  | { outcome: "applied"; deletedCount: number; candidateIds: string[] }
  | { outcome: "stale" | "approval_mismatch" | "already_finalized" | "no_candidates" };

function digest(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(canonicalize);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function leaseState(
  row: typeof serverJobsTable.$inferSelect,
  now: Date,
): CleanupManifestMember["leaseState"] {
  if (!row.leaseToken && !row.leaseExpiresAt) return "none";
  if (!row.leaseToken || !row.leaseExpiresAt) return "incomplete";
  return row.leaseExpiresAt > now ? "valid" : "expired";
}

function snapshotRow(
  row: typeof serverJobsTable.$inferSelect,
  attemptReceiptCount: number,
  now: Date,
): Omit<CleanupManifestMember, "candidate" | "disposition"> {
  return {
    id: row.id,
    actorId: row.actorId.slice(0, 200),
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    attemptReceiptCount,
    leaseState: leaseState(row, now),
    expiresAt: row.expiresAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    rowDigest: digest(row),
  };
}

function isEligibleTerminal(
  member: Omit<CleanupManifestMember, "candidate" | "disposition">,
): boolean {
  return TERMINAL_STATUSES.has(member.status) &&
    member.finishedAt !== null &&
    member.attemptReceiptCount === 0 &&
    member.leaseState === "none";
}

function dispositionFor(
  member: Omit<CleanupManifestMember, "candidate" | "disposition">,
  candidate: boolean,
  candidateKeeperId: string | undefined,
): string {
  if (candidate) return "terminal_duplicate_requires_approval";
  if (member.attemptReceiptCount > 0) return "preserve_attempt_receipts";
  if (member.leaseState === "valid") return "preserve_valid_lease";
  if (member.leaseState === "expired") return "preserve_expired_lease_for_worker";
  if (member.leaseState === "incomplete") return "preserve_incomplete_lease_for_review";
  if (member.status === "queued") {
    return member.attempt < member.maxAttempts
      ? "preserve_runnable_job"
      : "preserve_exhausted_job_for_worker";
  }
  if (member.status === "running") {
    return "preserve_running_job_for_worker_or_review";
  }
  if (candidateKeeperId === member.id) return "preserve_one_terminal_record";
  return "preserve_noneligible_history";
}

function buildManifestGroup(
  scope: string,
  key: string,
  rows: typeof serverJobsTable.$inferSelect[],
  attemptsByJob: Map<string, number>,
  now: Date,
  candidateBudget: number,
): { group: CleanupManifestGroup; candidateIds: string[] } {
  const members = rows.map((row) => snapshotRow(row, attemptsByJob.get(row.id) ?? 0, now));
  const eligible = members
    .filter(isEligibleTerminal)
    .sort((left, right) => {
      const leftRow = rows.find((row) => row.id === left.id)!;
      const rightRow = rows.find((row) => row.id === right.id)!;
      return leftRow.createdAt.getTime() - rightRow.createdAt.getTime() || left.id.localeCompare(right.id);
    });
  const protectedMemberExists = members.some((member) => !isEligibleTerminal(member));
  const potential = protectedMemberExists ? eligible : eligible.slice(1);
  const selected = potential.slice(0, Math.max(0, candidateBudget));
  const candidateIds = new Set(selected.map((member) => member.id));
  const keeperId = protectedMemberExists ? undefined : eligible[0]?.id;
  return {
    group: {
      scope,
      idempotencyKey: key,
      members: members.map((member) => ({
        ...member,
        candidate: candidateIds.has(member.id),
        disposition: dispositionFor(member, candidateIds.has(member.id), keeperId),
      })),
    },
    candidateIds: selected.map((member) => member.id),
  };
}

function responseForPlan(row: typeof scheduledJobCleanupPlansTable.$inferSelect): CleanupPlanResponse {
  const manifest = row.manifest as unknown as CleanupManifest;
  return {
    planId: row.id,
    manifestDigest: row.manifestDigest,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    truncated: manifest.truncated,
    skippedOversizedGroups: manifest.skippedOversizedGroups,
    candidateCount: manifest.candidateIds.length,
    candidateIds: manifest.candidateIds,
    groups: manifest.groups,
  };
}

export async function createScheduledJobCleanupPlan(
  actorId: string,
  now = new Date(),
): Promise<CleanupPlanResponse> {
  const duplicateGroups = await db.select({
    scope: serverJobsTable.scope,
    idempotencyKey: serverJobsTable.idempotencyKey,
    rowCount: count(),
    firstCreatedAt: min(serverJobsTable.createdAt),
  }).from(serverJobsTable).where(and(
    eq(serverJobsTable.type, "scheduled-evaluation"),
    gt(serverJobsTable.expiresAt, now),
    sql`${serverJobsTable.idempotencyKey} ~ '^scheduled-evaluation:[^:]+:[0-9]+$'`,
  )).groupBy(serverJobsTable.scope, serverJobsTable.idempotencyKey)
    .having(sql`count(*) > 1`)
    .orderBy(asc(min(serverJobsTable.createdAt)), asc(serverJobsTable.scope), asc(serverJobsTable.idempotencyKey))
    .limit(MAX_GROUPS + 1);

  const truncated = duplicateGroups.length > MAX_GROUPS;
  let skippedOversizedGroups = 0;
  const groups: CleanupManifestGroup[] = [];
  const candidateIds: string[] = [];

  for (const duplicateGroup of duplicateGroups.slice(0, MAX_GROUPS)) {
    const expectedRows = Number(duplicateGroup.rowCount);
    if (expectedRows > MAX_MEMBERS_PER_GROUP || duplicateGroup.idempotencyKey.length > 128) {
      skippedOversizedGroups += 1;
      continue;
    }
    const rows = await db.select().from(serverJobsTable).where(and(
      eq(serverJobsTable.scope, duplicateGroup.scope),
      eq(serverJobsTable.type, "scheduled-evaluation"),
      eq(serverJobsTable.idempotencyKey, duplicateGroup.idempotencyKey),
      gt(serverJobsTable.expiresAt, now),
    )).orderBy(asc(serverJobsTable.createdAt), asc(serverJobsTable.id));
    if (rows.length !== expectedRows) {
      // A moving group is not a trustworthy proposal. Leave it out; approval
      // still rechecks every group that is included.
      skippedOversizedGroups += 1;
      continue;
    }
    const attempts = await db.select({
      jobId: serverJobAttemptsTable.jobId,
      receipts: count(),
    }).from(serverJobAttemptsTable).where(inArray(
      serverJobAttemptsTable.jobId,
      rows.map((row) => row.id),
    )).groupBy(serverJobAttemptsTable.jobId);
    const attemptsByJob = new Map(attempts.map((item) => [item.jobId, Number(item.receipts)]));
    const built = buildManifestGroup(
      duplicateGroup.scope,
      duplicateGroup.idempotencyKey,
      rows,
      attemptsByJob,
      now,
      MAX_CANDIDATES - candidateIds.length,
    );
    groups.push(built.group);
    candidateIds.push(...built.candidateIds);
  }

  const manifest: CleanupManifest = {
    version: 1,
    scope: "live",
    generatedAt: now.toISOString(),
    truncated: truncated || candidateIds.length >= MAX_CANDIDATES,
    skippedOversizedGroups,
    candidateIds,
    groups,
  };
  while (Buffer.byteLength(JSON.stringify(manifest), "utf8") > 60 * 1024 && manifest.groups.length > 0) {
    const removedGroup = manifest.groups.pop()!;
    const removedIds = new Set(removedGroup.members.map(({ id }) => id));
    manifest.candidateIds = manifest.candidateIds.filter((id) => !removedIds.has(id));
    manifest.skippedOversizedGroups += 1;
    manifest.truncated = true;
  }
  if (Buffer.byteLength(JSON.stringify(manifest), "utf8") > 65_536) {
    throw new Error("Cleanup manifest exceeds its storage limit");
  }
  const manifestDigest = digest(manifest);
  const [plan] = await db.insert(scheduledJobCleanupPlansTable).values({
    scope: "live",
    manifest,
    manifestDigest,
    proposedBy: actorId,
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS),
  }).returning();
  if (!plan) throw new Error("Cleanup plan was not persisted");
  return responseForPlan(plan);
}

function sameManifestGroups(
  expected: CleanupManifestGroup[],
  actual: CleanupManifestGroup[],
): boolean {
  return digest(expected) === digest(actual);
}

export async function applyScheduledJobCleanupPlan(
  input: {
    planId: string;
    manifestDigest: string;
    reason: string;
    actorId: string;
    audit: (
      executor: Pick<typeof db, "insert">,
      event: { action: string; resource: string; changes: Record<string, unknown> },
    ) => Promise<void>;
  },
  now = new Date(),
): Promise<CleanupApplyResult> {
  try {
    return await db.transaction(async (tx): Promise<CleanupApplyResult> => {
    const plan = (await tx.select().from(scheduledJobCleanupPlansTable).where(and(
      eq(scheduledJobCleanupPlansTable.id, input.planId),
      eq(scheduledJobCleanupPlansTable.scope, "live"),
    )).for("update").limit(1))[0];
    if (!plan) return { outcome: "stale" };
    const manifest = plan.manifest as unknown as CleanupManifest;
    const record = async (outcome: string) => input.audit(tx, {
      action: "scheduled_job_cleanup",
      resource: "scheduled-job-cleanup-plan",
      changes: { outcome, reason: input.reason, candidateIds: manifest.candidateIds },
    });
    if (plan.status !== "pending") {
      await record("already_finalized");
      return { outcome: "already_finalized" };
    }
    if (plan.manifestDigest !== input.manifestDigest ||
        digest(manifest) !== plan.manifestDigest) {
      await record("approval_mismatch");
      return { outcome: "approval_mismatch" };
    }
    if (manifest.candidateIds.length === 0) {
      await tx.update(scheduledJobCleanupPlansTable).set({
        status: "stale",
        approvedBy: input.actorId,
        approvalReason: input.reason,
        completedAt: now,
        result: { outcome: "no_candidates", deletedCount: 0 },
      }).where(eq(scheduledJobCleanupPlansTable.id, plan.id));
      await record("no_candidates");
      return { outcome: "no_candidates" };
    }
    if (plan.expiresAt <= now) {
      await tx.update(scheduledJobCleanupPlansTable).set({
        status: "stale",
        approvedBy: input.actorId,
        approvalReason: input.reason,
        completedAt: now,
        result: { outcome: "expired_plan", deletedCount: 0 },
      }).where(eq(scheduledJobCleanupPlansTable.id, plan.id));
      await record("stale");
      return { outcome: "stale" };
    }

    const expectedRows = manifest.groups.flatMap((group) => group.members);
    const expectedIds = expectedRows.map((member) => member.id);
    const lockedExpected = expectedIds.length
      ? await tx.select().from(serverJobsTable).where(and(
        eq(serverJobsTable.type, "scheduled-evaluation"),
        inArray(serverJobsTable.id, expectedIds),
      )).for("update")
      : [];

    const currentGroups: CleanupManifestGroup[] = [];
    const currentCandidateIds: string[] = [];
    const groupPairs = manifest.groups.map(({ scope, idempotencyKey }) =>
      and(eq(serverJobsTable.scope, scope), eq(serverJobsTable.idempotencyKey, idempotencyKey)));
    const currentRows = groupPairs.length
      ? await tx.select().from(serverJobsTable).where(and(
        eq(serverJobsTable.type, "scheduled-evaluation"),
        gt(serverJobsTable.expiresAt, now),
        or(...groupPairs),
      )).orderBy(asc(serverJobsTable.createdAt), asc(serverJobsTable.id)).for("update")
      : [];
    let candidateBudget = MAX_CANDIDATES;
    for (const group of manifest.groups) {
      const rows = currentRows.filter((row) =>
        row.scope === group.scope && row.idempotencyKey === group.idempotencyKey);
      const rowIds = rows.map((row) => row.id);
      const attemptRows = rowIds.length
        ? await tx.select({ jobId: serverJobAttemptsTable.jobId }).from(serverJobAttemptsTable)
          .where(inArray(serverJobAttemptsTable.jobId, rowIds)).for("update")
        : [];
      const attemptsByJob = new Map<string, number>();
      for (const attempt of attemptRows) {
        attemptsByJob.set(attempt.jobId, (attemptsByJob.get(attempt.jobId) ?? 0) + 1);
      }
      const rebuilt = buildManifestGroup(
        group.scope,
        group.idempotencyKey,
        rows,
        attemptsByJob,
        now,
        candidateBudget,
      );
      currentGroups.push(rebuilt.group);
      currentCandidateIds.push(...rebuilt.candidateIds);
      candidateBudget -= rebuilt.candidateIds.length;
    }
    const allExpectedStillPresent = expectedIds.every((id) => lockedExpected.some((row) => row.id === id));
    const unchanged = allExpectedStillPresent &&
      manifest.groups.length === currentGroups.length &&
      sameManifestGroups(manifest.groups, currentGroups) &&
      digest(currentCandidateIds) === digest(manifest.candidateIds);
    if (!unchanged) {
      await tx.update(scheduledJobCleanupPlansTable).set({
        status: "stale",
        approvedBy: input.actorId,
        approvalReason: input.reason,
        completedAt: now,
        result: { outcome: "changed_state", deletedCount: 0 },
      }).where(eq(scheduledJobCleanupPlansTable.id, plan.id));
      await record("stale");
      return { outcome: "stale" };
    }

    const candidateRows = await tx.select().from(serverJobsTable).where(and(
      inArray(serverJobsTable.id, manifest.candidateIds),
      eq(serverJobsTable.type, "scheduled-evaluation"),
      gt(serverJobsTable.expiresAt, now),
      sql`${serverJobsTable.status} in ('succeeded', 'failed', 'cancelled')`,
      sql`${serverJobsTable.finishedAt} is not null`,
      sql`${serverJobsTable.leaseToken} is null`,
      sql`${serverJobsTable.leaseExpiresAt} is null`,
    )).for("update");
    const candidateAttempts = await tx.select({ jobId: serverJobAttemptsTable.jobId })
      .from(serverJobAttemptsTable)
      .where(inArray(serverJobAttemptsTable.jobId, manifest.candidateIds))
      .for("update");
    if (candidateRows.length !== manifest.candidateIds.length || candidateAttempts.length !== 0) {
      await tx.update(scheduledJobCleanupPlansTable).set({
        status: "stale",
        approvedBy: input.actorId,
        approvalReason: input.reason,
        completedAt: now,
        result: { outcome: "candidate_recheck_failed", deletedCount: 0 },
      }).where(eq(scheduledJobCleanupPlansTable.id, plan.id));
      await record("stale");
      return { outcome: "stale" };
    }

    const deleted = await tx.delete(serverJobsTable).where(and(
      inArray(serverJobsTable.id, manifest.candidateIds),
      eq(serverJobsTable.type, "scheduled-evaluation"),
      sql`${serverJobsTable.status} in ('succeeded', 'failed', 'cancelled')`,
      sql`${serverJobsTable.finishedAt} is not null`,
      sql`${serverJobsTable.leaseToken} is null`,
      sql`${serverJobsTable.leaseExpiresAt} is null`,
    )).returning({ id: serverJobsTable.id });
    if (deleted.length !== manifest.candidateIds.length) {
      throw new Error("Scheduled-job cleanup changed during its transaction");
    }
    await tx.update(scheduledJobCleanupPlansTable).set({
      status: "applied",
      approvedBy: input.actorId,
      approvalReason: input.reason,
      completedAt: now,
      result: { outcome: "applied", deletedCount: deleted.length },
    }).where(eq(scheduledJobCleanupPlansTable.id, plan.id));
    await record("applied");
      return { outcome: "applied", deletedCount: deleted.length, candidateIds: manifest.candidateIds };
    }, { isolationLevel: "serializable" });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code !== "40001" && code !== "40P01") throw error;

    // A serializable conflict or deadlock means the queue changed while the
    // plan was being approved. The failed transaction deleted nothing; mark the
    // plan stale separately so its exact candidate set and rejected outcome
    // remain auditable.
    return db.transaction(async (tx): Promise<CleanupApplyResult> => {
      const plan = (await tx.select().from(scheduledJobCleanupPlansTable).where(and(
        eq(scheduledJobCleanupPlansTable.id, input.planId),
        eq(scheduledJobCleanupPlansTable.scope, "live"),
      )).for("update").limit(1))[0];
      if (!plan || plan.status !== "pending") return { outcome: "already_finalized" };
      const manifest = plan.manifest as unknown as CleanupManifest;
      await tx.update(scheduledJobCleanupPlansTable).set({
        status: "stale",
        approvedBy: input.actorId,
        approvalReason: input.reason,
        completedAt: now,
        result: { outcome: "concurrent_queue_change", deletedCount: 0 },
      }).where(eq(scheduledJobCleanupPlansTable.id, plan.id));
      await input.audit(tx, {
        action: "scheduled_job_cleanup",
        resource: "scheduled-job-cleanup-plan",
        changes: {
          outcome: "stale",
          reason: input.reason,
          candidateIds: manifest.candidateIds,
        },
      });
      return { outcome: "stale" };
    });
  }
}
