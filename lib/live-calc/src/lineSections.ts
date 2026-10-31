import { resolveLineTiming } from "./lineTiming";
import type { ComputeLinePhasesArgs, PhaseInfo } from "./linePhases";

export type LineSections = Record<"pressOven" | "frontline" | "freezeTunnel" | "packaging", PhaseInfo>;
export const LINE_SECTION_KEYS = ["pressOven", "frontline", "freezeTunnel", "packaging"] as const;

/** Four physical sections. Numbered legacy stages keep their original meaning. */
export function computeLineSections(args: ComputeLinePhasesArgs): LineSections {
  const timing = resolveLineTiming(args);
  const lengths = [timing.pressOvenMin, timing.frontlineMin, timing.tunnelMin, timing.postTunnelMin];
  const labels = ["Press / Oven", "Frontline", "Freeze Tunnel", "Wrapper / Packaging"];
  const production = Number.isFinite(args.elapsedBatchSec) ? Math.max(0, args.elapsedBatchSec / 60) : 0;
  const rows: PhaseInfo[] = labels.map((label) => ({ label, state: "empty", remainMs: 0 }));
  const result = () => Object.fromEntries(LINE_SECTION_KEYS.map((key, i) => [key, rows[i]])) as LineSections;
  const set = (i: number, state: PhaseInfo["state"], minutes = 0) => {
    rows[i] = { label: labels[i], state, remainMs: Math.max(0, minutes * 60000) };
  };
  const fill = (elapsed: number, state: "filling" | "resuming", heldTunnel = false) => {
    let offset = 0;
    lengths.forEach((length, i) => {
      if (i === 2 && heldTunnel) {
        set(i, elapsed < offset ? "paused" : "active");
        return;
      }
      if (length > 0 && elapsed >= offset) {
        set(i, elapsed < offset + length ? state : "active", offset + length - elapsed);
        if (rows[i].state === "active") rows[i].remainMs = 0;
      }
      offset += length;
    });
  };
  // A finite production pulse occupies [travel, travel + production] along
  // the line. Pair separation changes positions, not the quantity of pizzas.
  const drain = (travel: number) => {
    let offset = 0;
    lengths.forEach((length, i) => {
      const end = offset + length;
      if (length > 0 && travel < end && travel + production > offset) {
        set(i, travel >= offset ? "draining" : "active", travel >= offset ? end - travel : 0);
      }
      offset = end;
    });
  };
  if (production <= 0 || (timing.totalMin <= 0 && args.runStatus === "ended")) return result();
  if (args.runStatus === "ended" && args.endedAt != null) {
    drain(Math.max(0, args.nowMs - args.endedAt) / 60000);
  } else if (args.runStatus === "paused" && args.pausedAt != null) {
    const elapsed = Math.max(0, args.nowMs - args.pausedAt) / 60000;
    if (args.pauseStopsTunnel === false || elapsed < timing.preTunnelMin) {
      drain(elapsed);
    } else {
      if (timing.tunnelMin > 0) set(2, "paused");
      const wrapperElapsed = elapsed - timing.preTunnelMin;
      if (timing.postTunnelMin > 0 && wrapperElapsed < timing.postTunnelMin &&
        production + timing.preTunnelMin > timing.totalMin - timing.postTunnelMin) {
        set(3, "draining", timing.postTunnelMin - wrapperElapsed);
      }
    }
  } else if (args.runStatus === "running") {
    const pauseDuration = Math.max(0, args.lastResumeWallMs - args.lastPauseStartWallMs) / 60000;
    const sinceResume = Math.max(0, args.nowMs - args.lastResumeWallMs) / 60000;
    const held = args.lastPauseStopsTunnel !== false && pauseDuration >= timing.preTunnelMin;
    if (args.lastResumeWallMs > 0 && (held || args.lastPauseStopsTunnel === false) &&
      sinceResume < (held ? timing.preTunnelMin + timing.postTunnelMin : timing.totalMin)) {
      fill(sinceResume, "resuming", held && timing.tunnelMin > 0);
    } else {
      fill(production, "filling");
    }
  }
  return result();
}
