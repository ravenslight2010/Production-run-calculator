// Centralized model selection so cost/latency routing lives in one place instead
// of a model string hardcoded at every call site.
//
//   "full"  → most capable general model. Use for reasoning-heavy tasks
//             (optimize, forecast, diagnosis, day summary, incident clustering,
//             anomaly narration, schedule optimization, vision, structured parse).
//   "cheap" → cost-effective, high-volume / low-reasoning tasks
//             (name matching, alias lookup, fill-missing suggestions, command
//             classification). Quality where it matters, cheaper/faster elsewhere.
export const AI_MODELS = {
  full: "gpt-5.4",
  cheap: "gpt-5-mini",
} as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return AI_MODELS[kind];
}
