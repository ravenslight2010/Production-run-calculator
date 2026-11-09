import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("./freezerAlertProjection", () => ({
  backfillFreezerAlertProjection: mocks.backfill,
  hasCompleteFreezerAlertProjection: mocks.complete,
}));

import { getServerJobDefinition, ServerJobCancellationError, type ServerJobContext } from "./serverJobs";
import "./freezerAlertProjectionJob";

function context(signal = new AbortController().signal) {
  return {
    job: { scope: "live", input: { expectedScope: "live" } },
    signal,
    reportProgress: vi.fn(async () => {}),
    isCancellationRequested: vi.fn(async () => false),
    commit: vi.fn(),
  } as unknown as ServerJobContext;
}

describe("freezer alert projection backfill job", () => {
  beforeEach(() => {
    mocks.backfill.mockReset();
    mocks.complete.mockReset();
  });

  it("registers a bounded manager-only operation", () => {
    const definition = getServerJobDefinition("freezer-alert-projection-backfill");

    expect(definition).toMatchObject({
      capability: "manage-staff",
      maxAttempts: 1,
      timeoutMs: 6 * 60_000,
    });
    expect(definition?.handler).toBeTypeOf("function");
  });

  it("does not rebuild a projection already marked complete", async () => {
    mocks.complete.mockResolvedValue(true);
    const jobContext = context();

    const result = await getServerJobDefinition("freezer-alert-projection-backfill")!.handler!(jobContext);

    expect(result).toEqual({ status: "already-complete", examinedDays: 0, projectedRuns: 0 });
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it("backfills the job's server-selected scope and verifies completion", async () => {
    mocks.complete.mockResolvedValue(false);
    mocks.backfill.mockResolvedValue({ examinedDays: 98, projectedRuns: 12 });
    const jobContext = context();

    const result = await getServerJobDefinition("freezer-alert-projection-backfill")!.handler!(jobContext);

    expect(mocks.backfill).toHaveBeenCalledWith("live", { signal: jobContext.signal });
    expect(result).toEqual({ status: "completed", examinedDays: 98, projectedRuns: 12 });
    expect(jobContext.reportProgress).toHaveBeenNthCalledWith(1, 5, "Checking freezer alert projection status");
    expect(jobContext.reportProgress).toHaveBeenLastCalledWith(100, "Projection parity verified");
  });

  it("does not begin a backfill after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const jobContext = context(controller.signal);

    await expect(
      getServerJobDefinition("freezer-alert-projection-backfill")!.handler!(jobContext),
    ).rejects.toBeInstanceOf(ServerJobCancellationError);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it("rejects a stale scope before reading or writing projection data", async () => {
    const jobContext = {
      ...context(),
      job: { scope: "live", input: { expectedScope: "sandbox" } },
    } as ServerJobContext;

    await expect(
      getServerJobDefinition("freezer-alert-projection-backfill")!.handler!(jobContext),
    ).rejects.toThrow(/active scope changed/i);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.backfill).not.toHaveBeenCalled();
  });
});
