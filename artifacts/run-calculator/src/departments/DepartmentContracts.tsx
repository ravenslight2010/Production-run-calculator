import { createContext, useContext, type ReactNode } from "react";
import type { DayState, FormValues, RunMeta } from "../types";
import type { HomeTab } from "../hooks/useHomeNavigation";

/**
 * The intentionally small contract shared by department modules.
 *
 * Home remains the owner of auth, persistence, sync, form state, and live-run
 * coordination. Departments receive navigation and read-only identity/state
 * signals here rather than accepting the entire Home component as props.
 */
export interface DepartmentAppContext {
  activeTab: HomeTab;
  navigate: (tab: HomeTab) => void;
  currentRunId: string;
  currentRun?: RunMeta;
  dayState: DayState;
  formValues: FormValues;
  requestRefresh: (scope: "day" | "master-data" | "inventory") => void;
}

const DepartmentContext = createContext<DepartmentAppContext | null>(null);

export function DepartmentProvider({
  value,
  children,
}: {
  value: DepartmentAppContext;
  children: ReactNode;
}) {
  return <DepartmentContext.Provider value={value}>{children}</DepartmentContext.Provider>;
}

export function useDepartmentContext(): DepartmentAppContext {
  const value = useContext(DepartmentContext);
  if (!value) throw new Error("useDepartmentContext must be used within DepartmentProvider");
  return value;
}
