import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, webPushSubscriptionsTable } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { vapidPublicKey, validSubscription } from "../lib/webPush";

const router: IRouter = Router();

router.get("/web-push/vapid-public-key", (_req: Request, res: Response): void => {
  const publicKey = vapidPublicKey();
  if (!publicKey) { res.status(503).json({ error: "Web push is not configured" }); return; }
  res.json({ publicKey });
});

router.get("/web-push/subscriptions", async (req: Request, res: Response): Promise<void> => {
  const rows = await db.select({ id: webPushSubscriptionsTable.id, enabled: webPushSubscriptionsTable.enabled, expiresAt: webPushSubscriptionsTable.expiresAt, createdAt: webPushSubscriptionsTable.createdAt })
    .from(webPushSubscriptionsTable).where(and(eq(webPushSubscriptionsTable.scope, currentScope()), eq(webPushSubscriptionsTable.userId, req.userId!)));
  res.json(rows);
});

router.post("/web-push/subscriptions", async (req: Request, res: Response): Promise<void> => {
  const subscription = (req.body as { subscription?: unknown })?.subscription ?? req.body;
  if (!validSubscription(subscription)) { res.status(400).json({ error: "Invalid push subscription" }); return; }
  const expiresAt = subscription.expirationTime ? new Date(subscription.expirationTime) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) { res.status(400).json({ error: "Subscription has expired" }); return; }
  const scope = currentScope();
  const [row] = await db.insert(webPushSubscriptionsTable).values({
    id: randomUUID(), scope, userId: req.userId!, endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, expiresAt, lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [webPushSubscriptionsTable.scope, webPushSubscriptionsTable.userId, webPushSubscriptionsTable.endpoint],
    set: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, expiresAt, enabled: true, lastSeenAt: new Date(), updatedAt: new Date() },
  }).returning({ id: webPushSubscriptionsTable.id, enabled: webPushSubscriptionsTable.enabled, expiresAt: webPushSubscriptionsTable.expiresAt });
  res.status(201).json(row);
});

router.delete("/web-push/subscriptions/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || id.length > 80) { res.status(400).json({ error: "Invalid subscription id" }); return; }
  await db.update(webPushSubscriptionsTable).set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(webPushSubscriptionsTable.id, id), eq(webPushSubscriptionsTable.scope, currentScope()), eq(webPushSubscriptionsTable.userId, req.userId!)));
  res.status(204).end();
});

export default router;