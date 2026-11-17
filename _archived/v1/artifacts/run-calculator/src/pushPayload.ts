export interface PushAlertPayload {
  alertId: string;
  url?: string;
}

/** Accept only a stable, bounded ID and an app-relative navigation target. */
export function parsePushAlertPayload(value: unknown): PushAlertPayload | null {
  if (!value || typeof value !== "object") return null;
  // `id` is accepted during the server rollout; normalize at the boundary so
  // all browser receipt/dedupe code uses the stable `alertId` name.
  const { alertId: explicitAlertId, id, url } = value as { alertId?: unknown; id?: unknown; url?: unknown };
  const alertId = explicitAlertId ?? id;
  if (typeof alertId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(alertId)) return null;
  if (url !== undefined && (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//"))) return null;
  return { alertId, ...(typeof url === "string" ? { url } : {}) };
}