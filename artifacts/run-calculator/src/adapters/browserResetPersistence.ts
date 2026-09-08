/** Browser cache reset adapter; epoch comparison is intentionally side-effect scoped here. */
import { browserRecordStore } from "./browserRecordStore";
const RESET_EPOCH_KEY = "run-calc-reset-epoch";
const COMPLETED_HISTORY_OUTBOX_PREFIX = "run-calc-completed-history-outbox";
const COMPLETED_HISTORY_CACHE_PREFIX = "run-calc-completed-history-cache";
const LOCAL_HISTORY_KEY = "run-calc-history";
// This key starts with the broad legacy "run-calc" namespace, but operational
// intents are independent durable commands and must survive a day reset.
const OPERATIONAL_INTENT_OUTBOX_PREFIX = "run-calculator:operational-intent-outbox:v1";

export function getStoredResetEpoch(): number {
  return browserRecordStore.record(RESET_EPOCH_KEY, () => 0, {
    decode: (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null,
  }).read();
}

export function applyResetWipe(serverEpoch: number): boolean {
  if (!Number.isFinite(serverEpoch) || serverEpoch <= getStoredResetEpoch()) return false;
  try {
    const keys = browserRecordStore.keys("run-calc").filter((key) =>
        key !== RESET_EPOCH_KEY
        && key !== LOCAL_HISTORY_KEY
        && !key.startsWith(COMPLETED_HISTORY_OUTBOX_PREFIX)
        && !key.startsWith(COMPLETED_HISTORY_CACHE_PREFIX)
        && !key.startsWith(OPERATIONAL_INTENT_OUTBOX_PREFIX)
    );
    for (const key of keys) localStorage.removeItem(key);
    browserRecordStore.record(RESET_EPOCH_KEY, () => 0, {
      decode: (value) => typeof value === "number" ? value : null,
    }).write(serverEpoch);
    return true;
  } catch {
    return false;
  }
}

/**
 * Adopt a server daily-rollover epoch without performing the administrative
 * reset's broad cache purge. Reloading after this write reconstructs today's
 * day state and hydrates the canonical server row while preserving profiles,
 * master data, completed history, and durable outboxes.
 */
export function applyRolloverEpoch(serverEpoch: number): boolean {
  if (!Number.isFinite(serverEpoch) || serverEpoch <= getStoredResetEpoch()) return false;
  try {
    browserRecordStore.record(RESET_EPOCH_KEY, () => 0, {
      decode: (value) => typeof value === "number" ? value : null,
    }).write(serverEpoch);
    return true;
  } catch {
    return false;
  }
}