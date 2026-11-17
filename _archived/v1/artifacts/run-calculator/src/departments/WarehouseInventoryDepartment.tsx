import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";
import { TabsContent } from "@/components/ui/tabs";

export interface WarehouseInventoryDepartmentProps {
  warehouse?: ReactNode;
  inventory?: ReactNode;
  mixes?: ReactNode;
  children?: ReactNode;
}

export function WarehouseInventoryDepartment({
  warehouse,
  inventory,
  mixes,
  children,
}: WarehouseInventoryDepartmentProps) {
  return (
    <DepartmentBoundary name="warehouse-inventory">
      {children}
      {warehouse && <TabsContent value="warehouse">{warehouse}</TabsContent>}
      {inventory && <TabsContent value="inventory">{inventory}</TabsContent>}
      {mixes && <TabsContent value="mixes">{mixes}</TabsContent>}
    </DepartmentBoundary>
  );
}
