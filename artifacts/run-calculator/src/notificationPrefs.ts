// Per-user push-notification preferences: which run alerts this user wants.
// The server stores a map of alert kind → boolean on the account
// (users.notificationPrefs, surfaced on /me) so the choices follow the user
// across devices — a MISSING key means the alert is ON (default), so newly
// added alert kinds are automatically enabled for everyone.
//
// The kind ids here must stay in lockstep with the server's allow-list
// (api-server lib/roles NOTIFICATION_PREF_KEYS) — unknown keys are dropped
// server-side.

export type NotificationKind =
  | "fifteenMin"
  | "batchDue"
  | "warehouseStaging"
  | "runComplete"
  | "freezerEmpty";

export type NotificationPrefs = Record<string, boolean>;

// Display metadata for the settings panel, in the order they appear.
export const NOTIFICATION_KINDS: Array<{
  kind: NotificationKind;
  label: string;
  description: string;
}> = [
  {
    kind: "batchDue",
    label: "Dough batch due",
    description: "When it's time to start the next dough batch (banner + push).",
  },
  {
    kind: "fifteenMin",
    label: "15 minutes left",
    description: "Heads-up shortly before the run's press time is up.",
  },
  {
    kind: "runComplete",
    label: "Run time complete",
    description: "When the run's countdown hits zero and it's time to end the run.",
  },
  {
    kind: "warehouseStaging",
    label: "Warehouse staging",
    description: "Stage frontline (2 skids left) and packaging (1 skid left) for the next run.",
  },
  {
    kind: "freezerEmpty",
    label: "Freezer empty",
    description: "When an ended run's freezer has fully drained.",
  },
];

// Missing key = enabled. Only an explicit false turns an alert off.
export function isNotifEnabled(
  prefs: NotificationPrefs | undefined,
  kind: NotificationKind,
): boolean {
  return prefs?.[kind] !== false;
}
