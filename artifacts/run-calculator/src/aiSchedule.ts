import type { FormValues, RunMeta } from "./types";
import { buildShapedRun } from "./runShaping";
import type { ScheduleRunInput } from "./inventoryShared";
import { normalizeAllergen } from "@workspace/allergen";

// AI schedule-optimizer client builder. Maps the day's planned runs to the
// compact schedule-run shape the /ai/schedule-optimize endpoint expects, reusing
// the shared buildShapedRun mapping (id/label/brand/flavor/dieType) so run
// identity stays consistent with the optimize/summary features, and pulling the
// allergen straight off the run's form values. Kept in lockstep with the mobile
// context/aiSchedule.ts so both platforms send identically-shaped data
// (replit.md parity rule).

// Build the schedule-optimize input from the day's runs (in their current
// order). Every run with form values contributes; ordering is advisory only.
export function buildScheduleInput(args: {
  nowMs: number;
  runs: RunMeta[];
  runValues: (run: RunMeta) => FormValues | undefined;
}): ScheduleRunInput[] {
  const out: ScheduleRunInput[] = [];
  for (const run of args.runs) {
    const vals = args.runValues(run);
    if (!vals) continue;
    const o = buildShapedRun(run, vals, args.nowMs);
    out.push({
      id: o.id,
      label: o.label,
      brand: o.brand,
      flavor: o.flavor,
      allergen: normalizeAllergen(vals.allergen),
      dieType: o.dieType,
    });
  }
  return out;
}
