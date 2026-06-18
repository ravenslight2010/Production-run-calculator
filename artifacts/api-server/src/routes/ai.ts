import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { rateLimit } from "../middlewares/rateLimit";
import { requireRole } from "../middlewares/requireRole";
import {
  buildOptimizePrompt,
  sanitizeRecommendations,
  validateOptimizeBody,
} from "./aiOptimize";

const router: IRouter = Router();

// Cost/abuse guard for the paid AI endpoint: per-user fixed window. Matches the
// photo-intake endpoint's posture (10 requests / minute).
const OPTIMIZE_RATE_WINDOW_MS = 60_000;
const OPTIMIZE_RATE_MAX = 10;

router.post(
  "/ai/optimize",
  requireRole("manager"),
  rateLimit({
    windowMs: OPTIMIZE_RATE_WINDOW_MS,
    max: OPTIMIZE_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  }),
  async (req, res): Promise<void> => {
    const validation = validateOptimizeBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const { system, user } = buildOptimizePrompt(validation.data);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "ai-optimize call failed");
      res.status(502).json({ error: "AI provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "ai-optimize non-JSON response");
      res.json({ recommendations: [], generatedAt: Date.now() });
      return;
    }

    const { recommendations, note } = sanitizeRecommendations(raw);
    res.json({
      recommendations,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

export default router;
