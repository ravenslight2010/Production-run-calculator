/**
 * Versioned, replay-safe offline operator commands.  These are deliberately
 * stored with the daily document: deployments which predate this feature need
 * no migration and the row lock used by sync is also the serialization point.
 */
export const OPERATIONAL_INTENT_VERSION = 1 as const;
const MAX_HISTORY = 200;
const ID = /^[A-Za-z0-9:_-]{1,160}$/;
const correctionFields = new Set([
  "skidsCompleted", "casesOnCurrentSkid", "traysOnLine", "batchesReady",
  "sauceBarrelsMade", "sauceBarrelAnchorNetSec", "sauceBarrelCorrectionGeneration",
  "app1BatchesMade", "app1BatchAnchorNetSec", "app1BatchCorrectionGeneration",
  "app2BatchesMade", "app2BatchAnchorNetSec", "app2BatchCorrectionGeneration",
  "app3BatchesMade", "app3BatchAnchorNetSec", "app3BatchCorrectionGeneration",
  "app4BatchesMade", "app4BatchAnchorNetSec", "app4BatchCorrectionGeneration",
]);

export type OperationalIntent = {
  version: 1; id: string; date: string; runId: string; observedGeneration: string;
  resetEpoch: number; effectiveAt: number;
  action: "pause" | "resume" | "lifecycle" | "correction";
  lifecycle?: "start" | "end";
  values?: Record<string, number>;
  inventoryLines?: Array<{ itemKey: string; qty: number }>;
};
export type OperationalIntentOutcome = "accepted" | "rebased" | "review-required";

export function parseOperationalIntent(input: unknown, now = Date.now()): OperationalIntent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const x = input as Record<string, unknown>;
  if (x.version !== 1 || typeof x.id !== "string" || !ID.test(x.id)
    || typeof x.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(x.date)
    || typeof x.runId !== "string" || !ID.test(x.runId)
    || typeof x.observedGeneration !== "string" || !ID.test(x.observedGeneration)
    || !Number.isSafeInteger(x.resetEpoch) || (x.resetEpoch as number) < 0
    || typeof x.effectiveAt !== "number" || !Number.isFinite(x.effectiveAt)
    || Math.abs(now - (x.effectiveAt as number)) > 36 * 60 * 60_000
    || !["pause", "resume", "lifecycle", "correction"].includes(String(x.action))) return null;
  if (x.action === "lifecycle" && x.lifecycle !== "start" && x.lifecycle !== "end") return null;
  if (x.action === "lifecycle" && x.lifecycle === "end") {
    if (!Array.isArray(x.inventoryLines) || x.inventoryLines.length > 200) return null;
    let previousKey = "";
    for (const line of x.inventoryLines) {
      if (!line || typeof line !== "object" || Array.isArray(line)) return null;
      const itemKey = (line as Record<string, unknown>).itemKey;
      const qty = (line as Record<string, unknown>).qty;
      if (typeof itemKey !== "string" || itemKey.length < 1 || itemKey.length > 300
        || typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) return null;
      // Canonical lines are unique and lexically ordered, making the durable
      // command byte-stable regardless of recipe row ordering.
      if (itemKey <= previousKey) return null;
      previousKey = itemKey;
    }
  } else if (x.inventoryLines !== undefined) return null;
  if (x.action === "correction") {
    if (!x.values || typeof x.values !== "object" || Array.isArray(x.values) || !Object.keys(x.values as object).length) return null;
    for (const [key, value] of Object.entries(x.values as Record<string, unknown>)) {
      if (!correctionFields.has(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
    }
  }
  return x as OperationalIntent;
}

function obj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {};
}
function generation(run: Record<string, any>): string {
  return `${run.id}:${String(run.metaUpdatedAt ?? run.startedAt ?? 0)}`.slice(0, 160);
}

