// Google Gemini models served via Replit AI Integrations. gemini-2.5-flash
// is the current model: it honors JSON response mode and supports vision and
// streaming — the right fit for this real-time floor app. Unlike the former
// Gemini 3.x models, 2.5-flash does NOT support thinkingLevel (see client.ts).
// Both tiers point at it; keep the two names so callers can still signal intent
// and the tiers can diverge later without touching call sites.
export const AI_MODELS = {
  full: "gemini-2.5-flash",
  cheap: "gemini-2.5-flash",
} as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return AI_MODELS[kind];
}
