import { memo } from "react";
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
  );
});
