import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";

export function WarehouseInventoryDepartment({ children }: { children: ReactNode }) {
  return <DepartmentBoundary name="warehouse-inventory">{children}</DepartmentBoundary>;
}
