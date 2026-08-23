import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";
import { useDepartmentContext } from "./DepartmentContracts";
import { TabsContent } from "@/components/ui/tabs";
import ErrorBoundary from "../components/ErrorBoundary";
import { recordPerformance } from "../performanceDiagnostics";

const LazyStaffManagementSurface = lazy(() => {
  const startedAt = typeof performance === "undefined" ? null : performance.now();
  return import("../components/StaffManagementSurface").then((module) => {
    if (startedAt !== null && typeof performance !== "undefined") {
      recordPerformance(
        "management:staff-chunk-load",
        performance.now() - startedAt,
        "load",
      );
    }
    return module;
  });
});

function ManagementTabFallback() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground" role="status">
      Loading management tools…
    </div>
  );
}

export function DeferredStaffManagementSurface() {
  const loadStartedAt = typeof performance === "undefined" ? null : performance.now();
  return (
    <ErrorBoundary>
      <Suspense fallback={<ManagementTabFallback />}>
        <LazyStaffManagementSurface loadStartedAt={loadStartedAt} />
      </Suspense>
    </ErrorBoundary>
  );
}

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
  const { activeTab } = useDepartmentContext();
  return (
    <DepartmentBoundary name="management">
      {children}
      {setup && activeTab === "setup" && <TabsContent value="setup">{setup}</TabsContent>}
      {ai && activeTab === "ai" && (
        <TabsContent value="ai">
          <ErrorBoundary>
            <Suspense fallback={<ManagementTabFallback />}>{ai}</Suspense>
          </ErrorBoundary>
        </TabsContent>
      )}
      {staff && activeTab === "staff" && <TabsContent value="staff"><DeferredStaffManagementSurface /></TabsContent>}
    </DepartmentBoundary>
  );
}
