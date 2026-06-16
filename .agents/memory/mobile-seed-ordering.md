---
name: Mobile one-time seed ordering
description: Why all marker-guarded AsyncStorage seeds in the mobile RunContext must run in ONE ordered effect, not separate effects.
---

# Mobile seed ordering

When adding a new one-time, marker-guarded seed to the mobile app's `RunContext`
(e.g. spec-profile seed, dough seed), do NOT add it as its own `useEffect` that
independently does `AsyncStorage.getItem(marker)` then `setAppState`.

**Rule:** all such seeds must run inside a SINGLE ordered async flow (read all
markers, then apply the seeds in a fixed order within one `setAppState`).

**Why:** each seed's getItem→setAppState is async, so two separate effects
complete in nondeterministic order. Several seeds write `brandProfiles[key]`.
The spec seed only fills a profile key when ABSENT (`if (!brandProfiles[k])`),
which intentionally protects user edits. If a later seed (dough) wins the race
and creates a dough-only profile key first, the spec seed then skips that key
forever, permanently losing its sauce/cheese/pep fields. This also breaks
web/mobile parity because web runs its seeds synchronously in fixed order at
module load (`home.tsx`), so only mobile is affected.

**How to apply:** keep the spec seed before the dough seed (and any future seed
after both) in the same `setAppState` callback; set each marker independently so
returning users who already ran an earlier seed still get newer ones. Do NOT
change the spec seed's skip-if-exists guard to a merge — that guard protects
user-edited spec profiles; fix ordering instead.
