import { describe, expect, it } from "vitest";
import { parseAuditMaintenanceArgs } from "./maintain-audit-log.mts";

describe("audit maintenance command", () => {
  it("requires approval evidence and a bounded redaction object", () => {
    expect(parseAuditMaintenanceArgs([
      "--action", "redact",
      "--audit-id", "42",
      "--authorized-by", "compliance@example.test",
      "--reason", "Remove an accidental personal detail",
      "--operator", "operator@example.test",
      "--changes-json", '{"outcome":"redacted","reasonCode":"approved"}',
    ])).toEqual({
      options: {
        action: "redact",
        auditId: 42,
        authorizedBy: "compliance@example.test",
        reason: "Remove an accidental personal detail",
        operator: "operator@example.test",
        changes: { outcome: "redacted", reasonCode: "approved" },
      },
    });
  });

  it("does not allow delete to carry an unbounded replacement payload", () => {
    expect(parseAuditMaintenanceArgs([
      "--action", "delete",
      "--audit-id", "42",
      "--authorized-by", "compliance",
      "--reason", "Approved removal",
      "--operator", "operator",
      "--changes-json", "{}",
    ]).error).toContain("--changes-json is only valid");
  });

  it("requires the maintenance-specific action and connection inputs", () => {
    expect(parseAuditMaintenanceArgs([
      "--action", "update",
      "--audit-id", "42",
      "--authorized-by", "compliance",
      "--reason", "Approved",
      "--operator", "operator",
    ]).error).toContain("--action must be redact or delete");
    expect(parseAuditMaintenanceArgs([
      "--action", "redact",
      "--audit-id", "42",
      "--authorized-by", "compliance",
      "--reason", "Approved",
      "--operator", "operator",
    ]).error).toContain("--changes-json is required");
  });

  it("accepts the argument separator forwarded by pnpm", () => {
    expect(parseAuditMaintenanceArgs([
      "--",
      "--action", "delete",
      "--audit-id", "42",
      "--authorized-by", "compliance",
      "--reason", "Approved",
      "--operator", "operator",
    ]).options).toMatchObject({
      action: "delete",
      auditId: 42,
    });
  });
});