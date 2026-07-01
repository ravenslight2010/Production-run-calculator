// Google Gemini models served via Replit AI Integrations. gemini-2.5-flash is
// the stable model that reliably honors JSON response mode, supports vision and
// streaming, and (with thinking disabled in the client adapter) returns output
// within any token budget at low latency — the right fit for this real-time
// floor app. Both tiers point at it; keep the two names so callers can still
// signal intent and the tiers can diverge later without touching call sites.
export const AI_MODELS = {
  full: "gemini-2.5-flash",
  cheap: "gemini-2.5-flash",
} as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return AI_MODELS[kind];
}
