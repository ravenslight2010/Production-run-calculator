---
name: First-load sync form heal
description: Why the web live form needs a heal effect after the first sync apply on a fresh device, and the guards it must respect.
---

# First-load sync form heal (web)

On a fresh device right after sign-in, the app auto-selects run 0 before synced values arrive. The sync-apply form-reset block decides whether to reset the live form by comparing against the PRE-apply `dayStateRef` — on first adopt the local blank run id isn't in the payload, so the reset is skipped and the form stays all-default (casesNeeded 0) even though localStorage now holds the real synced values. The server sends only ONE initial SSE payload on connect, so no later message heals it.

**Fix pattern:** a `useEffect` on `[currentRunId]` that re-reads `loadRunValues(currentRunId)` and calls `form.reset(mergeRunDefaults(stored))` + `resetFieldArrays` — but ONLY when:
- `isEmptyOverPopulated(form.getValues(), stored)` (never clobber a form with real data), and
- no local edit in the last ~2s (`lastLocalEditRef`), so genuine user typing wins.

**Why:** healing must be one-directional (defaults → stored real data). Anything looser re-introduces the empty-over-populated clobber class of bugs guarded elsewhere (autosave attribution, server protectRunValues).

**How to apply:** any new path that swaps `currentRunId` or adopts remote day-state on a fresh device should rely on this heal effect rather than duplicating form resets; keep the two guards intact.
