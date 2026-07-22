import { createContext, useContext } from "react";

// ─── HomeTabCtx: narrow context for live production tab components ────────────
// LivePackagingTabContent, LiveFrontlineTabContent, LiveDoughTabContent,
// LiveSetupRecipesTabContent, and LiveSummaryTabContent subscribe here instead
// of the full HomeCtx. This context memoizes on only non-dialog, non-manage,
// non-import deps, so those tabs do NOT re-render when a manage dialog opens,
// merge state changes, or import progress ticks — only when actual production
// data changes (dayState, form values, ingredients, etc.).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HomeTabCtx = createContext<any>(null);

export function useHomeTabCtx(): any {
  const ctx = useContext(HomeTabCtx);
  if (!ctx) throw new Error("useHomeTabCtx must be used within HomeTabCtx.Provider");
  return ctx;
}
