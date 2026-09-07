import { memo } from "react";
import { ClipboardList } from "lucide-react";
import InventoryTab from "./InventoryTab";
import { useInventoryTabCtx } from "../contexts/InventoryTabCtx";

// Memo'd wrapper that feeds InventoryTab from the narrow InventoryTabCtx
// instead of the full HomeCtx. Home computes the (tab-gated) candidate /
// coverage / substitution values; this component only re-renders when those
// production values or the day's substitutions actually change — not when a
// manage dialog opens, merge state changes, or import progress ticks.
export default memo(function InventoryTabContent() {
  const {
    candidates,
    runValsList,
    coverageRunVals,
    substitutions,
    substitutionLog,
    substitutionOptions,
    onAddSubstitution,
    onRemoveSubstitution,
    onClearSubstitutions,
  } = useInventoryTabCtx();
  return (
    <>
      <div className="mb-4" data-testid="inventory-page-heading">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <ClipboardList className="h-5 w-5 text-primary" />
          Inventory
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review stock, lots, alerts, transfers, and substitutions.
        </p>
      </div>
      <InventoryTab
        candidates={candidates}
        runValsList={runValsList}
        coverageRunVals={coverageRunVals}
        substitutions={substitutions}
        substitutionLog={substitutionLog}
        substitutionOptions={substitutionOptions}
        onAddSubstitution={onAddSubstitution}
        onRemoveSubstitution={onRemoveSubstitution}
        onClearSubstitutions={onClearSubstitutions}
      />
    </>
  );
});
