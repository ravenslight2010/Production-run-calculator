import express from "express";
import syncRouter, { stopSyncOutboxFanout } from "../routes/sync";
import { requireAuth } from "../middlewares/requireAuth";
import { startupGate } from "../lib/startupGate";
import { noStoreMiddleware } from "../lib/cacheControl";
import doughRecipesRouter from "../routes/doughRecipes";
import healthRouter from "../routes/health";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use((req, _res, next) => {
  // Test fixture logger: production middleware supplies the real pino logger.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).log = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  next();
});
// Match the parent soak's minimal API composition. The convergence case also
// writes one dough recipe to verify master-data outbox fanout, so mount that
// route alongside /sync without importing the rest of the API.
app.use("/api", noStoreMiddleware);
app.use("/api", startupGate);
app.use("/api", healthRouter);
app.use("/api", requireAuth);
app.use("/api", syncRouter);
app.use("/api", doughRecipesRouter);

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind a TCP port");
  process.send?.({ type: "ready", port: address.port });
});

const close = () => {
  stopSyncOutboxFanout();
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
};

process.once("SIGTERM", close);
process.once("SIGINT", close);

process.on("message", (message: unknown) => {
  if (
    message
    && typeof message === "object"
    && (message as { type?: unknown }).type === "stop-sync-outbox-listener"
    && typeof (message as { requestId?: unknown }).requestId === "string"
  ) {
    stopSyncOutboxFanout();
    process.send?.({
      type: "sync-outbox-stopped",
      requestId: (message as { requestId: string }).requestId,
    });
    return;
  }

  if (
    !message
    || typeof message !== "object"
    || (message as { type?: unknown }).type !== "run-daily-rollover"
    || typeof (message as { requestId?: unknown }).requestId !== "string"
  ) {
    return;
  }

  const requestId = (message as { requestId: string }).requestId;
  const options = (message as {
    options?: { nowMs?: number; timeZone?: string };
  }).options;
  void import("../routes/sync")
    .then(({ runDailyRollover }) => runDailyRollover("live", options))
    .then((result) => process.send?.({ type: "operation-result", requestId, ok: true, result }))
    .catch(() => process.send?.({ type: "operation-result", requestId, ok: false }));
});