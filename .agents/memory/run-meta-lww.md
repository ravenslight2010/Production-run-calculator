---
name: Run lifecycle LWW stamp
description: Per-run metaUpdatedAt stamp that stops a started run reverting to unstarted via stale sync merges
---

# Run lifecycle metaUpdatedAt LWW

Run lifecycle metadata (startedAt/pausedAt/endedAt/isRunning/stoppages/actualCases/wasteLbs) carries a per-run `metaUpdatedAt` stamp; at ALL THREE merge points (web receive, mobile receive, server run-list union) the strictly-newer-stamped run copy wins. Tie or absent stamps fall back to the legacy remote/incoming-wins behavior, so legacy payloads are unaffected.

**Why:** Without it, run lifecycle merged remote-wins everywhere — pressing Start then refreshing before the push landed clobbered the run back to "unstarted" from the stale shared row.

**How to apply:**
- Stamping is CENTRALIZED, not per call site: web diff-stamps in `saveDayState` (vs the stored copy; sync-receive saves pass `{stampMeta:false}` so remote-adopted runs keep the peer's stamp — re-stamping them starts echo wars); mobile diff-stamps in `updateCurrentRun` via a lifecycle-fields-changed check. Any NEW mobile mutation path that bypasses `updateCurrentRun` (e.g. updateRunMeta, startRun's direct setState) must stamp itself.
- Web React state doesn't carry fresh stamps — the push payload must overlay them from localStorage (`overlayRunMetaStamps`) or the server never sees the newer stamp.
- Mobile pushes `max(own stamp, last remote stamp)` so non-lifecycle pushes stay TIED with the stored row (tie→incoming lets settings/notes edits through); the receive side overlays ONLY lifecycle fields when local is newer, so remote's newer VALUES still land.
- Settings/progress must NOT bump this stamp — they converge via the separate per-run VALUE stamps; mixing them would let an idle value edit shadow a peer's genuine Start/End.
- Keeping a local run on receive must set the rejectedStale re-push flag (computed OUTSIDE the React updater on web) so the server/peers converge on the newer copy.
