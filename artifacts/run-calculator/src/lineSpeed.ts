// Line-speed computation now lives in @workspace/live-calc (shared by client
// and server). This file is kept as a thin re-export so existing callers
// (aiOptimize, runInsights, home) don't need to change their import paths.
export {
  computeEffectiveLineSpeed,
  type EffectiveLineSpeedInput,
  type LineSpeedMode,
} from "@workspace/live-calc";
