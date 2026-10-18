import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import {
  db,
  fieldCheckIssuesTable,
  fieldCheckObservationsTable,
  type FieldCheckIssue,
  type FieldCheckObservation,
} from "@workspace/db";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  FIELD_CHECK_MAX_CLOCK_SKEW_MS,
  isFieldCheckTimestampOutsideClockWindow,
} from "@workspace/field-check-contract";
import { currentScope } from "./requestScope";

export const FIELD_CHECK_VERSION = "3";
export const HARDWARE_CHECK_VERSION = "2026-09";
export const FIELD_CHECK_RETENTION_DAYS = 30;
export const FIELD_CHECK_MAX_BATCH = 20;
export const FIELD_CHECK_MAX_METRICS = 8;
export const FIELD_CHECK_MAX_OBSERVATION_BYTES = 24_000;
export const FIELD_CHECK_INCOMPLETE_REVIEW_THRESHOLD = 3;
export { FIELD_CHECK_MAX_CLOCK_SKEW_MS };
export const FIELD_CHECK_WORKFLOW_MAX_DURATION_MS = 15 * 60 * 1000;

export const FIELD_CHECK_CATALOG = [
  {
    name: "startup",
    label: "Startup",
    observedBy: "browser",
    evidence: "Recorded when the authenticated field-check observer starts; home-bundle timing is a separate performance observation.",
    expiresHours: 24,
  },
  {
    name: "foreground-recovery",
    label: "Background / foreground recovery",
    observedBy: "browser",
    evidence: "Recorded when this page becomes visible after the browser reported it hidden.",
    expiresHours: 72,
  },
  {
    name: "sync-acknowledgment",
    label: "Sync acknowledgment",
    observedBy: "browser",
    evidence: "Recorded when a naturally occurring sync write receives its server acknowledgment.",
    expiresHours: 72,
  },
  {
    name: "production-run-save-sync",
    label: "Production-run save and sync",
    observedBy: "browser",
    evidence: "Recorded after a production-run save; success requires server acknowledgment, interruption is incomplete, and only bounded duration/cause codes are retained.",
    expiresHours: 72,
  },
  {
    name: "spec-import-review-commit",
    label: "Spec import parse, review, and commit",
    observedBy: "browser",
    evidence: "Recorded after the spec-import review/commit flow; cancellation is incomplete, success requires persisted changes, and only bounded duration is retained.",
    expiresHours: 168,
  },
  {
    name: "cross-device-convergence",
    label: "Cross-device convergence",
    observedBy: "browser",
    evidence: "Recorded when this browser applies a naturally occurring peer or merged update.",
    expiresHours: 168,
  },
  {
    name: "reload-persistence",
    label: "Reload startup",
    observedBy: "browser",
    evidence: "Recorded after a full-page reload followed by authenticated observer startup; saved-data persistence is not checked.",
    expiresHours: 168,
  },
  {
    name: "offline-recovery",
    label: "Offline recovery",
    observedBy: "browser",
    evidence: "Recorded when the browser reports returning online after an offline interval.",
    expiresHours: 168,
  },
  {
    name: "offline-queue-replay",
    label: "Offline queue replay",
    observedBy: "browser",
    evidence: "Recorded when a queued offline operation receives server acknowledgment after connectivity returns.",
    expiresHours: 168,
  },
  {
    name: "pwa-update-handoff",
    label: "PWA update handoff",
    observedBy: "browser",
    evidence: "Recorded when a service-worker update is ready or an update handoff is initiated; this does not confirm recovery.",
    expiresHours: 720,
  },
  {
    name: "stale-deployment-recovery",
    label: "Stale-deployment recovery",
    observedBy: "browser",
    evidence: "An update attempt is incomplete until an authenticated startup on a different build; same-build or interrupted attempts remain unconfirmed.",
    expiresHours: 720,
  },
  {
    name: "performance",
    label: "Performance",
    observedBy: "browser",
    evidence: "Records home-bundle load, page-navigation load, and API timeout/network timings against their reviewed budgets.",
    expiresHours: 72,
  },
  {
    name: "touch-accuracy",
    label: "Touch accuracy",
    observedBy: "hardware",
    evidence: "The app cannot verify physical touch accuracy without guided human confirmation.",
    expiresHours: null,
  },
  {
    name: "keyboard-clearance",
    label: "Keyboard clearance",
    observedBy: "hardware",
    evidence: "The app cannot verify visual keyboard clearance across physical devices.",
    expiresHours: null,
  },
  {
    name: "orientation-layout",
    label: "Orientation layout",
    observedBy: "hardware",
    evidence: "A manager visually confirmed that the working screen remains usable after rotating a physical device.",
    expiresHours: 720,
  },
  {
    name: "safe-area-clearance",
    label: "Safe-area and fixed-navigation clearance",
    observedBy: "hardware",
    evidence: "A manager visually confirmed controls are not obstructed by device safe areas or fixed navigation.",
    expiresHours: 720,
  },
  {
    name: "camera-file-selection",
    label: "Camera and file selection",
    observedBy: "hardware",
    evidence: "A manager confirmed the physical device can open and cancel its camera or file picker without uploading production data.",
    expiresHours: 720,
  },
  {
    name: "update-handoff",
    label: "Update handoff",
    observedBy: "hardware",
    evidence: "A manager confirmed the guided update and reopen protocol on a physical device.",
    expiresHours: 720,
  },
  {
    name: "process-kill-recovery",
    label: "OS process-kill recovery",
    observedBy: "hardware",
    evidence: "The app cannot prove OS process-kill behavior without a guided device check.",
    expiresHours: null,
  },
] as const;

