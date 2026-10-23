export const liveAuthorityContinuationCases = {
  "desktop-scope-end": {
    project: "chromium-desktop",
    desktopScope: true,
    webkitHeldResponse: false,
    offlineManualRecovery: false,
    offlineLifecycle: false,
  },
  "chromium-phone-lifecycle-end": {
    project: "chromium-phone",
    desktopScope: false,
    webkitHeldResponse: false,
    offlineManualRecovery: false,
    offlineLifecycle: true,
  },
  "chromium-tablet-portrait-end": {
    project: "chromium-tablet-portrait",
    desktopScope: false,
    webkitHeldResponse: false,
    offlineManualRecovery: false,
    offlineLifecycle: false,
  },
  "chromium-tablet-landscape-recovery-end": {
    project: "chromium-tablet-landscape",
    desktopScope: false,
    webkitHeldResponse: false,
    offlineManualRecovery: true,
    offlineLifecycle: false,
  },
  "webkit-desktop-recovery-lifecycle-end": {
    project: "webkit-desktop",
    desktopScope: false,
    webkitHeldResponse: false,
    offlineManualRecovery: true,
    offlineLifecycle: true,
  },
  "webkit-phone-lifecycle-end": {
    project: "webkit-phone",
    desktopScope: false,
    webkitHeldResponse: false,
    offlineManualRecovery: false,
    offlineLifecycle: true,
  },
  "webkit-tablet-portrait-full-remaining": {
    project: "webkit-tablet-portrait",
    desktopScope: false,
    webkitHeldResponse: true,
    offlineManualRecovery: true,
    offlineLifecycle: true,
  },
  "webkit-tablet-landscape-full-remaining": {
    project: "webkit-tablet-landscape",
    desktopScope: false,
    webkitHeldResponse: true,
    offlineManualRecovery: true,
    offlineLifecycle: true,
  },
} as const;

export type LiveAuthorityContinuationCase = keyof typeof liveAuthorityContinuationCases;

export function selectLiveAuthorityContinuationCase(value: string | undefined) {
  if (!value || !Object.prototype.hasOwnProperty.call(liveAuthorityContinuationCases, value)) {
    throw new Error(
      `Set LIVE_AUTHORITY_CASE to one of: ${Object.keys(liveAuthorityContinuationCases).join(", ")}.`,
    );
  }
  const name = value as LiveAuthorityContinuationCase;
  return { name, plan: liveAuthorityContinuationCases[name] };
}

export function requireLiveAuthorityEvidenceId(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new Error("Set LIVE_AUTHORITY_EVIDENCE_ID to a unique alphanumeric evidence ID.");
  }
  return value;
}
