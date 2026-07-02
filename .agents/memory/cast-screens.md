---
name: Cast-to-Screens feature
description: The web "Cast to Screens" station-display feature and why it is web-only (parity exception).
---

# Cast to Screens

The web app (`artifacts/run-calculator/src/pages/home.tsx`) has a "Cast to Screens"
feature: full-screen station display views selected via the `?screen=<mode>` URL param,
handled as early-return blocks (`if (screenMode === "...")`), and listed in a dialog
with QR codes + copy/open links. Modes: dashboard, dough, sauce, frontline, warehouse,
backline, summary.

**Parity exception:** this feature is WEB-ONLY and has NO mobile equivalent.

**Why:** casting works by opening a live-synced URL on a *separate* device/browser
(wall TVs, station tablets). That model does not apply to the Expo native app, so the
replit.md "web/mobile parity" rule does not require mirroring casting onto mobile.

**Cast screens must be READ-ONLY.** They render home.tsx with all its hooks, so any
write effect (auto-track, autosave-triggering mutations) runs on the display device too
and its writes push through live sync with fresh stamps — clobbering the operator's
manual edits on every other device. `useAutoTrack` takes `disabled: screenMode !== null`
for exactly this; any future write effect added to home.tsx must be gated the same way.
Related: the web manual-edit suppression window `AUTO_SUPPRESS_MS` is 1 minute BY
USER CHOICE (July 2026) — do not "fix" it back to mobile's 10 minutes; the user wants
tracking to resume quickly from a manual baseline.

**How to apply:** when adding/changing a cast screen, do it in web only. To add a new
castable screen you must (1) add an `if (screenMode === "X")` early-return view and
(2) add a matching entry to the `screens` array in the Cast dialog. Reuse existing data
helpers (`sauceBarrelBreakdown`, `aggregateNeedRows`, `computeSummaryStats`/`buildNeedRows`)
rather than recomputing.
