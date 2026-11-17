import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, supervisorPinSettingsTable } from "@workspace/db";
import { UpdateSupervisorPinBody } from "@workspace/api-zod";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";
import { broadcastMasterDataChanged } from "./sync";
import { timingSafeEqual, createHash } from "node:crypto";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";

const router: IRouter = Router();

// Shared convenience gate, not a backend role. Reads expose status only;
// verification is online and all protected APIs retain independent capabilities.
const settingsRowId = (scope: string) => (scope === "sandbox" ? 2 : 1);

async function loadPin(): Promise<string> {
  const scope = currentScope();
  const [row] = await db
    .select()
    .from(supervisorPinSettingsTable)
    .where(eq(supervisorPinSettingsTable.scope, scope));
  if (row) return row.pin;
  const [created] = await db
    .insert(supervisorPinSettingsTable)
    .values({ id: settingsRowId(scope), scope })
    .onConflictDoNothing({ target: supervisorPinSettingsTable.scope })
    .returning();
  if (created) return created.pin;
  const [existing] = await db
    .select()
    .from(supervisorPinSettingsTable)
    .where(eq(supervisorPinSettingsTable.scope, scope));
  if (!existing) throw new Error("PIN configuration unavailable");
  return existing.pin;
}

router.get("/supervisor-pin", async (req: Request, res: Response) => {
  try {
    const pin = await loadPin();
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: pin !== "" });
  } catch (err) {
    req.log.error({ err }, "failed to get supervisor pin");
    res.status(500).json({ error: "Failed to get supervisor pin" });
  }
});

// Unlike the general-purpose limiter, verification must fail closed if the
// shared backing store is unavailable. Never log the request or entered PIN.
const verificationWindowMs = 15 * 60_000;
const verificationStore = new PostgresRateLimitStore(verificationWindowMs);
router.post("/supervisor-pin/verify", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const entered = req.body?.pin;
  if (req.body) delete req.body.pin;
  if (typeof entered !== "string" || !/^\d{4,8}$/.test(entered)) {
    res.status(400).json({ error: "Enter a PIN of 4 to 8 digits." });
    return;
  }
  try {
    const scope = currentScope();
    for (const [kind, identity, max] of [
      ["principal", req.userId ?? "unknown", 10],
      ["source", req.ip ?? "unknown", 40],
    ] as const) {
      const identityHash = createHash("sha256").update(identity).digest("hex");
      const result = await verificationStore.hit(`pin:${scope}:${kind}:${identityHash}`, verificationWindowMs, Date.now());
      if (result.count > max) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
        res.status(429).json({ error: "Too many PIN attempts. Try again later." });
        return;
      }
    }
    const pin = await loadPin();
    const digest = (value: string) => createHash("sha256").update(value).digest();
    const verified = pin === "" || timingSafeEqual(digest(entered), digest(pin));
    res.status(verified ? 200 : 403).json({ verified });
  } catch {
    res.status(503).json({ error: "PIN verification is unavailable. Try again online." });
  } finally {
    // Do not leave the secret on the request for later middleware/diagnostics.
    if (req.body) delete req.body.pin;
  }
});

router.put(
  "/supervisor-pin",
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    const parsed = UpdateSupervisorPinBody.safeParse(req.body);
    if (req.body) delete req.body.pin;
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    // An empty PIN is allowed and means "no PIN / unlocked" facility-wide — it is
    // the result of the mobile "Remove PIN lock" action and is honored as a
    // no-gate state by both clients. The PIN is a low-security convenience gate,
    // not a secret, so an empty value is a valid facility setting.
    const pin = parsed.data.pin.trim();
    try {
      const scope = currentScope();
      await db
        .insert(supervisorPinSettingsTable)
        .values({ id: settingsRowId(scope), scope, pin, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: supervisorPinSettingsTable.scope,
          set: { pin, updatedAt: new Date() },
        })
        .returning({ updatedAt: supervisorPinSettingsTable.updatedAt });
      broadcastMasterDataChanged(req.header("x-client-id") ?? "", scope, "supervisor-pin");
      res.setHeader("Cache-Control", "no-store");
      res.json({ configured: pin !== "" });
    } catch (err) {
      req.log.error("failed to update supervisor pin");
      res.status(500).json({ error: "Failed to update supervisor pin" });
    } finally {
      if (req.body) delete req.body.pin;
    }
  },
);

export default router;
