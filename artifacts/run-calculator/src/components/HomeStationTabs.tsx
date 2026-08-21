import type { ReactNode } from "react";
import { Tabs } from "./ui/tabs";
import type { HomeTab } from "../hooks/useHomeNavigation";

interface HomeStationTabsProps {
  activeTab: HomeTab;
  onTabChange: (tab: string) => void;
  children: ReactNode;
}

/**
 * Stable composition boundary for Home's station panels.
 *
 * This component owns only the tab-container contract. Panel implementations
 * remain free to use HomeCtx/HomeTabCtx/LiveRunContext and are not coupled to
 * navigation persistence or sync effects.
 */
export function HomeStationTabs({
  activeTab,
  onTabChange,
  children,
}: HomeStationTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full print:hidden">
      {children}
    </Tabs>
  );
}