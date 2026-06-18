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
  status: string;
  createdAt: string;
  reviewedAt: string | null;
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
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
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

// Mark an incident reviewed. Guarded on the current status so a re-review is a
// no-op that still returns the (already reviewed) row rather than 404'ing.
export async function markIncidentReviewed(id: string): Promise<IncidentDTO | null> {
  const [existing] = await db
    .select()
    .from(incidentsTable)
    .where(eq(incidentsTable.id, id));
  if (!existing) return null;
  if (existing.status === "reviewed") return toDTO(existing);
  const [row] = await db
    .update(incidentsTable)
    .set({ status: "reviewed", reviewedAt: new Date() })
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
