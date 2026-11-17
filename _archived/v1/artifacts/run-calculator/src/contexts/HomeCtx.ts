import { createContext, useContext } from "react";

// ─── HomeCtx: stable data shared to extracted sub-components ─────────────────
//
// This module is intentionally tiny so that the real useHomeCtx() hook and the
// HomeCtx context object can be imported directly in integration tests without
// pulling in the full 20 000-line home.tsx render tree.
//
// home.tsx provides the value via <HomeCtx.Provider value={homeCtxValue}>.
// All eight memo()-wrapped tab components (LiveRunTabContent, LiveDoughTabContent,
// LiveFrontlineTabContent, LivePackagingTabContent, LiveSetupRecipesTabContent,
// LiveStoppagesTabContent, LiveSummaryTabContent, GlanceOverlay) call
// useHomeCtx() to read the full context bag.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HomeCtx = createContext<any>(null);

export function useHomeCtx(): any {
  const ctx = useContext(HomeCtx);
  if (!ctx) throw new Error("useHomeCtx must be used within HomeCtx.Provider");
  return ctx;
}
