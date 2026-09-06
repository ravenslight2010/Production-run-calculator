import { and, desc, eq, inArray, like, lt, sql } from "drizzle-orm";
import {
  aiConversationTurnsTable,
  dataHealsTable,
  db,
  facilityKnowledgeTable,
  incidentsTable,
  inventoryObservationsTable,
  qualityChecksTable,
  usersTable,
} from "@workspace/db";
import { currentScope } from "./requestScope";

export const AI_RETENTION_VERSION = "retired-ai-retention-v1";
export const AI_RETENTION_BATCH_LIMIT = 500;
export const CONVERSATION_RETENTION_DAYS = 30;
export const THUMBNAIL_RETENTION_DAYS = 7;
export const OBSERVATION_RETENTION_DAYS = 30;
export const RETIRED_FACILITY_DOMAINS = [
  "forecast",
  "proactive-alerts",
  "incidents",
  "quality",
  "waste",
] as const;

type Candidate = { id: number | string };
type RetentionExecutor = Pick<typeof db, "select">;

export type AiRetentionReport = {
  policyVersion: string;
  scope: string;
  batchLimit: number;
  canApply: boolean;
  alreadyApplied: boolean;
  appliedAt: Date | null;
  candidates: {
    conversationTurns: number;
    retiredFacilityFacts: number;
    incidentGeneratedTextToLabel: number;
    qualityThumbnailsToRedact: number;
    closedObservationsToRedact: number;
    total: number;
  };
  protected: {
    correctionAndAliasRecords: string;
    operationalIncidentRows: number;
    confirmedQualityRows: number;
    openInventoryObservations: number;
    inventoryLedgerEffects: string;
  };
  cutoffs: {
    conversationBefore: string;
    thumbnailBefore: string;
    observationBefore: string;
  };
};

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function markerPrefix(scope: string): string {
  return `${AI_RETENTION_VERSION}:${scope}`;
}

async function limitedCandidates(
  executor: RetentionExecutor,
  scope: string,
  now: Date,
) {
  const conversationBefore = cutoff(now, CONVERSATION_RETENTION_DAYS);
  const thumbnailBefore = cutoff(now, THUMBNAIL_RETENTION_DAYS);
  const observationBefore = cutoff(now, OBSERVATION_RETENTION_DAYS);
  const [turns, facts, incidents, operationalIncidents, thumbnails, observations, qualityRows, openObservations, marker] =
    await Promise.all([
      executor.select({ id: aiConversationTurnsTable.id }).from(aiConversationTurnsTable)
        .innerJoin(usersTable, eq(aiConversationTurnsTable.userId, usersTable.id))
        .where(and(
          lt(aiConversationTurnsTable.createdAt, conversationBefore),
          eq(usersTable.sandbox, scope === "sandbox"),
        )).limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ id: facilityKnowledgeTable.id }).from(facilityKnowledgeTable)
        .where(and(
          eq(facilityKnowledgeTable.scope, scope),
          inArray(facilityKnowledgeTable.domain, [...RETIRED_FACILITY_DOMAINS]),
        )).limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ id: incidentsTable.id }).from(incidentsTable)
        .where(and(
          eq(incidentsTable.scope, scope),
          sql`(
            (${incidentsTable.diagnosis} is not null and ${incidentsTable.diagnosis} not like '[Unverified generated text]%')
            or
            (${incidentsTable.workaround} is not null and ${incidentsTable.workaround} not like '[Unverified generated text]%')
          )`,
        )).limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ id: incidentsTable.id }).from(incidentsTable)
        .where(eq(incidentsTable.scope, scope)).limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ id: qualityChecksTable.id }).from(qualityChecksTable)
        .where(and(
          eq(qualityChecksTable.scope, scope),
          lt(qualityChecksTable.createdAt, thumbnailBefore),
          sql`${qualityChecksTable.thumbnail} is not null`,
        )).limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ id: inventoryObservationsTable.id }).from(inventoryObservationsTable)
        .where(and(
          eq(inventoryObservationsTable.scope, scope),
          lt(inventoryObservationsTable.updatedAt, observationBefore),
          inArray(inventoryObservationsTable.status, ["applied", "cancelled"]),
          sql`(${inventoryObservationsTable.photos} <> '[]'::jsonb or ${inventoryObservationsTable.draft} <> '{}'::jsonb)`,
        )).limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ id: qualityChecksTable.id }).from(qualityChecksTable)
        .where(eq(qualityChecksTable.scope, scope)).limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ id: inventoryObservationsTable.id }).from(inventoryObservationsTable)
        .where(and(eq(inventoryObservationsTable.scope, scope), eq(inventoryObservationsTable.status, "draft")))
        .limit(AI_RETENTION_BATCH_LIMIT + 1),
      executor.select({ appliedAt: dataHealsTable.appliedAt }).from(dataHealsTable)
        .where(like(dataHealsTable.id, `${markerPrefix(scope)}:%`))
        .orderBy(desc(dataHealsTable.appliedAt)).limit(1),
    ]);
  return {
    conversationBefore, thumbnailBefore, observationBefore,
    turns, facts, incidents, operationalIncidents, thumbnails, observations, qualityRows, openObservations,
    marker: marker[0],
  };
}

