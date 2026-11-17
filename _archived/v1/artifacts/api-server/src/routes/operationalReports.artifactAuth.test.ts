import { describe, expect, it } from "vitest";
import { resolveRetainedArtifact, retainedExportIsAuthorized } from "./operationalReports";

describe("retained canonical export authorization", () => {
  const hash = "a".repeat(64);
  const snapshotId = `finalized:report-1:${hash}`;
  const valid = {
    scope: "facility-a", type: "export-package", status: "succeeded",
    input: { finalizedReportId: "report-1", format: "xlsx" },
    result: { canonicalSnapshotId: snapshotId, contentHash: hash, artifactSha256: "b".repeat(64) },
  };

  it("requires the same scope, completed export job, immutable snapshot and format", () => {
    expect(retainedExportIsAuthorized(valid, "facility-a", "report-1", "xlsx", snapshotId, hash)).toBe(true);
    expect(retainedExportIsAuthorized({ ...valid, scope: "facility-b" }, "facility-a", "report-1", "xlsx", snapshotId, hash)).toBe(false);
    expect(retainedExportIsAuthorized({ ...valid, status: "running" }, "facility-a", "report-1", "xlsx", snapshotId, hash)).toBe(false);
    expect(retainedExportIsAuthorized({ ...valid, input: { finalizedReportId: "report-2", format: "xlsx" } }, "facility-a", "report-1", "xlsx", snapshotId, hash)).toBe(false);
    expect(retainedExportIsAuthorized({ ...valid, input: { finalizedReportId: "report-1", format: "csv" } }, "facility-a", "report-1", "xlsx", snapshotId, hash)).toBe(false);
    expect(retainedExportIsAuthorized({ ...valid, result: { ...valid.result, canonicalSnapshotId: "other" } }, "facility-a", "report-1", "xlsx", snapshotId, hash)).toBe(false);
  });

  it("regenerates immutable canonical bytes when another instance has no local artifact", () => {
    const canonical = Buffer.from("snapshot-id,content-hash,immutable-report");
    let generations = 0;
    const recovered = resolveRetainedArtifact(null, "0".repeat(64), () => {
      generations++;
      return canonical;
    });
    expect(recovered).toEqual({ bytes: canonical, source: "canonical-regenerated" });
    expect(generations).toBe(1);
  });
});