import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";
import { TabsContent } from "@/components/ui/tabs";

export interface ManagementDepartmentProps {
  setup?: ReactNode;
  ai?: ReactNode;
  staff?: ReactNode;
  children?: ReactNode;
}

export function ManagementDepartment({
  setup,
  ai,
  staff,
  children,
}: ManagementDepartmentProps) {
  return (
    <DepartmentBoundary name="management">
      {children}
      {setup && <TabsContent value="setup">{setup}</TabsContent>}
      {ai && <TabsContent value="ai">{ai}</TabsContent>}
      {staff && <TabsContent value="staff">{staff}</TabsContent>}
    </DepartmentBoundary>
  );
}
