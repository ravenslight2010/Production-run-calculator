import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";
import { TabsContent } from "@/components/ui/tabs";

export interface ProductionLineDepartmentProps {
  run?: ReactNode;
  dough?: ReactNode;
  sauce?: ReactNode;
  frontline?: ReactNode;
  packaging?: ReactNode;
  stoppages?: ReactNode;
  summary?: ReactNode;
  children?: ReactNode;
}

/**
 * Owns the production-line tab composition. The slot contents are still
 * created by Home, which owns the form, persistence, and live-run providers;
 * this module owns which operational surfaces belong to the line.
 */
export function ProductionLineDepartment({
  run,
  dough,
  sauce,
  frontline,
  packaging,
  stoppages,
  summary,
  children,
}: ProductionLineDepartmentProps) {
  return (
    <DepartmentBoundary name="production-line">
      {children}
      {run && <TabsContent value="run" className="max-w-[620px] mx-auto">{run}</TabsContent>}
      {dough && <TabsContent value="dough">{dough}</TabsContent>}
      {sauce && <TabsContent value="sauce">{sauce}</TabsContent>}
      {frontline && <TabsContent value="frontline">{frontline}</TabsContent>}
      {packaging && <TabsContent value="packaging">{packaging}</TabsContent>}
      {stoppages && <TabsContent value="stoppages">{stoppages}</TabsContent>}
      {summary && <TabsContent value="summary">{summary}</TabsContent>}
    </DepartmentBoundary>
  );
}
