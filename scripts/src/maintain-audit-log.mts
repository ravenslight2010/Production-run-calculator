import pg from "pg";

const MAX_STRING_LENGTH = 200;
const MAX_CHANGES_BYTES = 8_192;

export type AuditMaintenanceAction = "redact" | "delete";

export type AuditMaintenanceOptions = {
  action: AuditMaintenanceAction;
  auditId: number;
  authorizedBy: string;
  reason: string;
  operator: string;
  changes?: Record<string, unknown>;
};

type ParsedArgs = { options?: AuditMaintenanceOptions; error?: string };

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function boundedArgument(args: string[], flag: string): string | undefined {
  const value = valueAfter(args, flag)?.trim();
  return value && value.length <= MAX_STRING_LENGTH ? value : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function parseAuditMaintenanceArgs(args: string[]): ParsedArgs {
  if (args[0] === "--") args = args.slice(1);
  const allowedFlags = new Set([
    "--action",
    "--audit-id",
    "--authorized-by",
    "--reason",
    "--operator",
    "--changes-json",
  ]);
  for (const arg of args) {
    if (arg.startsWith("--") && !allowedFlags.has(arg)) {
      return { error: `Unknown option: ${arg}` };
    }
  }

  const action = valueAfter(args, "--action");
  if (action !== "redact" && action !== "delete") {
    return { error: "--action must be redact or delete" };
  }

  const rawAuditId = valueAfter(args, "--audit-id");
  const auditId = Number(rawAuditId);
  if (!Number.isInteger(auditId) || auditId < 1) {
    return { error: "--audit-id must be a positive integer" };
  }

  const authorizedBy = boundedArgument(args, "--authorized-by");
  if (!authorizedBy) return { error: "--authorized-by is required and must be 1 to 200 characters" };
  const reason = boundedArgument(args, "--reason");
  if (!reason) return { error: "--reason is required and must be 1 to 200 characters" };
  const operator = boundedArgument(args, "--operator");
  if (!operator) return { error: "--operator is required and must be 1 to 200 characters" };

  const rawChanges = valueAfter(args, "--changes-json");
  if (action === "delete" && (rawChanges !== undefined || hasFlag(args, "--changes-json"))) {
    return { error: "--changes-json is only valid for redact" };
  }
  if (action === "redact" && rawChanges === undefined) {
    return { error: "--changes-json is required for redact" };
  }

  let changes: Record<string, unknown> | undefined;
  if (rawChanges !== undefined) {
    try {
      const parsed: unknown = JSON.parse(rawChanges);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "--changes-json must contain a JSON object" };
      }
      if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > MAX_CHANGES_BYTES) {
        return { error: "--changes-json exceeds the permitted size" };
      }
      changes = parsed as Record<string, unknown>;
    } catch {
      return { error: "--changes-json must contain valid JSON" };
    }
  }

  return { options: { action, auditId, authorizedBy, reason, operator, changes } };
}

export async function runAuditMaintenance(
  options: AuditMaintenanceOptions,
  connectionString: string,
): Promise<{ approvalId: number; auditId: number; action: AuditMaintenanceAction }> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2_000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE audit_maintenance");
    const role = await client.query<{ current_user: string }>("SELECT current_user");
    if (role.rows[0]?.current_user !== "audit_maintenance") {
      throw new Error("maintenance connection could not assume audit_maintenance");
    }

    const approval = await client.query<{ approval_id: number }>(
      `SELECT public.record_audit_maintenance_approval($1, $2, $3, $4, $5) AS approval_id`,
      [options.auditId, options.action, options.authorizedBy, options.reason, options.operator],
    );
    const approvalId = Number(approval.rows[0]?.approval_id);
    if (!Number.isInteger(approvalId) || approvalId < 1) {
      throw new Error("maintenance approval did not return an audit ID");
    }

    let applied = false;
    if (options.action === "redact") {
      const operation = await client.query<{ redacted: boolean }>(
        `SELECT public.redact_audit_log($1, $2::jsonb) AS redacted`,
        [options.auditId, JSON.stringify(options.changes)],
      );
      applied = Boolean(operation.rows[0]?.redacted);
    } else {
      const operation = await client.query<{ deleted: boolean }>(
        `SELECT public.delete_audit_log($1, $2) AS deleted`,
        [options.auditId, options.reason],
      );
      applied = Boolean(operation.rows[0]?.deleted);
    }
    if (!applied) throw new Error(`audit log ${options.auditId} was not changed`);

    await client.query("COMMIT");
    return { approvalId, auditId: options.auditId, action: options.action };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseAuditMaintenanceArgs(argv);
  if (parsed.error) throw new Error(parsed.error);
  const connectionString = process.env.AUDIT_MAINTENANCE_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("AUDIT_MAINTENANCE_DATABASE_URL must be set; refusing to use the application database connection");
  }
  const result = await runAuditMaintenance(parsed.options!, connectionString);
  process.stdout.write(`${JSON.stringify({ outcome: "success", ...result })}\n`);
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "audit maintenance failed"}\n`);
    process.exitCode = 1;
  });
}