export type FieldCheckName = (typeof FIELD_CHECK_CATALOG)[number]["name"];
export type FieldCheckOutcome = "success" | "failure" | "incomplete";
export type FieldCheckStatus = "healthy" | "collecting" | "needs-review" | "unsupported";
export type FieldCheckCoverage = "never-observed" | "current" | "stale" | "no-success";
export type FieldCheckObservedBy = "browser" | "hardware";
export type FieldCheckMetrics = Record<string, number>;

const catalogByName = new Map(FIELD_CHECK_CATALOG.map((check) => [check.name, check]));
const workflowCheckNames = new Set<FieldCheckName>([
  "production-run-save-sync",
  "spec-import-review-commit",
]);
const productionRunSaveFailureCodes = new Set([1, 2, 3, 4]);
const metricKey = /^[a-z][a-zA-Z0-9]{0,31}$/;
const observationId = /^[a-zA-Z0-9:_-]{8,160}$/;

const observationSchema = z.object({
  observationId: z.string().regex(observationId),
  checkName: z.string(),
  checkVersion: z.string().max(20),
  outcome: z.enum(["success", "failure", "incomplete"]),
  observedAt: z.string().datetime({ offset: true }),
  appBuild: z.string().trim().min(1).max(100),
  deviceCategory: z.enum([
    "desktop-chrome",
    "desktop-safari",
    "desktop-firefox",
    "mobile-chrome",
    "mobile-safari",
    "tablet-browser",
    "android-phone",
    "android-tablet",
    "ipad",
    "iphone",
    "other-browser",
  ]),
  metrics: z.record(z.string(), z.number().finite().min(0).max(10_000_000)).default({}),
}).superRefine((value, ctx) => {
  if (!catalogByName.has(value.checkName as FieldCheckName)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checkName"], message: "Unsupported field check" });
  }
  if (["sync-acknowledgment", "performance"].includes(value.checkName) && !["1", "2", "3"].includes(value.checkVersion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checkVersion"], message: "Unsupported diagnostic observation version" });
  }
  if (value.metrics && Object.keys(value.metrics).length > FIELD_CHECK_MAX_METRICS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics"], message: "Too many metrics" });
  }
  for (const key of Object.keys(value.metrics ?? {})) {
    if (!metricKey.test(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics", key], message: "Invalid metric name" });
    }
  }
  if (value.checkVersion === "3" && value.checkName === "sync-acknowledgment") {
    const keys = Object.keys(value.metrics);
    const valid = value.outcome === "failure"
      ? keys.length === 1 && Number.isInteger(value.metrics.failureCode) && [1, 2, 3].includes(value.metrics.failureCode!)
      : keys.length === 0;
    if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics"], message: "Expected an approved sync failure category only" });
  }
  if (value.checkVersion === "3" && value.checkName === "performance") {
    const valid = Object.keys(value.metrics).length === 2 &&
      Object.hasOwn(value.metrics, "durationMs") &&
      Number.isInteger(value.metrics.sourceCode) && [1, 2, 3, 4].includes(value.metrics.sourceCode!);
    if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics"], message: "Expected bounded durationMs and an approved performance source only" });
  }
  if (value.checkName === "stale-deployment-recovery" && Object.keys(value.metrics).length !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics"], message: "Recovery evidence does not accept metrics" });
  }
  if (workflowCheckNames.has(value.checkName as FieldCheckName)) {
    const metrics = value.metrics ?? {};
    const metricNames = Object.keys(metrics);
    const hasFailureCode = Object.prototype.hasOwnProperty.call(metrics, "failureCode");
    const failureCodeAllowed =
      value.checkName === "production-run-save-sync" &&
      value.outcome === "failure" &&
      Number.isInteger(metrics.failureCode) &&
      productionRunSaveFailureCodes.has(metrics.failureCode!);
    if (
      !Object.prototype.hasOwnProperty.call(metrics, "durationMs") ||
      metricNames.some((name) => name !== "durationMs" && name !== "failureCode") ||
      metricNames.length > (hasFailureCode ? 2 : 1) ||
      (hasFailureCode && !failureCodeAllowed) ||
      metrics.durationMs! > FIELD_CHECK_WORKFLOW_MAX_DURATION_MS
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metrics"],
        message: "Workflow evidence accepts only bounded durationMs and an approved save failureCode",
      });
    }
  }
});

