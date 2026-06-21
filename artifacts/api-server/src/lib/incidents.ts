import { desc, eq, isNull, sql } from "drizzle-orm";
import { db, incidentsTable, type Incident } from "@workspace/db";
import { newUserId } from "./auth";

// What we capture about a problem. For a user report this is mostly the user's
// own words (`description`); for an auto-captured crash it's the error message
// and stack. `userAgent` is recorded when the client sends one.
export type IncidentContext = {
  description?: string;
  errorMessage?: string;
  errorStack?: string;
  userAgent?: string;
};

export type IncidentSource = "user_report" | "auto_crash";

// "Seen before" signal computed at report time from past similar incidents in
// the shared facility-memory pool. `count` is how many prior similar incidents
// were found; `lastWorkaround` echoes the recovery step that helped previously.
// Null when this incident has no precedent. Stored on the incident so the
// manager review list can flag recurring problems, and returned to the reporter.
export type IncidentRecurrence = {
  count: number;
  lastWorkaround: string | null;
};

// The shape returned over the wire (matches the OpenAPI `Incident` schema):
// timestamps are ISO strings and the jsonb context is a typed object.
export type IncidentDTO = {
  id: string;
  source: IncidentSource;
  reporterId: string | null;
  reporterName: string | null;
  reporterRole: string | null;
  screen: string;
  appPlatform: string;
  appVersion: string | null;
  context: IncidentContext;
  diagnosis: string | null;
  workaround: string | null;
  recurrence: IncidentRecurrence | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  resolvedAt: string | null;
};

function toDTO(row: Incident): IncidentDTO {
  return {
    id: row.id,
    source: row.source as IncidentSource,
    reporterId: row.reporterId,
    reporterName: row.reporterName,
    reporterRole: row.reporterRole,
    screen: row.screen,
    appPlatform: row.appPlatform,
    appVersion: row.appVersion,
    context: (row.context ?? {}) as IncidentContext,
    diagnosis: row.diagnosis,
    workaround: row.workaround,
    recurrence: (row.recurrence as IncidentRecurrence | null) ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

export type CreateIncidentInput = {
  source: IncidentSource;
  reporterId: string | null;
  reporterName: string | null;
  reporterRole: string | null;
  screen: string;
  appPlatform: string;
  appVersion: string | null;
  context: IncidentContext;
  diagnosis: string | null;
  workaround: string | null;
  recurrence: IncidentRecurrence | null;
};

// Record a new incident (status defaults to "new"). The AI diagnosis is computed
// by the route before this is called and stored alongside the raw context so a
// manager reviewing later sees the exact explanation the reporter saw.
export async function createIncident(input: CreateIncidentInput): Promise<IncidentDTO> {
  const [row] = await db
    .insert(incidentsTable)
    .values({
      id: newUserId(),
      source: input.source,
      reporterId: input.reporterId,
      reporterName: input.reporterName,
      reporterRole: input.reporterRole,
      screen: input.screen,
      appPlatform: input.appPlatform,
      appVersion: input.appVersion,
      context: input.context,
      diagnosis: input.diagnosis,
      workaround: input.workaround,
      recurrence: input.recurrence,
    })
    .returning();
  return toDTO(row);
}

// All incidents, newest first, for the manager review list.
export async function listIncidents(): Promise<IncidentDTO[]> {
  const rows = await db
    .select()
    .from(incidentsTable)
    .orderBy(desc(incidentsTable.createdAt));
  return rows.map(toDTO);
}

export async function getIncident(id: string): Promise<IncidentDTO | null> {
  const [row] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, id));
  return row ? toDTO(row) : null;
}

// Mark an incident reviewed. Guarded on the current status so it only applies to
// a still-new incident: re-reviewing — or marking an already-resolved incident
// reviewed — is a no-op that returns the existing row rather than downgrading it
// or 404'ing.
export async function markIncidentReviewed(id: string): Promise<IncidentDTO | null> {
  const [existing] = await db
    .select()
    .from(incidentsTable)
    .where(eq(incidentsTable.id, id));
  if (!existing) return null;
  if (existing.status !== "new") return toDTO(existing);
  const [row] = await db
    .update(incidentsTable)
    .set({ status: "reviewed", reviewedAt: new Date() })
    .where(eq(incidentsTable.id, id))
    .returning();
  return row ? toDTO(row) : toDTO(existing);
}

// Mark an incident resolved (the underlying problem is considered fixed/handled).
// "resolved" implies "reviewed", so we also stamp reviewedAt if it wasn't set
// yet — this keeps the unreviewed nav-badge count correct when a manager jumps
// a still-new incident straight to resolved. Re-resolving is a no-op.
export async function markIncidentResolved(id: string): Promise<IncidentDTO | null> {
  const [existing] = await db
    .select()
    .from(incidentsTable)
    .where(eq(incidentsTable.id, id));
  if (!existing) return null;
  if (existing.status === "resolved") return toDTO(existing);
  const now = new Date();
  const [row] = await db
    .update(incidentsTable)
    .set({
      status: "resolved",
      resolvedAt: now,
      reviewedAt: existing.reviewedAt ?? now,
    })
    .where(eq(incidentsTable.id, id))
    .returning();
  return row ? toDTO(row) : toDTO(existing);
}

// Count incidents still awaiting review, for the manager nav badge.
export async function countUnreviewedIncidents(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(incidentsTable)
    .where(isNull(incidentsTable.reviewedAt));
  return row?.count ?? 0;
}

export type { Incident };
