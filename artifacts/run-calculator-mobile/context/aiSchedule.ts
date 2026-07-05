import { buildOptimizeRun } from "./aiOptimize";
import type { ScheduleRunInput } from "./inventoryShared";
import type { RunState } from "./RunContext";
import { normalizeAllergen } from "@workspace/allergen";

// AI schedule-optimizer client builder. EXACT mirror of the web src/aiSchedule.ts:
// maps the day's planned runs to the compact schedule-run shape the
// /ai/schedule-optimize endpoint expects, reusing the shared buildOptimizeRun
// mapping (id/label/brand/flavor/dieType) so run identity stays consistent with
// the optimize/summary features, and pulling the allergen straight off the run's
// settings. Kept in lockstep with the web builder so both platforms send
// identically-shaped data (replit.md parity rule).

// Build the schedule-optimize input from the day's runs (in their current
// order). Every run contributes; ordering is advisory only.
export function buildScheduleInput(args: {
  nowMs: number;
  runs: RunState[];
}): ScheduleRunInput[] {
  return args.runs.map((run, index) => {
    const o = buildOptimizeRun(run, index, args.nowMs);
    return {
      id: o.id,
      label: o.label,
      brand: o.brand,
      flavor: o.flavor,
      allergen: normalizeAllergen(run.settings.allergen),
      dieType: o.dieType,
    };
  });
}
