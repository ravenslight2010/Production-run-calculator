import { describe, expect, it } from "vitest";
import {
  GetBuildInfoResponse,
  GetProfileDataHealthWorkspaceResponse,
} from "./generated/api";
const statusSchema =
  GetProfileDataHealthWorkspaceResponse.shape.workspace.shape
    .sourceReconciliation;
describe("fresh self-host generated response contracts", () => {
  it("accepts explicitly not-applicable audit status, not fabricated report fields", () => {
    const result = statusSchema.parse({
      status: "not-applicable",
      buildProfile: "self-host-fresh",
      reason: "legacy-production-audit-not-packaged",
      findings: [],
    });
    expect(result).toEqual({
      status: "not-applicable",
      buildProfile: "self-host-fresh",
      reason: "legacy-production-audit-not-packaged",
      findings: [],
    });
  });
  it("rejects invented not-applicable reasons, profiles, missing state and fabricated findings", () => {
    const fresh = {
      status: "not-applicable",
      buildProfile: "self-host-fresh",
      reason: "legacy-production-audit-not-packaged",
      findings: [],
    };
    for (const patch of [
      { status: "clean" },
      { reason: "verified" },
      { buildProfile: "production" },
      { findings: [{ id: "fabricated" }] },
    ])
      expect(statusSchema.safeParse({ ...fresh, ...patch }).success).toBe(
        false,
      );
  });
  it("publishes the accurately labeled fresh build identity", () => {
    const info = {
      schemaVersion: 1,
      kind: "app-build-info",
      appBuildId: "app-build:00000000-0000-0000-0000-000000000000",
      sourcePolicy: "self-host-fresh-source-v1",
      sourceFingerprintSha256: "a".repeat(64),
      gitRevision: null,
      gitBinding: "unavailable",
      completedAt: "2026-10-31T01:00:00.000Z",
      buildMode: "self-host-fresh",
      platformDeploymentId: null,
      platformBuildId: null,
      platformIdentitySource: "unavailable",
    };
    const parsed = GetBuildInfoResponse.parse(info);
    expect(parsed.completedAt).toBeInstanceOf(Date);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(info);
  });
});
