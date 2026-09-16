import express from "express";
import { pool } from "@workspace/db";
import router from "./index";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use((req, _res, next) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
  next();
});
app.use("/api", router);

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Isolated API process did not receive a TCP port");
  }
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});

async function shutdown(): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});