import type { FormValues, RunMeta } from "./types";
import { buildOptimizeRun } from "./aiOptimize";
import type { ScheduleRunInput, ScheduleAllergen } from "./inventoryShared";

// AI schedule-optimizer client builder. Maps the day's planned runs to the
// compact schedule-run shape the /ai/schedule-optimize endpoint expects, reusing
// the shared buildOptimizeRun mapping (id/label/brand/flavor/dieType) so run
// identity stays consistent with the optimize/summary features, and pulling the
// allergen straight off the run's form values. Kept in lockstep with the mobile
// context/aiSchedule.ts so both platforms send identically-shaped data
// (replit.md parity rule).

function normAllergen(v: unknown): ScheduleAllergen {
  const s = String(v ?? "none").trim().toLowerCase();
  return s === "egg" || s === "soy" ? s : "none";
}

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
    const o = buildOptimizeRun(run, vals, args.nowMs);
    out.push({
      id: o.id,
      label: o.label,
      brand: o.brand,
      flavor: o.flavor,
      allergen: normAllergen(vals.allergen),
      dieType: o.dieType,
    });
  }
  return out;
}
