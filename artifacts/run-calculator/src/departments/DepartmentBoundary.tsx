import type { ReactNode } from "react";
import type { HomeTab } from "../hooks/useHomeNavigation";
import { useDepartmentContext } from "./DepartmentContracts";

export type DepartmentName = "production-line" | "warehouse-inventory" | "qc" | "management";

export const DEPARTMENT_TABS: Record<DepartmentName, readonly HomeTab[]> = {
  "production-line": ["run", "dough", "sauce", "frontline", "packaging", "stoppages", "summary"],
  "warehouse-inventory": ["warehouse", "inventory", "mixes"],
  qc: ["incidents", "downtime", "quality"],
  management: ["ai", "setup", "staff"],
};

/**
 * Stable composition boundary for a department's existing surfaces.
 *
 * This component deliberately has no local data store and does not lazy-load
 * providers. It makes ownership visible while keeping shared live state
 * mounted across tab changes.
 */
export function DepartmentBoundary({
  name,
  children,
}: {
  name: DepartmentName;
  children: ReactNode;
}) {
  const { activeTab } = useDepartmentContext();
  const ownsActiveTab = DEPARTMENT_TABS[name].includes(activeTab);
  return (
    <div
      data-department={name}
      data-department-active={ownsActiveTab ? "true" : "false"}
      aria-label={`${name} department`}
      aria-hidden={ownsActiveTab ? undefined : true}
    >
      {children}
    </div>
  );
}

export function DepartmentNavLink({ tab, children }: { tab: HomeTab; children: ReactNode }) {
  const { navigate } = useDepartmentContext();
  return (
    <button type="button" onClick={() => navigate(tab)}>
      {children}
    </button>
  );
}
