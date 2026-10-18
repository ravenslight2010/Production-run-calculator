// Google Gemini models served via Replit AI Integrations or the direct Gemini
// API (GOOGLE_API_KEY). gemini-3.6-flash is the current model: it honors JSON
// response mode and supports vision and streaming — the right fit for this
// real-time floor app. The 2.5 family is restricted for new users: with this
// account's key, the direct API returns 404 "no longer available to new users"
// for gemini-2.5-flash / 2.5-pro / 2.0-flash (verified 2026-09-22), and Google
// points to gemini-3.6-flash. Both tiers point at it; keep the two names so
// callers can still signal intent and the tiers can diverge later without
// touching call sites.
export const AI_MODELS = {
  full: "gemini-3.6-flash",
  cheap: "gemini-3.6-flash",
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
