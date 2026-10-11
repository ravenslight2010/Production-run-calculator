import express from "express";
import router from "../routes/index";

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
app.use("/api", router);

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind a TCP port");
  process.send?.({ type: "ready", port: address.port });
});

const close = () => {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
};

process.once("SIGTERM", close);
process.once("SIGINT", close);

process.on("message", (message: unknown) => {
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