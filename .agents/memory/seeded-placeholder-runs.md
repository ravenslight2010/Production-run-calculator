---
name: Seeded placeholder runs are local-only
description: How the auto-created blank placeholder run is kept out of /api/sync so fresh devices don't pile blank "Unnamed Run"s onto every peer.
---

# Seeded placeholder runs stay local-only

**The rule:** every AUTO-created day placeholder run (web `freshDayState`, mobile
`INITIAL_STATE` / `buildNextDayState` / `rolloverDay`) carries `seeded: true`.
While it is still *pristine* (blank brand/flavor/notes, never started, no
stoppages, all-default values) it must be:
- **excluded from every sync push** (web `buildSyncPayload`, mobile
  `appStateToPayload`), with the `seeded` flag stripped/never mapped so it does
  not travel over the wire;
- **dropped on receive** once the incoming remote day has ≥1 run (both apps'
  run-union), so the adopting device doesn't keep a stray blank run.

**Why:** every fresh device/browser starts with one blank placeholder. The
server's additive run-list union (run-list-loss-protection) keeps everything it
sees, so pushing the placeholder pinned one blank "Unnamed Run" per new device
into EVERY peer's day list, forever.

**How to apply:**
- Never set `seeded` on user actions: New Run, reset run, imports, schedule
  pull-ups — a deliberately created blank run must still sync.
- Pristine-ness is checked by `isPristineSeedRun` (web `storage.ts` takes the
  run + the value that WOULD be pushed — live form for the current run; mobile
  `sync/mapping.ts` derives from run state). Any user input makes it false and
  the run syncs normally.
- **Clients must never hold 0 runs.** Because a resetting peer's own
  placeholder is local-only, a daily reset now arrives with an EMPTY run list;
  both receive paths re-seed a fresh `seeded` placeholder when the merged list
  would be empty (also covers a fully tombstoned remote list).
- Web receive guards the current run against a mid-typing drop
  (lastLocalEditRef window + live-form-not-default check); mobile relies on its
  existing EDIT_QUIET_MS apply deferral.
- Tests live in the web artifact's sync run-merge test (mobile mapping via the
  strip-imports harness); web's push/receive logic is inline in home.tsx.
- **Pre-fix pinned blanks:** blanks pushed BEFORE this fix have no `seeded`
  flag (it never travels over the wire) and stay pinned by the additive union.
  Cleanup = the "remove blank runs" sweep (web run-actions eraser button,
  supervisor-gated; mobile Switch Run sheet footer), which detects blanks by
  CONTENT via `isBlankRemovableRun` (pristine check minus the seeded
  requirement), always excludes the CURRENT run (may be about to be filled;
  also guarantees ≥1 run), and tombstones each id in `deletedItems.runs` so
  the removal propagates to peers and can't be resurrected.