const hardwareConfirmationSchema = z.object({
  checkName: z.enum([
    "touch-accuracy",
    "keyboard-clearance",
    "orientation-layout",
    "safe-area-clearance",
    "camera-file-selection",
    "update-handoff",
    "process-kill-recovery",
  ]),
  checkVersion: z.literal(HARDWARE_CHECK_VERSION),
  outcome: z.enum(["success", "failure", "incomplete"]),
  observedAt: z.string().datetime({ offset: true }),
  deviceCategory: z.enum(["android-phone", "android-tablet", "ipad", "iphone"]),
}).strict();

export type HardwareConfirmationInput = z.infer<typeof hardwareConfirmationSchema>;

export function validateHardwareConfirmation(body: unknown): {
  ok: true;
  data: HardwareConfirmationInput;
} | {
  ok: false;
  error: string;
} {
  const parsed = hardwareConfirmationSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "Invalid hardware-check confirmation" };
  const observedAt = Date.parse(parsed.data.observedAt);
  if (isFieldCheckTimestampOutsideClockWindow(observedAt, Date.now())) {
    return { ok: false, error: "Observation timestamp is outside the accepted clock window" };
  }
  return { ok: true, data: parsed.data };
}

export function hardwareConfirmationObservation(
  input: HardwareConfirmationInput,
): FieldCheckObservationInput {
  return {
    observationId: `hardware:${randomUUID()}`,
    checkName: input.checkName,
    checkVersion: input.checkVersion,
    outcome: input.outcome,
    observedAt: input.observedAt,
    appBuild: "hardware-protocol",
    deviceCategory: input.deviceCategory,
    metrics: {},
  };
}

export type FieldCheckObservationInput = z.infer<typeof observationSchema>;

export function validateFieldCheckBatch(body: unknown): {
  ok: true;
  data: FieldCheckObservationInput[];
} | {
  ok: false;
  error: string;
} {
  if (!body || typeof body !== "object" || !Array.isArray((body as { observations?: unknown }).observations)) {
    return { ok: false, error: "observations must be an array" };
  }
  const observations = (body as { observations: unknown[] }).observations;
  if (observations.length === 0 || observations.length > FIELD_CHECK_MAX_BATCH) {
    return { ok: false, error: `observations must contain 1-${FIELD_CHECK_MAX_BATCH} items` };
  }
  const parsed = z.array(observationSchema).safeParse(observations);
  if (!parsed.success) return { ok: false, error: "Invalid field-check observation" };
  if (parsed.data.some((observation) =>
    catalogByName.get(observation.checkName as FieldCheckName)?.observedBy !== "browser"
  )) {
    return { ok: false, error: "Hardware checks require guided manager confirmation" };
  }
  const now = Date.now();
  if (parsed.data.some((observation) => {
    const observedAt = Date.parse(observation.observedAt);
    return isFieldCheckTimestampOutsideClockWindow(observedAt, now);
  })) {
    return { ok: false, error: "Observation timestamp is outside the accepted clock window" };
  }
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (bytes > FIELD_CHECK_MAX_OBSERVATION_BYTES) {
    return { ok: false, error: "Field-check batch is too large" };
  }
  return { ok: true, data: parsed.data };
}

