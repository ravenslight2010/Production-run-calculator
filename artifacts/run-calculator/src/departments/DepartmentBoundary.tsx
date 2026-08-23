import type { ReactNode } from "react";
import type { HomeTab } from "../hooks/useHomeNavigation";
import { useDepartmentContext } from "./DepartmentContracts";

export type DepartmentName = "production-line" | "warehouse-inventory" | "qc" | "management";

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
  return (
    <section data-department={name} data-department-active={activeTab}>
      {children}
    </section>
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
