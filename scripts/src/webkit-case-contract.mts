// Reviewed identities from playwright.webkit.config.ts, the authoritative
// bounded WebKit lane used to retain release evidence.
export const WEBKIT_EXPECTED_CASE_IDENTITIES: readonly string[] = [
  "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts :: authenticates and preserves current-run start, pause, resume, and reload",
  "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts :: manager can preview an authoritative operational report",
  "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts :: recovers a failed sync pull after the browser reconnects",
];

export const WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES: readonly string[] = [
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: phone-webkit › Import Gold cleanup-only manager panel fits, deletes, and refreshes in this browser viewport",
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: phone-webkit › QC Manager can use the scoped retention panel without opening the Gold Lab",
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: phone-webkit › daily retention reminders stay metadata-only and scoped by role",
  "artifacts/run-calculator/e2e/report-issue-confirmation.spec.ts :: phone-webkit › manager reviews a staff issue report and retains the review after reload",
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: tablet-webkit › Import Gold cleanup-only manager panel fits, deletes, and refreshes in this browser viewport",
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: tablet-webkit › QC Manager can use the scoped retention panel without opening the Gold Lab",
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: tablet-webkit › daily retention reminders stay metadata-only and scoped by role",
  "artifacts/run-calculator/e2e/report-issue-confirmation.spec.ts :: tablet-webkit › manager reviews a staff issue report and retains the review after reload",
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: phone-webkit › Import Gold manager panel fits and remains reviewable at this browser viewport",
  "artifacts/run-calculator/e2e/report-issue-confirmation.spec.ts :: phone-webkit › staff can retry a failed issue report without retyping and sees its diagnostic reference",
  "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts :: phone-webkit › authenticates and preserves current-run start, pause, resume, and reload",
  "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts :: phone-webkit › manager can preview an authoritative operational report",
  "artifacts/run-calculator/e2e/import-gold-lab-responsive.spec.ts :: tablet-webkit › Import Gold manager panel fits and remains reviewable at this browser viewport",
  "artifacts/run-calculator/e2e/report-issue-confirmation.spec.ts :: tablet-webkit › staff can retry a failed issue report without retyping and sees its diagnostic reference",
  "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts :: tablet-webkit › authenticates and preserves current-run start, pause, resume, and reload",
  "artifacts/run-calculator/e2e/release-webkit-smoke.spec.ts :: tablet-webkit › manager can preview an authoritative operational report",
];

function assertIdentityContract(
  lane: string,
  expectedIdentities: readonly string[],
  discoveredIdentities: readonly string[],
): void {
  const expected = new Set(expectedIdentities);
  const discovered = new Set(discoveredIdentities);
  const added = [...discovered].filter((identity) => !expected.has(identity));
  const removed = [...expected].filter((identity) => !discovered.has(identity));
  const duplicateCount = discoveredIdentities.length - discovered.size;

  if (added.length === 0 && removed.length === 0 && duplicateCount === 0) {
    return;
  }

  const details = [
    `${lane} case identities differ from the reviewed inventory (${expectedIdentities.length} expected, ${discoveredIdentities.length} discovered).`,
  ];
  if (added.length > 0) {
    details.push("Added identities (review before updating the inventory):");
    details.push(...added.sort().map((identity) => `  + ${identity}`));
  }
  if (removed.length > 0) {
    details.push("Removed identities (review before updating the inventory):");
    details.push(...removed.sort().map((identity) => `  - ${identity}`));
  }
  if (duplicateCount > 0) {
    details.push(`Duplicate discovered identities: ${duplicateCount}`);
  }

  throw new Error(details.join("\n"));
}

export function assertWebKitCaseIdentityContract(
  discoveredIdentities: readonly string[],
): void {
  assertIdentityContract(
    "WebKit release",
    WEBKIT_EXPECTED_CASE_IDENTITIES,
    discoveredIdentities,
  );
}

export function assertWebKitCompatibilityCaseIdentityContract(
  discoveredIdentities: readonly string[],
): void {
  assertIdentityContract(
    "WebKit compatibility",
    WEBKIT_COMPATIBILITY_EXPECTED_CASE_IDENTITIES,
    discoveredIdentities,
  );
}