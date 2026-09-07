import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Durable, bounded work accepted by the API.  Inputs are immutable snapshots:
 * handlers may write a result reference, but never replace the request input.
 */
export const serverJobsTable = pgTable(
  "server_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull().default("live"),
    type: text("type").notNull(),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"),
    input: jsonb("input").notNull(),
    snapshotId: text("snapshot_id"),
    progress: integer("progress").notNull().default(0),
    progressMessage: text("progress_message"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    result: jsonb("result"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("server_jobs_scope_actor_idempotency_idx").on(t.scope, t.actorId, t.idempotencyKey),
    index("server_jobs_scope_status_created_idx").on(t.scope, t.status, t.createdAt),
    index("server_jobs_lease_expires_idx").on(t.leaseExpiresAt),
    index("server_jobs_expires_idx").on(t.expiresAt),
  ],
);

/** Attempt receipts preserve retry diagnostics after a job reaches a terminal state. */
export const serverJobAttemptsTable = pgTable(
  "server_job_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    attempt: integer("attempt").notNull(),
    workerId: text("worker_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome").notNull().default("running"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (t) => [
    uniqueIndex("server_job_attempts_job_attempt_idx").on(t.jobId, t.attempt),
    index("server_job_attempts_job_started_idx").on(t.jobId, t.startedAt),
  ],
);

export type ServerJobRow = typeof serverJobsTable.$inferSelect;
export type ServerJobAttemptRow = typeof serverJobAttemptsTable.$inferSelect;