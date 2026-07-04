---
name: Standalone Setup Profiles editor
description: Manager/supervisor editor for a brand/flavor's saved setup, independent of any run; how it's wired and why it must never touch run state.
---

Both apps have a standalone "Setup Profiles" screen (web: `SetupProfileEditor.tsx` dialog off the Manage Lists menu; mobile: `app/setup-profiles.tsx`, pushed via Expo Router with `?brand=&flavor=` params) that lets a manager/supervisor pick any brand/flavor and edit its saved setup directly through the existing `saveProfile`/`loadProfile` (`saveProfileFor`/`loadProfileFor` on mobile) round-trip.

**Why:** Before this, the only way to fix a brand/flavor's saved recipe/settings was to jump through a live run (reuse-blank-run or create-new-run), which risked corrupting an already-configured/running/finished run via `decideSetupJump`. A standalone editor needs no run-identity juggling at all — it reads/writes `brandProfiles` directly and never calls `updateSettings`/`addRun`/`applyProfile` on the current run.

**How to apply:**
- The "Recipe Setup Needed" warning card's `onSetup(brand, flavor)` callback (web: Scheduled Days; mobile: Warehouse) routes straight into this editor now, not into the run-jump flow. If you see `decideSetupJump`/`MAX_RUNS`/`hasProfile`/`applyProfile`/`addRun` reappear near that callback, that's a regression back to the old (riskier) pattern.
- The editor keeps its own local form state seeded from `loadProfile(For)`; only "Save" persists via `saveProfile(For)`. It intentionally has no allergen-sequence or production-rule violation UI (no "today's lineup" context for a single offline profile) — that's in scope only for the per-run Setup/Configure tab.
- Any field added to `RunSettings`/the run Setup tab should also be added here for parity, mirroring `configure.tsx`'s field blocks (mobile) / the per-run Setup tab's field components (web).
