import { useEffect, useLayoutEffect, useState } from "react";
import { Users } from "lucide-react";
import RolesManager from "./RolesManager";
import StaffRolesCard from "./StaffRolesCard";
import { recordPerformance } from "../performanceDiagnostics";

let staffFirstVisitRecorded = false;
let staffSurfaceCommitRecorded = false;

export default function StaffManagementSurface({
  loadStartedAt,
}: {
  loadStartedAt?: number | null;
}) {
  const [showStaffRoles, setShowStaffRoles] = useState(false);
  const [showRolesManager, setShowRolesManager] = useState(false);

  useEffect(() => {
    if (staffFirstVisitRecorded) return;
    staffFirstVisitRecorded = true;
    const durationMs =
      loadStartedAt !== null &&
      loadStartedAt !== undefined &&
      typeof performance !== "undefined"
        ? performance.now() - loadStartedAt
        : 0;
    recordPerformance("management:staff-first-visit", durationMs, "navigation");
  }, [loadStartedAt]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowStaffRoles(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showStaffRoles) return;
    const timer = window.setTimeout(() => setShowRolesManager(true), 0);
    return () => window.clearTimeout(timer);
  }, [showStaffRoles]);

  useLayoutEffect(() => {
    if (staffSurfaceCommitRecorded) return;
    staffSurfaceCommitRecorded = true;
    if (
      loadStartedAt === null ||
      loadStartedAt === undefined ||
      typeof performance === "undefined"
    ) {
      return;
    }
    recordPerformance(
      "management:staff-surface-commit",
      performance.now() - loadStartedAt,
      "render",
    );
  }, [loadStartedAt]);

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-bold">Staff Roster</h2>
      </div>
      {showStaffRoles ? (
        <StaffRolesCard />
      ) : (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground" role="status">
          Loading staff roster…
        </div>
      )}
      {showRolesManager ? (
        <RolesManager />
      ) : (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground" role="status">
          Loading roles…
        </div>
      )}
    </div>
  );
}