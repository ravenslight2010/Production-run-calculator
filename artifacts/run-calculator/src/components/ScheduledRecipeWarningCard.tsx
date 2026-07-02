import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  findScheduledRecipeIssues,
  type ScheduledRunRef,
} from "@workspace/scheduled-recipe-check";
import { loadRawProfile } from "../storage";

// Advisory "Recipe Setup Needed" card on the Scheduled Days screen (managers only).
//
// The reorder/transfer demand projections resolve each upcoming scheduled run to
// its saved brand+flavor profile. When that profile is missing or carries no
// real recipe data, the run's material demand silently falls back to a blank
// default form — making the reorder numbers untrustworthy. This card surfaces
// those runs so a manager can set the profile up. Detection (and the dedup /
// ordering) lives in @workspace/scheduled-recipe-check so this card and the
// mobile one flag identically (replit.md parity). Read-only — advisory.
export default function ScheduledRecipeWarningCard({
  scheduledRuns,
  onSetup,
}: {
  scheduledRuns: ScheduledRunRef[];
  onSetup: (brand: string, flavor: string) => void;
}) {
  const issues = findScheduledRecipeIssues(scheduledRuns, loadRawProfile);
  if (issues.length === 0) return null;

  return (
    <Card
      className="bg-rose-950/30 border-rose-700/40 shadow-md mb-4"
      data-testid="scheduled-recipe-warning-card"
    >
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> Recipe Setup Needed
          <span className="ml-1 font-normal normal-case text-xs text-rose-400/80">
            ({issues.length} scheduled run{issues.length !== 1 ? "s" : ""})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1.5">
        <p className="text-[11px] text-rose-300/70 leading-snug mb-1">
          These scheduled runs have no saved recipe, so their reorder demand falls
          back to defaults. Set up each profile to make the projections accurate.
        </p>
        {issues.map((it) => (
          <button
            key={`${it.brand}\u0000${it.flavor}`}
            type="button"
            onClick={() => onSetup(it.brand, it.flavor)}
            className="w-full flex items-baseline justify-between gap-2 text-sm rounded-md px-2 py-1.5 -mx-1 hover:bg-rose-900/30 transition-colors text-left"
            data-testid={`scheduled-recipe-warning-${it.brand}-${it.flavor}`}
          >
            <span className="text-rose-100/90 truncate">
              {it.brand}
              {it.flavor ? ` — ${it.flavor}` : ""}
              <span className="ml-1.5 text-[11px] text-rose-400/70">
                {it.reason === "missing" ? "no profile" : "no recipe rows"} ·{" "}
                {it.totalCases} case{it.totalCases !== 1 ? "s" : ""}
              </span>
            </span>
            <span className="font-medium whitespace-nowrap text-rose-200 flex items-center gap-1">
              Set up <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
