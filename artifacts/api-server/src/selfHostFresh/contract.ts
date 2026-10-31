// Compiled into the fresh profile; never selected by an ambient runtime flag.
export const FRESH_BUILD_PROFILE = "self-host-fresh" as const;
export const FRESH_AUDIT_REASON =
  "legacy-production-audit-not-packaged" as const;
export type FreshSourceReconciliationStatus = {
  status: "not-applicable";
  buildProfile: typeof FRESH_BUILD_PROFILE;
  reason: typeof FRESH_AUDIT_REASON;
  findings: [];
};
export function freshSourceReconciliationStatus(): FreshSourceReconciliationStatus {
  return {
    status: "not-applicable",
    buildProfile: FRESH_BUILD_PROFILE,
    reason: FRESH_AUDIT_REASON,
    findings: [],
  };
}
export function legacyRepairUnavailable(): never {
  throw new Error(
    "Legacy production repair authority is unavailable in the fresh self-host profile.",
  );
}