export type FieldCheckFailure = {
  outcome: FieldCheckOutcome;
  observedAt: string;
  appBuild: string;
  deviceCategory: string;
  metrics: FieldCheckMetrics;
};

export type FieldCheckSummary = {
  name: FieldCheckName;
  label: string;
  status: FieldCheckStatus;
  coverage: FieldCheckCoverage;
  observedBy: FieldCheckObservedBy;
  evidence: string;
  expiresHours: number | null;
  lastSuccessfulAt: string | null;
  lastSuccessfulMetrics: FieldCheckMetrics | null;
  lastObservedAt: string | null;
  lastReceiptDelayMs: number | null;
  recentFailures: FieldCheckFailure[];
  failureCount: number;
  incompleteCount: number;
  actionable: boolean;
  issueStatus: "open" | "recovered" | null;
};

export type FieldChecksReport = {
  version: string;
  scope: "current facility";
  generatedAt: string;
  checks: FieldCheckSummary[];
  overallStatus: FieldCheckStatus;
  actionableCount: number;
  population: {
    appBuild: string | null;
    deviceCategory: string | null;
    countBasis: "lifetime-issues" | "retained-observations";
    retentionDays: 30;
  };
};

// Strict scalar filters: never accept arrays/objects, wildcard searches or
// caller-controlled scopes. Reuse the ingestion enums without widening them.
export const fieldCheckFiltersSchema = z.object({
  appBuild: z.string().min(1).max(100).refine((value) => value === value.trim()).optional(),
  deviceCategory: observationSchema.shape.deviceCategory.optional(),
}).strict();
export type FieldCheckFilters = z.infer<typeof fieldCheckFiltersSchema>;

export function deriveFieldCheckStatus(input: {
  observedBy: FieldCheckObservedBy;
  expiresHours: number | null;
  lastSuccessfulAt: Date | null;
  actionable: boolean;
  now?: number;
}): FieldCheckStatus {
  if (input.observedBy === "hardware") {
    if (input.actionable) return "needs-review";
    if (!input.lastSuccessfulAt) return "unsupported";
    return input.expiresHours === null || isFresh(input.lastSuccessfulAt, input.expiresHours, input.now ?? Date.now())
      ? "healthy"
      : "unsupported";
  }
  if (input.actionable) return "needs-review";
  return input.lastSuccessfulAt && isFresh(input.lastSuccessfulAt, input.expiresHours, input.now ?? Date.now())
    ? "healthy"
    : "collecting";
}

