import type { Response } from "express";

// Mark a JSON GET response as never-cacheable.
//
// Several endpoints serve shared, frequently-edited data — settings, staff
// rosters, password-reset requests, learned aliases/corrections, denied-merge
// pairs, inventory, incidents, runs — that one user edits and others read.
// Without explicit cache headers, browsers (and intermediaries) apply heuristic
// freshness and serve a stale copy, so even a periodic refetch or an SSE-nudged
// refetch keeps returning the old data until a full reload. Sending no-store
// guarantees edits propagate to other clients within seconds.
//
// SSE endpoints set their own streaming headers and must NOT use this.
export function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}
