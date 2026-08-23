import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";

export function ProductionLineDepartment({ children }: { children: ReactNode }) {
  return <DepartmentBoundary name="production-line">{children}</DepartmentBoundary>;
}
