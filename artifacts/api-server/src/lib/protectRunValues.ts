// Per-run protective merge for the shared day-state sync row.
//
// Background: the daily_sync row is a single blob shared by every device on a
// scope+date. Historically PUT /sync was blind last-writer-wins: the incoming
// payload replaced the stored blob wholesale. A long-standing client bug could
// emit an all-default ("empty") run value paired with that run's REAL edit
// stamp (the form is transiently all-default during mount / right after a
// programmatic form.reset() while the durable stamp still carries the real edit
// time). With blind LWW that empty value persisted to the shared row and then
// re-infected every device on the next read — the recurring "I entered it,
// refreshed, and it vanished" data loss.
//
// This makes the server a per-run last-writer-wins register merge keyed on the
// per-run edit stamp (runValuesUpdatedAt), instead of replacing the whole map:
//
//   - A genuine edit always advances a run's stamp, so we accept an incoming run
//     value ONLY when its stamp is STRICTLY NEWER than what's stored.
//   - Equal or older stamps keep the stored value+stamp. This is what blocks the
//     empty-value-with-equal-stamp corruption: the empty push cannot overwrite a
//     populated stored value because it does not advance the stamp.
//   - A run present in the store but OMITTED from the incoming payload is
//     preserved additively, so a peer that pushes before it has seen another
//     device's just-added run can't transiently drop that run's value.
//
// Healing: when a client detects an empty-over-populated value on receive it
// re-pushes the good value with a FRESHLY BUMPED stamp (Date.now()), which is
// strictly newer than the corrupted row's real stamp, so this merge accepts it
// and the fix propagates to every peer.
//
// Only runValues / runValuesUpdatedAt are protected here. Every other payload
// field (master-data lists, dayState, overlays) is still adopted from the
// incoming payload and additively reconciled client-side on receive, so this
// change is surgical and does not alter the rest of the sync contract.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Merge `incoming` against the already-stored `existing` payload so a run's
 * stored value only changes when a strictly-newer-stamped edit arrives. Returns
 * a new payload object (the incoming payload with its runValues /
 * runValuesUpdatedAt reconciled). Non-object payloads are returned unchanged.
 */
export function protectRunValues(incoming: unknown, existing: unknown): unknown {
  if (!isPlainObject(incoming)) return incoming;
  // Nothing stored yet (first write for this scope+date) — accept as-is.
  if (!isPlainObject(existing)) return incoming;

  const inVals = isPlainObject(incoming.runValues) ? incoming.runValues : {};
  const inUpd = isPlainObject(incoming.runValuesUpdatedAt) ? incoming.runValuesUpdatedAt : {};
  const exVals = isPlainObject(existing.runValues) ? existing.runValues : {};
  const exUpd = isPlainObject(existing.runValuesUpdatedAt) ? existing.runValuesUpdatedAt : {};

  // Nothing stored to protect — accept incoming unchanged.
  if (Object.keys(exVals).length === 0) return incoming;

  const outVals: Record<string, unknown> = { ...inVals };
  const outUpd: Record<string, unknown> = { ...inUpd };

  for (const id of Object.keys(exVals)) {
    const exStamp = asNumber(exUpd[id]);
    const inStamp = asNumber(inUpd[id]);
    const inHas = Object.prototype.hasOwnProperty.call(inVals, id);
    // Accept the incoming value ONLY when it's present AND its stamp is strictly
    // newer than the stored stamp (a genuine, more-recent edit). Otherwise keep
    // what's stored: this preserves runs the push omitted (additive) and rejects
    // equal/older-stamped pushes — including the empty-value-with-equal-stamp
    // corruption.
    if (inHas && inStamp > exStamp) continue;
    outVals[id] = exVals[id];
    outUpd[id] = exStamp;
  }

  return { ...incoming, runValues: outVals, runValuesUpdatedAt: outUpd };
}
