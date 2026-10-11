import { AlertTriangle } from "lucide-react";
import type { ParsedProfile } from "@workspace/spec-import";
import { reviewSpecImportPerPizzaAmounts } from "@workspace/spec-import/per-pizza-review";

export function SpecImportAmountWarnings({
  profile,
  rowKey,
}: {
  profile: ParsedProfile;
  rowKey: string;
}) {
  const warnings = reviewSpecImportPerPizzaAmounts(profile);
  if (!warnings.length) return null;
  return (
    <div
      className="mt-2 rounded-md border border-amber-400/60 bg-amber-500/10 p-2"
      data-testid={`spec-profile-amount-warning-${rowKey}`}
    >
      <div className="flex items-center gap-1.5 text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-semibold">Check per-pizza amounts — advisory only</span>
      </div>
      <ul className="mt-1 space-y-1 text-xs text-amber-700 break-words">
        {warnings.map((message, index) => <li key={index}>{message}</li>)}
      </ul>
    </div>
  );
}