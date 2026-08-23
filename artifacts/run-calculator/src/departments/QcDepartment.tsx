import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";

export function QcDepartment({ children }: { children: ReactNode }) {
  return <DepartmentBoundary name="qc">{children}</DepartmentBoundary>;
}
