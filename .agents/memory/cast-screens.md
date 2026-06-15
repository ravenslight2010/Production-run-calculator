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

**How to apply:** when adding/changing a cast screen, do it in web only. To add a new
castable screen you must (1) add an `if (screenMode === "X")` early-return view and
(2) add a matching entry to the `screens` array in the Cast dialog. Reuse existing data
helpers (`sauceBarrelBreakdown`, `aggregateNeedRows`, `computeSummaryStats`/`buildNeedRows`)
rather than recomputing.
