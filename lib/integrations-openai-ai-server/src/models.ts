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

// These backups are used only after eligible provider failures or empty
// successful responses. They do not replace the selected primary model.
export const MODEL_FALLBACKS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"] as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return AI_MODELS[kind];
}

/** The selected model stays primary; fallback models are tried in fixed order. */
export function modelChain(primary: string): readonly string[] {
  return [primary, ...MODEL_FALLBACKS.filter((fallback) => fallback !== primary)];
}
