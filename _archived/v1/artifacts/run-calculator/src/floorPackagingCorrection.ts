export function incrementFloorCaseCount(
  currentCases: number,
  casesPerSkid: number,
): number {
  const current = Math.max(0, Number(currentCases) || 0);
  const capacity = Math.max(0, Number(casesPerSkid) || 0);
  return capacity > 0 ? Math.min(capacity, current + 1) : current + 1;
}