import { createContext, useContext, useRef, type ReactNode } from "react";
import type { APPLICATOR_STOCK_REGISTERS } from "@workspace/live-calc";

type StockRegister = (typeof APPLICATOR_STOCK_REGISTERS)[number];
type StockDrafts = Partial<Record<StockRegister, { value: string; label: string }>>;
type RunStockDrafts = { runId: string; drafts: StockDrafts };

const StockDraftContext = createContext<RunStockDrafts | null>(null);

/** In-memory only, bounded to the stock slots of the currently selected run. */
export function StockDraftProvider({ runId, children }: { runId: string; children: ReactNode }) {
  const store = useRef<RunStockDrafts>({ runId, drafts: {} });
  if (store.current.runId !== runId) store.current = { runId, drafts: {} };
  return <StockDraftContext.Provider value={store.current}>{children}</StockDraftContext.Provider>;
}

export function useStockDrafts(runId: string): StockDrafts {
  const shared = useContext(StockDraftContext);
  // Standalone station surfaces retain the same local behavior without a tab owner.
  const local = useRef<RunStockDrafts>({ runId, drafts: {} });
  if (local.current.runId !== runId) local.current = { runId, drafts: {} };
  return shared?.runId === runId ? shared.drafts : local.current.drafts;
}
