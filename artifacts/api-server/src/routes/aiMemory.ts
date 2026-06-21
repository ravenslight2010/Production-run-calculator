import { Router, type IRouter, type Request, type Response } from "express";
import { SaveFacilityKnowledgeBody, AppendConversationBody } from "@workspace/api-zod";
import {
  listFacilityKnowledge,
  recordFacilityKnowledge,
  listConversationTurns,
  recordConversationTurns,
} from "./aiMemoryContext";

const router: IRouter = Router();

// Shared AI memory HTTP surface. Sits behind the router-level requireAuth, so
// the facility pool is readable/writable by any signed-in user (operators
// included), matching the corrections/alias precedent. Conversation history is
// strictly per-user: every conversation route is scoped to req.userId, so a user
// can only ever see or extend their own history.

const MAX_BATCH = 1000;

router.get("/ai-memory/facility", async (req: Request, res: Response) => {
  try {
    const knowledge = await listFacilityKnowledge();
    res.json({ knowledge });
  } catch (err) {
    req.log.error({ err }, "failed to list facility knowledge");
    res.status(500).json({ error: "Failed to list facility knowledge" });
  }
});

router.post("/ai-memory/facility", async (req: Request, res: Response) => {
  const parsed = SaveFacilityKnowledgeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    const knowledge = await recordFacilityKnowledge(parsed.data.knowledge.slice(0, MAX_BATCH));
    res.json({ knowledge });
  } catch (err) {
    req.log.error({ err }, "failed to save facility knowledge");
    res.status(500).json({ error: "Failed to save facility knowledge" });
  }
});

router.get("/ai-memory/conversation", async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const turns = await listConversationTurns(userId);
    res.json({ turns });
  } catch (err) {
    req.log.error({ err }, "failed to get conversation history");
    res.status(500).json({ error: "Failed to get conversation history" });
  }
});

router.post("/ai-memory/conversation", async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = AppendConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    const turns = await recordConversationTurns(userId, parsed.data.turns.slice(0, MAX_BATCH));
    res.json({ turns });
  } catch (err) {
    req.log.error({ err }, "failed to append conversation turns");
    res.status(500).json({ error: "Failed to append conversation turns" });
  }
});

export default router;
