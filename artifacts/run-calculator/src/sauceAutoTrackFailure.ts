export type SauceAutoTrackFailure = {
  barrelId: string;
  dismissed: boolean;
};

export function sauceAutoTrackBarrelId(runId: string, eventId: string): string {
  return `${runId}:${eventId}`;
}

export function noteSauceAutoTrackFailure(
  current: SauceAutoTrackFailure | null,
  barrelId: string,
): SauceAutoTrackFailure {
  return current?.barrelId === barrelId
    ? current
    : { barrelId, dismissed: false };
}

export function resolveSauceAutoTrackFailure(
  current: SauceAutoTrackFailure | null,
  barrelId: string,
): SauceAutoTrackFailure | null {
  return current?.barrelId === barrelId ? null : current;
}

export function dismissSauceAutoTrackFailure(
  current: SauceAutoTrackFailure | null,
): SauceAutoTrackFailure | null {
  return current ? { ...current, dismissed: true } : current;
}