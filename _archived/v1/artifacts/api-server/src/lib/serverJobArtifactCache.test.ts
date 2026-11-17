import { randomUUID } from "node:crypto";
import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalReportSnapshotId } from "./canonicalReportExport";
import { pruneServerJobArtifacts, readServerJobArtifact, writeServerJobArtifact } from "./serverJobArtifactCache";

describe("server job export artifact cache", () => {
  it("retains a bounded generated artifact outside job JSON with its canonical identity", async () => {
    const jobId = randomUUID();
    const bytes = Buffer.alloc(1024 * 1024, "x"); // representative large export; never stored as base64/JSON
    const saved = await writeServerJobArtifact(jobId, "xlsx", bytes);
    const loaded = await readServerJobArtifact(jobId, "xlsx");
    expect(saved.byteLength).toBe(bytes.byteLength);
    expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded).toEqual(bytes);
    expect(canonicalReportSnapshotId({ id: jobId, contentHash: saved.sha256 }))
      .toBe(`finalized:${jobId}:${saved.sha256}`);
    expect(await readServerJobArtifact(randomUUID(), "xlsx")).toBeNull();
  });

  it("explicitly removes expired artifacts during scheduled retention", async () => {
    const jobId = randomUUID();
    await writeServerJobArtifact(jobId, "csv", Buffer.from("expired"));
    const path = join(process.env.SERVER_JOB_ARTIFACT_DIR ?? "/tmp/api-server-job-artifacts", `${jobId}.csv`);
    const expiredAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(path, expiredAt, expiredAt);
    expect(await pruneServerJobArtifacts()).toBeGreaterThanOrEqual(1);
    expect(await readServerJobArtifact(jobId, "csv")).toBeNull();
  });
});