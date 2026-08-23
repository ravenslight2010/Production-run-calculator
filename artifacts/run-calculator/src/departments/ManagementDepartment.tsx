import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";

export function ManagementDepartment({ children }: { children: ReactNode }) {
  return <DepartmentBoundary name="management">{children}</DepartmentBoundary>;
}
