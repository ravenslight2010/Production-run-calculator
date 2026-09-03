import { Router } from "express";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireCapability, requireManagerRole } from "../middlewares/requireCapability";
import {
  FIELD_CHECK_MAX_BATCH,
  buildFieldChecksReport,
  hardwareConfirmationObservation,
  recordFieldCheckBatch,
  validateFieldCheckBatch,
  validateHardwareConfirmation,
} from "../lib/fieldChecks";

const router = Router();
const INGEST_WINDOW_MS = 60_000;
const INGEST_MAX = 60;
const ingestStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(INGEST_WINDOW_MS)
    : undefined;

/**
 * Staff clients submit only observations made by this browser. This endpoint
 * never creates an incident and never calls an AI provider.
 */
router.post(
  "/field-checks/observations",
  rateLimit({
    windowMs: INGEST_WINDOW_MS,
    max: INGEST_MAX,
    keyGenerator: (req) => `field-checks:${req.userId ?? req.ip ?? "unknown"}`,
    store: ingestStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateFieldCheckBatch(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    // The schema already limits each request to a small batch. Keep this
    // explicit guard close to the route so a future validator change cannot
    // accidentally turn this into a bulk-ingest endpoint.
    if (validation.data.length > FIELD_CHECK_MAX_BATCH) {
      res.status(400).json({ error: "Too many field-check observations" });
      return;
    }
    const result = await recordFieldCheckBatch(validation.data);
    res.status(202).json(result);
  },
);

router.get(
  "/field-checks",
  requireCapability("review-incidents"),
  async (_req, res): Promise<void> => {
    res.json(await buildFieldChecksReport());
  },
);

router.post(
  "/field-checks/hardware-confirmations",
  requireCapability("review-incidents"),
  requireManagerRole,
  async (req, res): Promise<void> => {
    const validation = validateHardwareConfirmation(req.body);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    const result = await recordFieldCheckBatch([
      hardwareConfirmationObservation(validation.data),
    ]);
    res.status(201).json(result);
  },
);

export default router;