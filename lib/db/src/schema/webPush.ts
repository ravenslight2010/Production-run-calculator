import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// A subscription is deliberately scoped: the sandbox account must never receive
// a live-factory alert even if a browser reuses the same endpoint.
export const webPushSubscriptionsTable = pgTable(
  "web_push_subscriptions",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    contentEncoding: text("content_encoding").notNull().default("aes128gcm"),
    enabled: boolean("enabled").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("web_push_subscription_scope_user_endpoint_idx").on(t.scope, t.userId, t.endpoint)],
);

// Insert-before-send is the durable claim. The unique key makes a given alert
// at-most-once per subscribed device across worker/API instances and retries.
export const webPushDeliveriesTable = pgTable(
  "web_push_deliveries",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    alertId: text("alert_id").notNull(),
    alertKind: text("alert_kind").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    status: text("status").notNull().default("claimed"),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastErrorCode: text("last_error_code"),
  },
  (t) => [uniqueIndex("web_push_delivery_alert_subscription_idx").on(t.scope, t.alertId, t.subscriptionId)],
);

// Fifteen-minute alerts are armed only while the canonical countdown is above
// the threshold. This prevents a worker deployed/restarted mid-run from
// announcing an old, already-below-threshold milestone.
export const webPushAlertArmsTable = pgTable(
  "web_push_alert_arms",
  {
    scope: text("scope").notNull().default("live"),
    runKey: text("run_key").notNull(),
    alertKind: text("alert_kind").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("web_push_alert_arm_scope_run_kind_idx").on(t.scope, t.runKey, t.alertKind)],
);

// Logical alert evidence is separate from per-device delivery claims.  It is
// retained even with no subscriptions/VAPID configuration, making scheduled
// evaluation auditable and independently deduplicated.
export const scheduledAlertRecordsTable = pgTable(
  "scheduled_alert_records",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull().default("live"),
    alertId: text("alert_id").notNull(),
    alertKind: text("alert_kind").notNull(),
    date: text("date").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("scheduled_alert_record_scope_alert_idx").on(t.scope, t.alertId)],
);

// Multiple API instances may start the in-process scheduler.  This expiring
// DB lease makes one instance the evaluator without requiring a browser or a
// separate worker process.
export const scheduledJobLeasesTable = pgTable(
  "scheduled_job_leases",
  {
    job: text("job").primaryKey(),
    owner: text("owner").notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);