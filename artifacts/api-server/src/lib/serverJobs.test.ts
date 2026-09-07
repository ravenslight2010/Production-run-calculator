import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertBoundedJobInput,
  assertBoundedJobResult,
  getServerJobDefinition,
  registerServerJob,
  startServerJobWorkerLoop,
} from "./serverJobs";

describe("server job contract boundaries", () => {
  it("keeps only declared workload types and bounded JSON inputs", () => {
    expect(getServerJobDefinition("workbook-parse")?.capability).toBe("use-ai-tools");
    expect(() => registerServerJob("not valid", { capability: "manage-profiles" })).toThrow("Invalid");
    expect(() => registerServerJob("too-many-retries", { capability: "manage-profiles", maxAttempts: 6 })).toThrow("between 1 and 5");
    expect(() => assertBoundedJobInput({ content: "x".repeat(513 * 1024) })).toThrow("exceeds");
    expect(() => assertBoundedJobResult({ content: "x".repeat(513 * 1024) })).toThrow("exceeds");
    expect(() => assertBoundedJobInput({ content: "small immutable snapshot" })).not.toThrow();
    // The existing flattened workbook parse contract allows 60,000 characters;
    // its serialized snapshot must fit before a worker accepts it.
    expect(() => assertBoundedJobInput({ workbookText: "x".repeat(60_000), known: { brands: ["Factory"] } })).not.toThrow();
  });

  it("starts no more than the configured number of in-process jobs", async () => {
    const pending: Array<() => void> = [];
    const runOnce = vi.fn(() => new Promise<boolean>((resolve) => pending.push(() => resolve(false))));
    const prune = vi.fn(async () => 0);
    const loop = startServerJobWorkerLoop({
      worker: { runOnce }, prune, concurrency: 2, intervalMs: 60_000, pruneIntervalMs: 60_000,
    });
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledTimes(1);
    loop.stop();
    pending.splice(0).forEach((resolve) => resolve());
  });
});