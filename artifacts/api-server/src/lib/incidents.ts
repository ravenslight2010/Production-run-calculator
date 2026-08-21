import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, incidentsTable, auditLogsTable, type Incident } from "@workspace/db";
import { newUserId } from "./auth";
import { currentScope } from "./requestScope";

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
  priority: IncidentPriority;
  workflowState: IncidentWorkflowState;
  assigneeId: string | null;
  assigneeName: string | null;
  notes: IncidentNote[];
  activity: IncidentActivity[];
};

export type IncidentPriority = "low" | "normal" | "high" | "urgent";
export type IncidentWorkflowState = "new" | "assigned" | "waiting" | "resolved";
export type IncidentNote = { id: string; authorName: string; text: string; createdAt: string };
export type IncidentActivity = {
  id: string;
  action: string;
  detail: string;
  actorName: string;
  createdAt: string;
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
    priority: (row.priority as IncidentPriority) ?? "normal",
    workflowState: (row.workflowState as IncidentWorkflowState) ?? (row.status === "resolved" ? "resolved" : "new"),
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    notes: (row.notes ?? []) as IncidentNote[],
    activity: (row.activity ?? []) as IncidentActivity[],
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
// manager reviewing later sees the exact explanation the reporter saw. Stamped
// with the reporting session's data scope so sandbox-originated incidents never
// mix into the live review queue (and vice versa).
export async function createIncident(input: CreateIncidentInput): Promise<IncidentDTO> {
  const [row] = await db
    .insert(incidentsTable)
    .values({
      id: newUserId(),
      scope: currentScope(),
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

// All incidents, newest first, for the manager review list. Scoped to the
// caller's session so a sandbox-scoped manager never sees live incidents (and a
// live manager never sees sandbox test noise).
export async function listIncidents(): Promise<IncidentDTO[]> {
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(eq(incidentsTable.scope, currentScope()))
    .orderBy(desc(incidentsTable.createdAt));
  return rows.map(toDTO);
}

export async function getIncident(id: string): Promise<IncidentDTO | null> {
  const [row] = await db
    .select()
    .from(incidentsTable)
    .where(and(eq(incidentsTable.id, id), eq(incidentsTable.scope, currentScope())));
  return row ? toDTO(row) : null;
}

// Mark an incident reviewed. Guarded on the current status so it only applies to
// a still-new incident: re-reviewing — or marking an already-resolved incident
// reviewed — is a no-op that returns the existing row rather than downgrading it
// or 404'ing. Scoped so a sandbox session can never alter a live incident.
export async function markIncidentReviewed(id: string): Promise<IncidentDTO | null> {
  const scope = currentScope();
  const [existing] = await db
    .select()
    .from(incidentsTable)
    .where(and(eq(incidentsTable.id, id), eq(incidentsTable.scope, scope)));
  if (!existing) return null;
  if (existing.status !== "new") return toDTO(existing);
  const [row] = await db
    .update(incidentsTable)
    .set({ status: "reviewed", reviewedAt: new Date() })
    .where(and(eq(incidentsTable.id, id), eq(incidentsTable.scope, scope)))
    .returning();
  return row ? toDTO(row) : toDTO(existing);
}

// Mark an incident resolved (the underlying problem is considered fixed/handled).
// "resolved" implies "reviewed", so we also stamp reviewedAt if it wasn't set
// yet — this keeps the unreviewed nav-badge count correct when a manager jumps
// a still-new incident straight to resolved. Re-resolving is a no-op. Scoped so
// a sandbox session can never alter a live incident.
export async function markIncidentResolved(id: string): Promise<IncidentDTO | null> {
  const scope = currentScope();
  const [existing] = await db
    .select()
    .from(incidentsTable)
    .where(and(eq(incidentsTable.id, id), eq(incidentsTable.scope, scope)));
  if (!existing) return null;
  if (existing.status === "resolved") return toDTO(existing);
  const now = new Date();
  const [row] = await db
    .update(incidentsTable)
    .set({
      status: "resolved",
      workflowState: "resolved",
      resolvedAt: now,
      reviewedAt: existing.reviewedAt ?? now,
    })
    .where(and(eq(incidentsTable.id, id), eq(incidentsTable.scope, scope)))
    .returning();
  return row ? toDTO(row) : toDTO(existing);
}

export async function updateIncidentWorkflow(
  id: string,
  input: {
    priority?: IncidentPriority;
    workflowState?: IncidentWorkflowState;
    assigneeId?: string | null;
    assigneeName?: string | null;
    note?: string;
    actorName: string;
    actorId: string;
  },
): Promise<IncidentDTO | null> {
  const scope = currentScope();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(incidentsTable)
      .where(and(eq(incidentsTable.id, id), eq(incidentsTable.scope, scope))).for("update");
    if (!existing) return null;
    const now = new Date();
    const activity = [...((existing.activity ?? []) as IncidentActivity[])];
    const notes = [...((existing.notes ?? []) as IncidentNote[])];
    const changes: Record<string, unknown> = {};
    const set: Record<string, unknown> = {};
    if (input.priority && input.priority !== existing.priority) {
      set.priority = input.priority; changes.priority = input.priority;
    }
    if (input.workflowState && input.workflowState !== existing.workflowState) {
      set.workflowState = input.workflowState;
      if (input.workflowState === "resolved") { set.status = "resolved"; set.resolvedAt = existing.resolvedAt ?? now; }
      else if (existing.status === "resolved") { set.status = "reviewed"; set.resolvedAt = null; }
      changes.workflowState = input.workflowState;
    }
    if (input.assigneeId !== undefined && (input.assigneeId !== existing.assigneeId || input.assigneeName !== existing.assigneeName)) {
      set.assigneeId = input.assigneeId; set.assigneeName = input.assigneeName ?? null;
      if (!input.workflowState && input.assigneeId) set.workflowState = "assigned";
      changes.assigneeId = input.assigneeId;
    }
    if (input.note?.trim()) {
      const note: IncidentNote = { id: newUserId(), authorName: input.actorName, text: input.note.trim(), createdAt: now.toISOString() };
      notes.push(note); set.notes = notes; changes.note = note.text;
    }
    if (Object.keys(changes).length === 0) return toDTO(existing);
    const action = input.note?.trim() ? "note_added" : "incident_workflow_updated";
    const event: IncidentActivity = { id: newUserId(), action, detail: JSON.stringify(changes), actorName: input.actorName, createdAt: now.toISOString() };
    activity.push(event); set.activity = activity;
    const [row] = await tx.update(incidentsTable).set(set).where(and(eq(incidentsTable.id, id), eq(incidentsTable.scope, scope))).returning();
    await tx.insert(auditLogsTable).values({
      scope, actor: input.actorId, action: `incident_${action}`, resource: id,
      changes, userAgent: undefined, ipAddress: undefined,
    });
    return row ? toDTO(row) : toDTO(existing);
  });
}

// Count incidents still awaiting review, for the manager nav badge. Scoped so
// the sandbox account's own badge never reflects live incident counts.
export async function countUnreviewedIncidents(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(incidentsTable)
    .where(and(isNull(incidentsTable.reviewedAt), eq(incidentsTable.scope, currentScope())));
  return row?.count ?? 0;
}

export async function countActionableIncidents(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(incidentsTable)
    // During the transition to the manager work queue, some already-resolved
    // incidents kept their older `status = resolved` while retaining a stale
    // workflow label such as "waiting". Treat either resolution signal as final
    // so the manager badge never asks for attention on a handled incident.
    .where(and(
      eq(incidentsTable.scope, currentScope()),
      sql`${incidentsTable.status} <> 'resolved'`,
      sql`${incidentsTable.workflowState} <> 'resolved'`,
    ));
  return row?.count ?? 0;
}

export type { Incident };
