export const FIELD_CHECK_MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export function isFieldCheckTimestampOutsideClockWindow(
  observedAtMs: number,
  nowMs: number,
): boolean {
  return Math.abs(nowMs - observedAtMs) > FIELD_CHECK_MAX_CLOCK_SKEW_MS;
}
