import { createContext, useContext } from "react";

// ─── MixesTabCtx: narrow context for the Mix Plan tab panel ──────────────────
// MixesTabContent subscribes here instead of the full HomeCtx. Like
// HomeTabCtx/WarehouseTabCtx, this context memoizes on only non-dialog,
// non-manage, non-import deps, so the Mix Plan panel does NOT re-render when
// a manage dialog opens, merge state changes, or import progress ticks — only
// when mix-plan data actually changes (mixes, scheduled/live runs, make-day,
// surplus-adjusted effective values, optimistic "already made" updates).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MixesTabCtx = createContext<any>(null);

export function useMixesTabCtx(): any {
  const ctx = useContext(MixesTabCtx);
  if (!ctx) throw new Error("useMixesTabCtx must be used within MixesTabCtx.Provider");
  return ctx;
}
