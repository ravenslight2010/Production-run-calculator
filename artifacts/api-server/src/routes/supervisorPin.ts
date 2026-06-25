import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, supervisorPinSettingsTable } from "@workspace/db";
import { UpdateSupervisorPinBody } from "@workspace/api-zod";
import { requireCapability } from "../middlewares/requireCapability";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Facility-wide supervisor PIN (single row per scope). Reading is open to any
// signed-in user so both apps can do the local PIN compare that gates supervisor
// actions (the PIN is a low-security convenience gate, not a secret — it already
// lived in plain device storage). Changing it is manager-gated so the
// facility-wide gate can't be moved out from under everyone by any user. Mirrors
// the inventory_settings single-setting precedent (open GET, manager PUT).

const DEFAULT_PIN = "1234";
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
  return existing?.pin ?? DEFAULT_PIN;
}

router.get("/supervisor-pin", async (req: Request, res: Response) => {
  try {
    const pin = await loadPin();
    res.json({ pin });
  } catch (err) {
    req.log.error({ err }, "failed to get supervisor pin");
    res.status(500).json({ error: "Failed to get supervisor pin" });
  }
});

router.put(
  "/supervisor-pin",
  requireCapability("manage-staff"),
  async (req: Request, res: Response) => {
    const parsed = UpdateSupervisorPinBody.safeParse(req.body);
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
      const [row] = await db
        .insert(supervisorPinSettingsTable)
        .values({ id: settingsRowId(scope), scope, pin, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: supervisorPinSettingsTable.scope,
          set: { pin, updatedAt: new Date() },
        })
        .returning();
      res.json({ pin: row?.pin ?? pin });
    } catch (err) {
      req.log.error({ err }, "failed to update supervisor pin");
      res.status(500).json({ error: "Failed to update supervisor pin" });
    }
  },
);

export default router;
