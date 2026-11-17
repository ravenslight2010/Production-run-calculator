import type { ReactNode } from "react";
import { Tabs } from "./ui/tabs";
import type { HomeTab } from "../hooks/useHomeNavigation";
import { useHomeTabCtx } from "../contexts/HomeTabCtx";
import { StockDraftProvider } from "../contexts/StockDraftContext";

interface HomeStationTabsProps {
  activeTab: HomeTab;
  onTabChange: (tab: string) => void;
  children: ReactNode;
}

/**
 * Stable composition boundary for Home's station panels.
 *
 * This component owns the tab-container contract and local stock drafts. Panel implementations
 * remain free to use HomeCtx/HomeTabCtx/LiveRunContext and are not coupled to
 * navigation persistence or sync effects.
 */
export function HomeStationTabs({
  activeTab,
  onTabChange,
  children,
}: HomeStationTabsProps) {
  const { currentRunId } = useHomeTabCtx();
  return (
    <StockDraftProvider runId={currentRunId}>
      <Tabs value={activeTab} onValueChange={onTabChange} className="station-tabs w-full min-w-0 print:hidden">
        {children}
      </Tabs>
    </StockDraftProvider>
  );
}