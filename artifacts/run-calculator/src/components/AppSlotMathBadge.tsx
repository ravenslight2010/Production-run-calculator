/**
 * AppSlotMathBadge — inline conflict flag for applicator slot math mismatches.
 *
 * Shows a yellow warning strip when the sum of an applicator slot's recipe
 * row lbs (oz/pizza per ingredient) disagrees with the slot's oz/pizza total
 * field (appNOzPerPizza). Clicking the strip expands a detail panel that shows
 * the two values side-by-side and offers resolution buttons.
 *
 * Resolution options:
 *  • "Use row sum" — set the oz/pizza total to match the sum of the rows
 *  • "Scale rows"  — scale each row proportionally so the sum matches the total
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  detectAppSlotConflicts,
  resolveByRowSum,
  resolveByTotal,
  type AppRecipeRow,
} from "@workspace/setup-math-check";

export interface AppSlotMathBadgeProps {
  /** The applicator's recipe rows (lbs = oz/pizza per ingredient). */
  rows: AppRecipeRow[];
  /** The appNOzPerPizza field value. */
  ozPerPizza: number;
  /** Called with the new oz/pizza value when the manager anchors on the row sum. */
  onResolveByRowSum: (newOzPerPizza: number) => void;
  /** Called with scaled rows when the manager anchors on the oz/pizza total. */
  onResolveByTotal: (scaledRows: AppRecipeRow[]) => void;
}

export function AppSlotMathBadge({
  rows,
  ozPerPizza,
  onResolveByRowSum,
  onResolveByTotal,
}: AppSlotMathBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  const conflicts = detectAppSlotConflicts(rows, ozPerPizza);
  if (conflicts.length === 0) return null;

  const conflict = conflicts[0];
  if (conflict.kind !== "row-sum-vs-total") return null;

  const { rowSum, total } = conflict;

  function handleResolveByRowSum() {
    onResolveByRowSum(resolveByRowSum(rowSum));
    setExpanded(false);
  }

  function handleResolveByTotal() {
    onResolveByTotal(resolveByTotal(rows, total));
    setExpanded(false);
  }

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 space-y-2">
      {/* Badge header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 w-full text-left"
        aria-expanded={expanded}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="text-[12px] font-medium text-amber-700 dark:text-amber-400 flex-1 leading-tight">
          Math mismatch: rows sum to{" "}
          <span className="font-mono font-bold">{rowSum.toFixed(2)}</span> oz/pizza, total
          field says{" "}
          <span className="font-mono font-bold">{total.toFixed(2)}</span> oz/pizza
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {expanded ? "▲ less" : "▼ fix"}
        </span>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="space-y-2.5 pt-1.5 border-t border-amber-500/25">
          {/* Side-by-side values */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md bg-muted/50 px-2.5 py-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Row sum
              </div>
              <div className="font-mono font-bold text-[13px]">
                {rowSum.toFixed(3)} oz/pizza
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Sum of ingredient rows
              </div>
            </div>
            <div className="rounded-md bg-muted/50 px-2.5 py-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Total field
              </div>
              <div className="font-mono font-bold text-[13px]">
                {total.toFixed(3)} oz/pizza
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Oz Per Pizza field
              </div>
            </div>
          </div>

          {/* Resolution buttons */}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={handleResolveByRowSum}
              className="w-full px-3 py-1.5 rounded-md border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-[11px] font-semibold text-amber-800 dark:text-amber-300 transition-colors text-left"
            >
              Use row sum → set "Oz Per Pizza" to {rowSum.toFixed(2)}
            </button>
            <button
              type="button"
              onClick={handleResolveByTotal}
              className="w-full px-3 py-1.5 rounded-md border border-border/60 bg-muted/40 hover:bg-muted/70 text-[11px] font-semibold text-foreground transition-colors text-left"
            >
              Scale rows → adjust ingredient rows to sum to {total.toFixed(2)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