/** Must be called while the daily_sync row is locked. */
export function applyOperationalIntent(stored: unknown, intent: OperationalIntent, now = Date.now()): {
  data: Record<string, any>; outcome: OperationalIntentOutcome; duplicate: boolean;
} {
  const data = obj(stored);
  const history = obj(data.operationalIntentHistory);
  const prior = Array.isArray(history.outcomes) ? history.outcomes : [];
  const old = prior.find((entry: any) => entry?.id === intent.id);
  if (old) return { data, outcome: old.outcome as OperationalIntentOutcome, duplicate: true };
  // Never mutate the decoded JSON object supplied by the caller. Besides making
  // this reducer testable, this prevents a rejected transaction from leaking a
  // tentative lifecycle change into a later retry.
  const runList = Array.isArray(data.dayState?.runs) ? [...data.dayState.runs] : [];
  const index = runList.findIndex((r: any) => r?.id === intent.runId);
  let outcome: OperationalIntentOutcome = "review-required";
  if (index >= 0) {
    const run = { ...runList[index] };
    const exactGeneration = generation(run) === intent.observedGeneration;
    const coordinationRuns = obj(obj(data.autoTrackCoordination).runs);
    const claimDuringOfflinePause = Object.values(obj(coordinationRuns[intent.runId]))
      .some((state: any) => Number(state?.updatedAt) > Number(run.pausedAt) && Number(state?.updatedAt) <= intent.effectiveAt);
    // A resume normally observes the pre-pause generation (the paired pause
    // advanced it). It is safe to rebase only when no canonical automatic
    // transition happened in the claimed paused interval; otherwise changing
    // timing would require recomputing counters and is manager review.
    const safeResumeRebase = intent.action === "resume" && !!run.pausedAt
      && intent.effectiveAt >= Number(run.pausedAt) && !claimDuringOfflinePause;
    // Commands that are already true are safe replays after a snapshot upload;
    // anything else against another lifecycle generation needs a manager.
    const alreadyApplied = (intent.action === "pause" && !!run.pausedAt)
      || (intent.action === "resume" && !run.pausedAt && !!run.startedAt)
      || (intent.action === "lifecycle" && intent.lifecycle === "start" && !!run.startedAt);
    if (exactGeneration || alreadyApplied || safeResumeRebase) {
      outcome = exactGeneration ? "accepted" : "rebased";
      if (!alreadyApplied && intent.action !== "correction") {
        if (intent.action === "pause" && run.startedAt && !run.endedAt) {
          run.pausedAt = intent.effectiveAt;
          run.stoppages = [...(Array.isArray(run.stoppages) ? run.stoppages : []), { id: `offline:${intent.id}`, type: "pause", reason: "Offline pause", startedAt: intent.effectiveAt }];
        } else if (intent.action === "resume" && run.pausedAt && !run.endedAt && intent.effectiveAt >= run.pausedAt) {
          const pauseId = run.pausedStoppageId ?? (Array.isArray(run.stoppages)
            ? run.stoppages.filter((s: any) => s?.type === "pause" && !s.endedAt && s.startedAt === run.pausedAt)
              .sort((a: any, b: any) => String(b.id).localeCompare(String(a.id)))[0]?.id : undefined);
          run.startedAt = Number(run.startedAt) + (intent.effectiveAt - Number(run.pausedAt));
          run.stoppages = (Array.isArray(run.stoppages) ? run.stoppages : []).map((s: any) =>
            s?.id === pauseId ? { ...s, endedAt: intent.effectiveAt } : s);
          delete run.pausedAt;
          delete run.pausedStoppageId;
        } else if (intent.action === "lifecycle" && intent.lifecycle === "start" && !run.startedAt) run.startedAt = intent.effectiveAt;
        else if (intent.action === "lifecycle" && intent.lifecycle === "end" && run.startedAt && !run.endedAt) {
          run.endedAt = intent.effectiveAt;
          delete run.pausedAt;
          delete run.pausedStoppageId;
        }
        else outcome = "review-required";
        if (outcome !== "review-required") {
          run.metaUpdatedAt = Math.max(now, Number(run.metaUpdatedAt) || 0);
          runList[index] = run; data.dayState = { ...data.dayState, runs: runList };
        }
      }
      if (outcome !== "review-required" && intent.action === "correction") {
        const values = obj(data.runValues); values[intent.runId] = { ...obj(values[intent.runId]), ...intent.values };
        data.runValues = values; data.runValuesUpdatedAt = { ...obj(data.runValuesUpdatedAt), [intent.runId]: now };
      }
    }
  }
  const record = { id: intent.id, outcome, at: now, effectiveAt: intent.effectiveAt, runId: intent.runId };
  data.operationalIntentHistory = { version: 1, outcomes: [...prior, record].slice(-MAX_HISTORY) };
  return { data, outcome, duplicate: false };
}