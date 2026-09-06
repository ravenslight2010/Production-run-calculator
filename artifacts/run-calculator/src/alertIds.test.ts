import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stableAlertId } from "./alertIds";

describe("stableAlertId", () => {
  it("matches the server run-generation digest contract", async () => {
    const runId = "run-42";
    const startedAt = 1_789_000_000_000;
    const digest = createHash("sha256")
      .update(`${runId}:${startedAt}`)
      .digest("hex")
      .slice(0, 24);

    await expect(
      stableAlertId(runId, startedAt, "batch:3", "2026-09-06"),
    ).resolves.toBe(`2026-09-06:${digest}:batch:3`);
  });

  it("changes when a reset reuses the run ID with a new generation", async () => {
    const first = await stableAlertId("run-42", 100, "run-complete", "2026-09-06");
    const replacement = await stableAlertId("run-42", 200, "run-complete", "2026-09-06");
    expect(replacement).not.toBe(first);
  });
});