export async function buildAiRetentionReport(
  executor: RetentionExecutor = db,
  now = new Date(),
): Promise<AiRetentionReport> {
  const scope = currentScope();
  const c = await limitedCandidates(executor, scope, now);
  const counts = [c.turns, c.facts, c.incidents, c.thumbnails, c.observations].map((rows) => rows.length);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const overflow = counts.some((value) => value > AI_RETENTION_BATCH_LIMIT) || total > AI_RETENTION_BATCH_LIMIT;
  return {
    policyVersion: AI_RETENTION_VERSION,
    scope,
    batchLimit: AI_RETENTION_BATCH_LIMIT,
    canApply: total > 0 && !overflow,
    alreadyApplied: Boolean(c.marker),
    appliedAt: c.marker?.appliedAt ?? null,
    candidates: {
      conversationTurns: c.turns.length,
      retiredFacilityFacts: c.facts.length,
      incidentGeneratedTextToLabel: c.incidents.length,
      qualityThumbnailsToRedact: c.thumbnails.length,
      closedObservationsToRedact: c.observations.length,
      total,
    },
    protected: {
      correctionAndAliasRecords: "Excluded by table and domain allowlist",
      operationalIncidentRows: c.operationalIncidents.length,
      confirmedQualityRows: c.qualityRows.length,
      openInventoryObservations: c.openObservations.length,
      inventoryLedgerEffects: "Excluded; inventory lots, ledger entries, and product references are never cleanup targets",
    },
    cutoffs: {
      conversationBefore: c.conversationBefore.toISOString(),
      thumbnailBefore: c.thumbnailBefore.toISOString(),
      observationBefore: c.observationBefore.toISOString(),
    },
  };
}

function ids(rows: Candidate[]): Array<number | string> {
  return rows.map((row) => row.id);
}

export async function applyAiRetentionCleanup(now = new Date()): Promise<AiRetentionReport> {
  const scope = currentScope();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${markerPrefix(scope)}))`);
    const c = await limitedCandidates(tx, scope, now);
    const counts = [c.turns, c.facts, c.incidents, c.thumbnails, c.observations].map((rows) => rows.length);
    const total = counts.reduce((sum, value) => sum + value, 0);
    if (total === 0) return;
    if (counts.some((value) => value > AI_RETENTION_BATCH_LIMIT) || total > AI_RETENTION_BATCH_LIMIT) {
      throw new Error("AI retention cleanup exceeds the bounded batch limit");
    }

    if (c.turns.length) await tx.delete(aiConversationTurnsTable)
      .where(inArray(aiConversationTurnsTable.id, ids(c.turns) as number[]));
    if (c.facts.length) await tx.delete(facilityKnowledgeTable)
      .where(inArray(facilityKnowledgeTable.id, ids(c.facts) as number[]));
    for (const row of c.incidents) {
      await tx.update(incidentsTable).set({
        diagnosis: sql`case
          when ${incidentsTable.diagnosis} is null or ${incidentsTable.diagnosis} like '[Unverified generated text]%' then ${incidentsTable.diagnosis}
          else '[Unverified generated text] ' || ${incidentsTable.diagnosis}
        end`,
        workaround: sql`case
          when ${incidentsTable.workaround} is null or ${incidentsTable.workaround} like '[Unverified generated text]%' then ${incidentsTable.workaround}
          else '[Unverified generated text] ' || ${incidentsTable.workaround}
        end`,
      }).where(and(eq(incidentsTable.id, String(row.id)), eq(incidentsTable.scope, scope)));
    }
    if (c.thumbnails.length) await tx.update(qualityChecksTable).set({ thumbnail: null })
      .where(inArray(qualityChecksTable.id, ids(c.thumbnails) as number[]));
    if (c.observations.length) await tx.update(inventoryObservationsTable)
      .set({ photos: [], draft: { retention: "redacted" }, updatedAt: now })
      .where(inArray(inventoryObservationsTable.id, ids(c.observations) as number[]));

    await tx.insert(dataHealsTable).values({
      id: `${markerPrefix(scope)}:${now.toISOString()}`,
      result: {
        scope,
        policyVersion: AI_RETENTION_VERSION,
        deletedConversationTurns: c.turns.length,
        deletedFacilityFacts: c.facts.length,
        labeledIncidentRows: c.incidents.length,
        redactedQualityThumbnails: c.thumbnails.length,
        redactedClosedObservations: c.observations.length,
        retainedOperationalIncidentRows: c.operationalIncidents.length,
        skippedConfirmedQualityRows: c.qualityRows.length,
        skippedOpenObservations: c.openObservations.length,
      },
    }).onConflictDoNothing({ target: dataHealsTable.id });
  });
  return buildAiRetentionReport(db, now);
}