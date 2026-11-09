import { backfillFreezerAlertProjection, hasCompleteFreezerAlertProjection } from "./freezerAlertProjection";
import { registerServerJob, ServerJobCancellationError } from "./serverJobs";

registerServerJob("freezer-alert-projection-backfill", {
  capability: "manage-staff",
  maxAttempts: 1,
  timeoutMs: 6 * 60_000,
  handler: async (context) => {
    if (context.signal.aborted || await context.isCancellationRequested()) {
      throw new ServerJobCancellationError();
    }

    const input = context.job.input;
    const expectedScope = input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).expectedScope
      : undefined;
    if (expectedScope !== context.job.scope) {
      throw new Error("The active scope changed. Run the sync self-check again before backfilling.");
    }

    await context.reportProgress(5, "Checking freezer alert projection status");
    if (await hasCompleteFreezerAlertProjection(context.job.scope)) {
      return {
        status: "already-complete",
        examinedDays: 0,
        projectedRuns: 0,
      };
    }

    await context.reportProgress(10, "Rebuilding from canonical daily snapshots");
    const result = await backfillFreezerAlertProjection(context.job.scope, {
      signal: context.signal,
    });
    await context.reportProgress(100, "Projection parity verified");
    return { status: "completed", ...result };
  },
});
