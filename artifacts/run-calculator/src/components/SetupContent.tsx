import { memo } from "react";
import { AlertTriangle, ChevronDown, Package, Settings } from "lucide-react";
import { useSetupTabCtx } from "../contexts/SetupTabCtx";
import RunInsightsCard from "./RunInsightsCard";
import FillMissingPanel from "./FillMissingPanel";
import { NumField } from "./NumField";
import { detectAppSlotConflicts } from "@workspace/setup-math-check";
import {
  type RecipeRow,
  PACKAGING_FIELDS,
  isCartonedValue,
  LABEL_POSITION_OPTIONS,
  PACKAGING_TYPE_OPTIONS,
} from "../types";

/**
 * SetupMathConflictBadge — aggregate math conflicts for the Setup header.
 *
 * The count is intentionally derived during render so edits to any applicator
 * slot are reflected immediately, including in-place recipe-row updates from
 * react-hook-form. Moved out of home.tsx with the Setup panel (refactor step
 * 5); home.tsx re-exports it so the existing render tests keep importing it
 * from "./pages/home".
 */
export function SetupMathConflictBadge({
  slots,
}: {
  slots: Array<{
    rows?: RecipeRow[];
    ozPerPizza?: number;
  }>;
}) {
  const conflictCount = slots.reduce(
    (count, slot) =>
      count +
      detectAppSlotConflicts(
        (slot.rows ?? []) as { ingredient: string; lbs: number }[],
        Number(slot.ozPerPizza) || 0,
      ).length,
    0,
  );

  if (conflictCount === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400"
      data-testid="setup-math-conflict-count"
      aria-label={`${conflictCount} math conflict${conflictCount === 1 ? "" : "s"}`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {conflictCount} math conflict{conflictCount === 1 ? "" : "s"}
    </span>
  );
}

// Memo'd Setup panel extracted from home.tsx (refactor step 5). Reads the
// narrow SetupTabCtx so manage/merge/import dialog churn no longer re-renders
// it — only setup-relevant data (form watch, editable packaging lists, role /
// current-run fields) does.
export default memo(function SetupContent() {
  const {
    v,
    form,
    circles,
    shipper,
    skidStacking,
    gripSheets,
    isManager,
    isSupervisor,
    currentRun,
    doughSubTab,
    commitMissingField,
    applyRunSuggestion,
    getRunSuggestionAcceptWarning,
  } = useSetupTabCtx();
  return (
    <>
                <div className="mb-4 flex items-center gap-2" data-testid="setup-header">
                  <Settings className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-bold">Setup</h2>
                  <SetupMathConflictBadge
                    slots={[
                      { rows: v.app1CheeseRecipe, ozPerPizza: v.app1OzPerPizza },
                      { rows: v.app2CheeseRecipe, ozPerPizza: v.app2OzPerPizza },
                      { rows: v.app3CheeseRecipe, ozPerPizza: v.app3OzPerPizza },
                      { rows: v.app4CheeseRecipe, ozPerPizza: v.app4OzPerPizza },
                    ]}
                  />
                </div>
                {/* Run Insights: manager-only pattern-based setting suggestions
                    from completed runs. One at a time; Accept applies, Dismiss
                    suppresses. Renders nothing when there's nothing to show. */}
                {isManager && (
                  <RunInsightsCard
                    brand={currentRun?.brand ?? ""}
                    flavor={currentRun?.flavor ?? ""}
                    onAccept={applyRunSuggestion}
                    getAcceptWarning={getRunSuggestionAcceptWarning}
                  />
                )}
                <div className="mb-4">
                  <FillMissingPanel
                    getRecord={() => ({
                      ...form.getValues(),
                      brand: currentRun?.brand ?? "",
                      flavor: currentRun?.flavor ?? "",
                      subTab: doughSubTab,
                    })}
                    brand={currentRun?.brand ?? ""}
                    flavor={currentRun?.flavor ?? ""}
                    dieType={form.getValues("dieType") ?? ""}
                    canEdit={isSupervisor}
                    onCommit={commitMissingField}
                  />
                </div>

                {/* Packaging Settings */}
                <details className="group rounded-xl border border-border/50 bg-card/60 shadow-md overflow-hidden mb-4">
                  <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer list-none select-none">
                    <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Package className="w-3.5 h-3.5" />
                      Packaging Settings
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-border/40 px-5 pb-5 pt-4 space-y-4">
                    {PACKAGING_FIELDS.map((f) => {
                      const cur = (v[f.name] as string) ?? "";
                      // The four editable packaging master lists (circles / shipper /
                      // skidStacking / gripSheets) draw their selectable options from
                      // the live, user-editable lists so options added in Setup
                      // Profiles appear here too — mirroring the die-type pattern.
                      // cartoned (Packaging Type) and slipSheets stay fixed.
                      const editableList: string[] | null =
                        f.name === "circles" ? circles
                        : f.name === "shipper" ? shipper
                        : f.name === "skidStacking" ? skidStacking
                        : f.name === "gripSheets" ? gripSheets
                        : null;
                      const opts = editableList ?? f.options;
                      // "cartoned" is the Packaging Type field: render its fixed
                      // options via their display labels (e.g. "n-a" → "N/A").
                      const isPackagingType = f.name === "cartoned";
                      return (
                        <div key={f.name}>
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                            {f.label}
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {opts.map((opt) => {
                              const active = cur === opt;
                              const optLabel = isPackagingType
                                ? PACKAGING_TYPE_OPTIONS.find((o) => o.value === opt)?.label ?? opt
                                : opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() =>
                                    form.setValue(f.name, active ? "" : opt, { shouldDirty: true })
                                  }
                                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${isPackagingType ? "" : "capitalize"} ${
                                    active
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"
                                  }`}
                                >
                                  {optLabel}
                                </button>
                              );
                            })}
                          </div>
                          {/* Label position — only relevant for Labeled runs. Shown
                              directly under the Packaging Type selector. */}
                          {f.name === "cartoned" && cur.trim().toLowerCase() === "labeled" && (
                            <div className="mt-3">
                              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                                Label Position
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {LABEL_POSITION_OPTIONS.map((opt) => {
                                  const active = ((v.labelPosition as string) ?? "") === opt.value;
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() =>
                                        form.setValue("labelPosition", active ? "" : opt.value, { shouldDirty: true })
                                      }
                                      className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                                        active
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "bg-muted/30 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground"
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* Quantity field(s) matching the selected Packaging Type,
                              shown right under the Packaging Type / Label Position
                              selectors. Hidden values stay in storage so toggling
                              back doesn't lose numbers. */}
                          {f.name === "cartoned" && (() => {
                            const typeVal = cur.trim().toLowerCase();
                            const posVal = ((v.labelPosition as string) ?? "").trim().toLowerCase();
                            if (isCartonedValue(typeVal)) {
                              return (
                                <div className="mt-3">
                                  <NumField
                                    control={form.control}
                                    name="cartonsPerCase"
                                    label="Cartons Per Case"
                                    step="1"
                                  />
                                </div>
                              );
                            }
                            if (typeVal === "labeled" && (posVal === "top" || posVal === "bottom")) {
                              return (
                                <div className="mt-3">
                                  <NumField
                                    control={form.control}
                                    name="labelsPerRoll"
                                    label="Labels Per Roll"
                                    step="1"
                                  />
                                </div>
                              );
                            }
                            if (typeVal === "labeled" && posVal === "both") {
                              return (
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                  <NumField
                                    control={form.control}
                                    name="topLabelsPerRoll"
                                    label="Top Labels Per Roll"
                                    step="1"
                                  />
                                  <NumField
                                    control={form.control}
                                    name="bottomLabelsPerRoll"
                                    label="Bottom Labels Per Roll"
                                    step="1"
                                  />
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </details>
    </>
  );
});
