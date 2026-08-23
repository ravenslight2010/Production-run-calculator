import { useEffect } from "react";
import { Users } from "lucide-react";
import RolesManager from "./RolesManager";
import StaffRolesCard from "./StaffRolesCard";
import { recordPerformance } from "../performanceDiagnostics";

let staffFirstVisitRecorded = false;

export default function StaffManagementSurface({
  loadStartedAt,
}: {
  loadStartedAt?: number | null;
}) {
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

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-bold">Staff Roster</h2>
      </div>
      <StaffRolesCard />
      <RolesManager />
    </div>
  );
}