export const FULL_BROWSER_EXPECTED_CASES = 164;

export function assertFullBrowserCaseContract(discoveredCases: number): void {
  if (discoveredCases === FULL_BROWSER_EXPECTED_CASES) return;

  throw new Error(
    `Full browser release lane discovered ${discoveredCases} cases; expected exactly ${FULL_BROWSER_EXPECTED_CASES}. Update the full-browser case contract or release filter before running evidence.`,
  );
}