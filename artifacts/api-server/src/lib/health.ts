import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type AuditProtectionRow = {
  has_trigger: boolean;
  has_guard_function: boolean;
  has_redact_function: boolean;
  has_delete_function: boolean;
};

export type AuditProtectionCheck = {
  status: "ok" | "error";
  detail?: string;
};

const AUDIT_PROTECTION_QUERY = sql`
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS table_row
        ON table_row.oid = trigger_row.tgrelid
      JOIN pg_namespace AS schema_row
        ON schema_row.oid = table_row.relnamespace
      WHERE schema_row.nspname = 'public'
        AND table_row.relname = 'audit_logs'
        AND trigger_row.tgname = 'audit_logs_append_only_guard'
        AND NOT trigger_row.tgisinternal
        -- BEFORE UPDATE OR DELETE FOR EACH ROW, enabled for normal writes.
        AND trigger_row.tgtype = 27
        AND trigger_row.tgenabled = 'O'
        AND trigger_row.tgfoid =
          to_regprocedure('public.audit_logs_append_only_guard()')
    ) AS has_trigger,
    EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = to_regprocedure('public.audit_logs_append_only_guard()')
        AND prorettype = 'pg_catalog.trigger'::regtype
    ) AS has_guard_function,
    EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = to_regprocedure('public.redact_audit_log(integer,jsonb)')
        AND prorettype = 'pg_catalog.bool'::regtype
    ) AS has_redact_function,
    EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = to_regprocedure('public.delete_audit_log(integer,text)')
        AND prorettype = 'pg_catalog.bool'::regtype
    ) AS has_delete_function
`;

export async function getAuditLogProtectionCheck(): Promise<AuditProtectionCheck> {
  try {
    const result = await db.execute<AuditProtectionRow>(AUDIT_PROTECTION_QUERY);
    const row = result.rows[0];

    if (!row) {
      return {
        status: "error",
        detail: "audit_append_only_protection_probe_returned_no_result",
      };
    }

    const missing: string[] = [];
    if (!row.has_trigger) missing.push("append-only trigger");
    if (!row.has_guard_function) missing.push("guard function");
    if (!row.has_redact_function) missing.push("redact_audit_log(integer,jsonb)");
    if (!row.has_delete_function) missing.push("delete_audit_log(integer,text)");

    return missing.length === 0
      ? { status: "ok" }
      : {
        status: "error",
        detail: `audit_append_only_protection_missing: ${missing.join(", ")}`,
      };
  } catch {
    return {
      status: "error",
      detail: "audit_append_only_protection_probe_failed",
    };
  }
}