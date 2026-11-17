import type { ComponentProps } from "react";
import OperationsInsights from "./OperationsInsights";
import SpecReconcilePanel from "./SpecReconcilePanel";
import ImportHistoryPanel from "./ImportHistoryPanel";

export interface DeferredManagementSurfaceProps {
  operationsInsights: ComponentProps<typeof OperationsInsights>;
  specReconcile: ComponentProps<typeof SpecReconcilePanel>;
  importHistory?: ComponentProps<typeof ImportHistoryPanel>;
}

/** On-demand manager workspace for deterministic operations and import review. */
export default function DeferredManagementSurface({
  operationsInsights,
  specReconcile,
  importHistory,
}: DeferredManagementSurfaceProps) {
  return <>
    <OperationsInsights {...operationsInsights} />
    <div className="mt-3"><SpecReconcilePanel {...specReconcile} /></div>
    {importHistory && <div className="mt-3"><ImportHistoryPanel {...importHistory} /></div>}
  </>;
}