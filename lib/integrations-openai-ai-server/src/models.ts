export const AI_MODELS = {
  full: "gpt-5",
  cheap: "gpt-5-mini",
} as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return AI_MODELS[kind];
}
