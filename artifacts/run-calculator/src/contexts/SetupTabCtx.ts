import { createContext, useContext } from "react";

// ─── SetupTabCtx: narrow context for the Setup tab panel ─────────────────────
// SetupContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx/WarehouseTabCtx/InventoryTabCtx/MixesTabCtx, this context
// memoizes on only non-dialog, non-manage, non-import deps, so the Setup
// panel does NOT re-render when a manage dialog opens, merge state changes,
// or import progress ticks — only when setup-relevant data actually changes
// (form watch values, editable packaging lists, role/current-run fields).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SetupTabCtx = createContext<any>(null);

export function useSetupTabCtx(): any {
  const ctx = useContext(SetupTabCtx);
  if (!ctx) throw new Error("useSetupTabCtx must be used within SetupTabCtx.Provider");
  return ctx;
}
