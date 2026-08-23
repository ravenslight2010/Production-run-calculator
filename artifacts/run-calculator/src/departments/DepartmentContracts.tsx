import { createContext, useContext, type ReactNode } from "react";
import type { DayState, FormValues, RunMeta } from "../types";
import type { HomeTab } from "../hooks/useHomeNavigation";

export type DepartmentRefreshScope = "day" | "master-data" | "inventory";

export interface DepartmentIdentity {
  userId?: string;
  role?: string;
  isManager: boolean;
}

export interface DepartmentPermissions {
  canManageProfiles: boolean;
  canManageInventory: boolean;
  canManageStaff: boolean;
}

export interface DepartmentLiveSignals {
  runStatus: "pending" | "running" | "paused" | "ended";
  isOnline: boolean;
}

export interface DepartmentMasterData {
  brands: readonly string[];
  doughRecipeNames: readonly string[];
  frontlineRecipeNames: readonly string[];
  mixRecipeNames: readonly string[];
}

export interface DepartmentNotificationState {
  pendingResetCount: number;
  unreviewedIncidentCount: number;
}

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
  identity: DepartmentIdentity;
  permissions: DepartmentPermissions;
  live: DepartmentLiveSignals;
  masterData: DepartmentMasterData;
  notifications: DepartmentNotificationState;
  requestRefresh: (scope: DepartmentRefreshScope) => void;
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
