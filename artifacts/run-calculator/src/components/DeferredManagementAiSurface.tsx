import type { ComponentProps } from "react";
import AssistantTab from "./AssistantTab";
import SpecReconcilePanel from "./SpecReconcilePanel";
import ImportHistoryPanel from "./ImportHistoryPanel";

type AssistantProps = ComponentProps<typeof AssistantTab>;
type SpecReconcileProps = ComponentProps<typeof SpecReconcilePanel>;
type ImportHistoryProps = ComponentProps<typeof ImportHistoryPanel>;

export interface DeferredManagementAiSurfaceProps {
  assistant: AssistantProps;
  specReconcile: SpecReconcileProps;
  importHistory?: ImportHistoryProps;
}

/**
 * AI assistance and import review are deliberately kept together because they
 * share the manager-only review workflow and are not needed by floor staff.
 * Home still owns every callback and data source; this component only provides
 * the on-demand rendering boundary.
 */
export default function DeferredManagementAiSurface({
  assistant,
  specReconcile,
  importHistory,
}: DeferredManagementAiSurfaceProps) {
  return (
    <>
      <AssistantTab {...assistant} />
      <div className="mt-3">
        <SpecReconcilePanel {...specReconcile} />
      </div>
      {importHistory && (
        <div className="mt-3">
          <ImportHistoryPanel {...importHistory} />
        </div>
      )}
    </>
  );
}