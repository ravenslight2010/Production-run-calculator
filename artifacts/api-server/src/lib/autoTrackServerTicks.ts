import { randomUUID } from "node:crypto";
import {
  buildAppSlotClaimMutations,
  buildAutoTrackScheduleFromPayload,
  buildSauceClaimMutations,
  computeServerCalc,
} from "@workspace/live-calc";
import type { AutoTrackClaim } from "./autoTrackCoordination";

/** Channels the server tick loop executes (refactor step 7a): the net-second
 * channels whose due times the server derives purely from stored state
 * (anchor + cadence vs pause-aware elapsed net seconds). The wall-clock
 * channels (case/tray/batch/hopper) depend on client arm-state machines
 * (period advance, remainder carry, feed-complete gates) and stay
 * client-driven; the server only echoes their canonical coordination. */
export const SERVER_TICK_CHANNELS = new Set<string>([
  "sauce-barrel",
  "app1-batch",
  "app2-batch",
  "app3-batch",
  "app4-batch",
]);

export function isServerTickChannel(channel: string): boolean {
  return SERVER_TICK_CHANNELS.has(channel);
}

/**
 * Build server-driven auto-track claims for the current run when a net-second
 * channel is due now. Pure (no DB): the tick runner applies each claim through
 * the SAME parse/apply pipeline as a client POST, so every invariant
 * (sequence, generation, correction generation, mutation from-checks, sauce
 * inventory) still holds. Returns [] for runs without a computable schedule or
 * with no due net-second channels.
 */
export function buildNetSecondServerClaims(
  payload: unknown,
  nowMs = Date.now(),
): AutoTrackClaim[] {
  let calc;
  let schedule;
  try {
    // Skeletal/incomplete run values cannot drive the calc (computeServerCalc
    // throws on missing form fields); an un-computable run simply has no
    // server ticks, exactly like the SSE/claim paths' calc guards.
    calc = computeServerCalc(payload as never, []);
    schedule = buildAutoTrackScheduleFromPayload(payload, calc, nowMs);
  } catch {
    return [];
  }
  if (!schedule) return [];
  const p = (payload ?? {}) as {
    runValues?: Record<string, Record<string, unknown>>;
    runValuesUpdatedAt?: Record<string, number>;
    autoTrackCoordination?: { runs?: Record<string, Record<string, unknown>> };
  };
  const runId = schedule.runId;
  const values = p.runValues?.[runId] ?? {};
  const baseUpdatedAt = Number(p.runValuesUpdatedAt?.[runId]) || 0;
  const coordinationForRun = p.autoTrackCoordination?.runs?.[runId] as
    | Partial<Record<string, { sequence?: number; generation?: string; nextDueAt?: number }>>
    | undefined;
  const claims: AutoTrackClaim[] = [];

  for (const entry of schedule.entries) {
    if (!isServerTickChannel(entry.channel) || !entry.dueNow) continue;
    const state = coordinationForRun?.[entry.channel];
    const sequence = (typeof state?.sequence === "number" ? state.sequence : 0) + 1;
    const slot = entry.channel.slice(0, 4);
    const correctionField = entry.channel === "sauce-barrel"
      ? "sauceBarrelCorrectionGeneration"
      : `${slot}BatchCorrectionGeneration`;
    const correctionGeneration = Math.max(0, Number(values[correctionField]) || 0);
    const countField = entry.channel === "sauce-barrel"
      ? "sauceBarrelsMade"
      : `${slot}BatchesMade`;
    const anchorField = entry.channel === "sauce-barrel"
      ? "sauceBarrelAnchorNetSec"
      : `${slot}BatchAnchorNetSec`;
    const countFrom = Math.max(0, Number(values[countField]) || 0);
    const anchorFrom = Math.max(0, Number(values[anchorField]) || 0);
    const mutations = entry.channel === "sauce-barrel"
      ? buildSauceClaimMutations({
          countFrom,
          countTo: countFrom + 1,
          anchorFrom,
          anchorTo: entry.dueAt,
          correctionGeneration,
        })
      : buildAppSlotClaimMutations({
          slot: slot as "app1" | "app2" | "app3" | "app4",
          madeFrom: countFrom,
          madeTo: countFrom + 1,
          anchorFrom,
          anchorTo: entry.dueAt,
          correctionGeneration,
        });
    claims.push({
      version: 1,
      runId,
      channel: entry.channel,
      generation: schedule.generation,
      sequence,
      eventId: `srv:${sequence}:${entry.channel}:${randomUUID()}`,
      dueAt: entry.dueAt,
      nextDueAt: entry.nextDueAt,
      baseUpdatedAt,
      correctionGeneration,
      mutations,
    });
  }
  return claims;
}
