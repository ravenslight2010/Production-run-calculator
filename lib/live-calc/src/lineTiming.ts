import { FACTORY_TIMING_DEFAULTS } from "@workspace/factory-constants";

export interface LineTimingInput {
  freezerTime?: unknown;
  preTunnelMin?: unknown;
  postTunnelMin?: unknown;
  pressOvenMin?: unknown;
  frontlineMin?: unknown;
}

/** Missing/invalid values are compatibility allocations, never measurements. */
export function resolveLineTiming(input: LineTimingInput) {
  const duration = (value: unknown): number | undefined =>
    (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
      Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
  const totalMin = duration(input.freezerTime) ?? 0;
  const legacyPre = duration(input.preTunnelMin) ?? FACTORY_TIMING_DEFAULTS.preTunnelMin;
  let postTunnelMin = duration(input.postTunnelMin) ?? FACTORY_TIMING_DEFAULTS.postTunnelMin;
  const press = duration(input.pressOvenMin);
  const frontline = duration(input.frontlineMin);
  // A partial split allocates the unassigned part of the old combined window.
  // A fully explicit split controls that window; tunnel time is the remainder.
  let pressOvenMin = press ?? (frontline === undefined ? legacyPre / 2 : Math.max(0, legacyPre - frontline));
  let frontlineMin = frontline ?? (press === undefined ? legacyPre / 2 : Math.max(0, legacyPre - press));
  const outer = pressOvenMin + frontlineMin + postTunnelMin;
  // A missing/zero freezer duration is the historical "unknown" sentinel in
  // existing forms. With no measured total to preserve, keep their pre/post
  // defaults instead of collapsing the line to zero.
  if (totalMin > 0 && outer > totalMin) {
    const scale = totalMin / outer;
    pressOvenMin *= scale;
    frontlineMin *= scale;
    postTunnelMin *= scale;
  }
  const preTunnelMin = pressOvenMin + frontlineMin;
  return {
    totalMin, pressOvenMin, frontlineMin, preTunnelMin, postTunnelMin,
    tunnelMin: Math.max(0, totalMin - preTunnelMin - postTunnelMin),
    compatibilityAllocation: press === undefined || frontline === undefined,
  };
}

/** ppm already counts pizzas, including crustsPerCycle. Never multiply it again. */
export function lineThroughput(ppm: number) {
  const pizzasPerMinute = Number.isFinite(ppm) ? Math.max(0, ppm) : 0;
  return { pizzasPerMinute, pairsPerMinute: pizzasPerMinute / 2 };
}
