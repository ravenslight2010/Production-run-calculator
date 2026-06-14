---
name: Run-calculator web/mobile UI parity
description: Conventions and non-obvious gotchas when keeping the Expo mobile app's UI matched to the canonical web app.
---

# Run-calculator web ↔ mobile parity

Two apps must stay at feature/UI parity (see replit.md preference): `artifacts/run-calculator` (web, wouter + Radix Tabs, **canonical**) and `artifacts/run-calculator-mobile` (Expo, expo-router tabs). Formulas, RunContext sync, and stored state shape must match exactly across both; only adapt presentation per platform.

## Where run-level fields live (matches web's persistent header)
- **Run identity** — brand, flavor, cases needed (+ Save/Update Profile, profile auto-load) — lives on the **Run screen** (`app/(tabs)/index.tsx`), edited inline. NOT on Setup.
- **Line / case-packing settings** — pizzas per case, cases per skid/layer, die type, speeds, weights, recipes — live on **Setup** (`app/(tabs)/configure.tsx`), behind the supervisor PIN gate.
- **Why:** mirrors web, where run identity is the always-visible header above all tabs and Setup is line config only. Don't reintroduce brand/flavor/cases editing on Setup.

## Gotcha: commit-before-saveProfile ordering
`saveProfile()` (and other context mutators) read brand/flavor from committed `appState` inside a functional `setAppState(prev => …)`, NOT from a screen's local form. Inline fields commit on blur via `updateSettings`. So a "Save Profile" button tapped before blur would otherwise save the STALE key.
- **Fix/pattern:** call `commitId()` (→`updateSettings`, a queued functional `setAppState` updater) **immediately before** `saveProfile()`. React runs queued updaters in order, each receiving the previous result, so `saveProfile`'s `prev` already contains the just-typed values. Rely on this chaining rather than awaiting state.

## Gotcha: per-screen auto-load effects
Profile auto-load (apply saved profile when brand+flavor change) is a `useEffect` keyed on `run.settings.brand/flavor` with a `lastProfileKey` ref guard (and a `run.id`-change reset so switching runs doesn't auto-apply). Keep exactly ONE copy — it now lives on the Run screen (index). `applyProfile` is idempotent, but don't duplicate the effect across mounted tab screens.