export function deriveFieldCheckCoverage(input: {
  expiresHours: number | null;
  lastSuccessfulAt: Date | null;
  hasObservation: boolean;
  now?: number;
}): FieldCheckCoverage {
  if (!input.hasObservation) return "never-observed";
  if (!input.lastSuccessfulAt) return "no-success";
  return input.expiresHours === null ||
    isFresh(input.lastSuccessfulAt, input.expiresHours, input.now ?? Date.now())
    ? "current" : "stale";
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function isFresh(observedAt: Date | null, expiresHours: number | null, now: number): boolean {
  return Boolean(
    observedAt &&
      expiresHours !== null &&
      now - observedAt.getTime() <= expiresHours * 60 * 60 * 1000,
  );
}

function failureDto(row: FieldCheckObservation): FieldCheckFailure {
  return {
    outcome: row.outcome as FieldCheckOutcome,
    observedAt: row.observedAt.toISOString(),
    appBuild: row.appBuild,
    deviceCategory: row.deviceCategory,
    metrics: (row.metrics ?? {}) as FieldCheckMetrics,
  };
}

export async function recordFieldCheckBatch(
  observations: FieldCheckObservationInput[],
): Promise<{ accepted: number; duplicate: number }> {
  const scope = currentScope();
  const cutoff = new Date(Date.now() - FIELD_CHECK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let accepted = 0;
  let duplicate = 0;

  await db.transaction(async (tx) => {
    for (const input of observations) {
      const observedAt = new Date(input.observedAt);
      const [row] = await tx
        .insert(fieldCheckObservationsTable)
        .values({
          scope,
          observationId: input.observationId,
          checkName: input.checkName,
          checkVersion: input.checkVersion,
          outcome: input.outcome,
          observedAt,
          appBuild: input.appBuild,
          deviceCategory: input.deviceCategory,
          metrics: input.metrics,
        })
        .onConflictDoNothing({
          target: [fieldCheckObservationsTable.scope, fieldCheckObservationsTable.observationId],
        })
        .returning();
      if (!row) {
        duplicate += 1;
        continue;
      }
      accepted += 1;
      const values = {
        scope,
        checkName: input.checkName,
        lastSuccessfulAt: input.outcome === "success" ? observedAt : undefined,
        lastFailedAt: input.outcome !== "success" ? observedAt : undefined,
        firstFailedAt: input.outcome !== "success" ? observedAt : undefined,
        lastFailure: input.outcome !== "success" ? {
          outcome: input.outcome,
          observedAt: input.observedAt,
          appBuild: input.appBuild,
          deviceCategory: input.deviceCategory,
          metrics: input.metrics,
        } : undefined,
        updatedAt: new Date(),
      };
      if (input.outcome === "success") {
        await tx.update(fieldCheckIssuesTable).set({
          lastSuccessfulAt: observedAt,
          status: "recovered",
          updatedAt: new Date(),
        }).where(and(
          eq(fieldCheckIssuesTable.scope, scope),
          eq(fieldCheckIssuesTable.checkName, input.checkName),
        ));
      } else if (input.outcome === "failure") {
        await tx.insert(fieldCheckIssuesTable).values({
          ...values,
          failureCount: 1,
          incompleteCount: 0,
        }).onConflictDoUpdate({
          target: [fieldCheckIssuesTable.scope, fieldCheckIssuesTable.checkName],
          set: {
            failureCount: sql`${fieldCheckIssuesTable.failureCount} + 1`,
            status: "open",
            lastFailedAt: observedAt,
            firstFailedAt: sql`coalesce(${fieldCheckIssuesTable.firstFailedAt}, ${observedAt})`,
            lastFailure: values.lastFailure,
            updatedAt: new Date(),
          },
        });
      } else {
        await tx.insert(fieldCheckIssuesTable).values({
          ...values,
          failureCount: 0,
          incompleteCount: 1,
        }).onConflictDoUpdate({
          target: [fieldCheckIssuesTable.scope, fieldCheckIssuesTable.checkName],
          set: {
            incompleteCount: sql`${fieldCheckIssuesTable.incompleteCount} + 1`,
            status: sql`case when ${fieldCheckIssuesTable.incompleteCount} + 1 >= ${FIELD_CHECK_INCOMPLETE_REVIEW_THRESHOLD} then 'open' else ${fieldCheckIssuesTable.status} end`,
            lastFailedAt: observedAt,
            firstFailedAt: sql`coalesce(${fieldCheckIssuesTable.firstFailedAt}, ${observedAt})`,
            lastFailure: values.lastFailure,
            updatedAt: new Date(),
          },
        });
      }
    }
    await tx.delete(fieldCheckObservationsTable).where(and(
      eq(fieldCheckObservationsTable.scope, scope),
      lt(fieldCheckObservationsTable.receivedAt, cutoff),
    ));
  });

  return { accepted, duplicate };
}

export async function buildFieldChecksReport(now = Date.now(), filters: FieldCheckFilters = {}): Promise<FieldChecksReport> {
  const scope = currentScope();
  const filtered = filters.appBuild !== undefined || filters.deviceCategory !== undefined;
  const [observations, issues] = await Promise.all([
    db.select().from(fieldCheckObservationsTable)
      .where(and(
        eq(fieldCheckObservationsTable.scope, scope),
        gt(fieldCheckObservationsTable.receivedAt, new Date(now - FIELD_CHECK_RETENTION_DAYS * 24 * 60 * 60 * 1000)),
        filters.appBuild === undefined ? undefined : eq(fieldCheckObservationsTable.appBuild, filters.appBuild),
        filters.deviceCategory === undefined ? undefined : eq(fieldCheckObservationsTable.deviceCategory, filters.deviceCategory),
      ))
      .orderBy(desc(fieldCheckObservationsTable.observedAt)),
    filtered ? Promise.resolve([]) : db.select().from(fieldCheckIssuesTable)
      .where(eq(fieldCheckIssuesTable.scope, scope)),
  ]);
  const issueByName = new Map(issues.map((issue) => [issue.checkName, issue]));
  const summaries: FieldCheckSummary[] = FIELD_CHECK_CATALOG.map((check) => {
    const rows = observations.filter((row) => row.checkName === check.name);
    const issue = issueByName.get(check.name);
    const last = rows[0];
    const lastSuccess = rows.find((row) => row.outcome === "success");
    const lastNonSuccess = rows.find((row) => row.outcome !== "success");
    const filteredRecovered = Boolean(
      lastNonSuccess && lastSuccess &&
      lastSuccess.observedAt.getTime() > lastNonSuccess.observedAt.getTime(),
    );
    const issueRecovered = filtered ? filteredRecovered : issue?.status === "recovered";
    const recentFailures = rows.filter((row) => row.outcome !== "success").slice(0, 5).map(failureDto);
    const incompleteCount = issue?.incompleteCount ?? rows.filter((row) => row.outcome === "incomplete").length;
    const failureCount = issue?.failureCount ?? rows.filter((row) => row.outcome === "failure").length;
    const actionable = (
      failureCount > 0 || incompleteCount >= FIELD_CHECK_INCOMPLETE_REVIEW_THRESHOLD
    ) && !issueRecovered;
    const issueStatus: "open" | "recovered" | null = filtered
      ? !lastNonSuccess ? null : filteredRecovered ? "recovered" : actionable ? "open" : null
      : issue?.status === "recovered" ? "recovered"
        : issue?.status === "open" && actionable ? "open" : null;
    const status = deriveFieldCheckStatus({
      observedBy: check.observedBy,
      expiresHours: check.expiresHours,
      lastSuccessfulAt: lastSuccess?.observedAt ?? null,
      actionable,
      now,
    });
    return {
      name: check.name,
      label: check.label,
      status,
      coverage: deriveFieldCheckCoverage({
        expiresHours: check.expiresHours,
        lastSuccessfulAt: lastSuccess?.observedAt ?? null,
        hasObservation: rows.length > 0,
        now,
      }),
      observedBy: check.observedBy,
      evidence: check.evidence,
      expiresHours: check.expiresHours,
      lastSuccessfulAt: iso(lastSuccess?.observedAt),
      lastSuccessfulMetrics: workflowCheckNames.has(check.name)
        ? ((lastSuccess?.metrics ?? null) as FieldCheckMetrics | null)
        : null,
      lastObservedAt: iso(last?.observedAt),
      lastReceiptDelayMs: last && last.receivedAt.getTime() >= last.observedAt.getTime()
        ? Math.min(2 * FIELD_CHECK_MAX_CLOCK_SKEW_MS, last.receivedAt.getTime() - last.observedAt.getTime())
        : null,
      recentFailures,
      failureCount,
      incompleteCount,
      actionable,
      issueStatus,
    };
  });
  const actionableCount = summaries.filter((summary) => summary.actionable).length;
  const supported = summaries.filter((summary) => summary.observedBy === "browser");
  const overallStatus: FieldCheckStatus = actionableCount > 0
    ? "needs-review"
    : supported.some((summary) => summary.status === "collecting")
      ? "collecting"
      : "healthy";
  return {
    version: FIELD_CHECK_VERSION,
    scope: "current facility",
    generatedAt: new Date(now).toISOString(),
    checks: summaries,
    overallStatus,
    actionableCount,
    population: {
      appBuild: filters.appBuild ?? null,
      deviceCategory: filters.deviceCategory ?? null,
      countBasis: filtered ? "retained-observations" : "lifetime-issues",
      retentionDays: 30,
    },
  };
}

export type { FieldCheckIssue };