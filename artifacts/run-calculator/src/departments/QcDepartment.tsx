import type { ReactNode } from "react";
import { DepartmentBoundary } from "./DepartmentBoundary";
import { lazy, Suspense } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import type { DayIn } from "@workspace/downtime-trends";
import type { QcWorkflowTabProps } from "../components/QcWorkflowTab";

const LazyIncidentsTab = lazy(() => import("../components/IncidentsTab"));
const LazyDowntimeTrendsTab = lazy(() => import("../components/DowntimeTrendsTab"));
const LazyQcWorkflowTab = lazy(() => import("../components/QcWorkflowTab"));

function QcTabFallback() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground" role="status">
      Loading quality tools…
    </div>
  );
}

function DeferredQcSurface({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<QcTabFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function QcDepartment({ children }: { children: ReactNode }) {
  return <DepartmentBoundary name="qc">{children}</DepartmentBoundary>;
}

export function QcIncidentsSurface() {
  return (
    <QcDepartment>
      <DeferredQcSurface>
        <LazyIncidentsTab />
      </DeferredQcSurface>
    </QcDepartment>
  );
}

export function QcDowntimeSurface({ days }: { days: DayIn[] }) {
  return (
    <QcDepartment>
      <DeferredQcSurface>
        <LazyDowntimeTrendsTab days={days} />
      </DeferredQcSurface>
    </QcDepartment>
  );
}

export function QcQualitySurface(props: QcWorkflowTabProps) {
  return (
    <QcDepartment>
      <DeferredQcSurface>
        <LazyQcWorkflowTab {...props} />
      </DeferredQcSurface>
    </QcDepartment>
  );
}
