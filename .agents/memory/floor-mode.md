---
name: Floor Mode parity
description: Idle big-numbers "Floor Mode" display — web/mobile parity rules and the intentional platform diffs.
---

# Floor Mode (idle big-numbers display)

Floor Mode is the full-screen idle monitor for the line: big numbers, status, smart
chips, frontline reference, action controls. It exists on BOTH web (inline in
home.tsx) and mobile (`components/FloorMode.tsx`, wired in the Run tab).

## Enable toggle is per-user server-side (web; 2026-07-08)
The Floor Mode on/off setting follows the user's account, not the device: it lives in
`users.floorModeEnabled` (default true) surfaced on `/me`, set via `POST /me/floor-mode`
(requireAuth-only, settable both directions — unlike the one-way onboarding/tour flags).
Web has a one-shot migration that pushes a legacy localStorage "off" onto the account
then deletes the key. **Mobile still uses its local setting** — when parity resumes,
wire mobile to the same `/me` field.
**Gotcha:** roles.integration.test.ts has a tight shared public-auth rate-limit budget
(20/60s); new tests there must seed users directly, not call `/auth/sign-up`, or the
later fail-closed sign-up-gate test intermittently gets 429 instead of 403.

## Intentional platform diffs (NOT formula drift — like Cast-to-Screens)
- **Third big number differs.** Web shows a live NEXT BATCH countdown; mobile has no
  live next-batch countdown, so mobile shows **Batches Ready** (`run.progress.batchesReady`).
- **No pause/resume on mobile.** Mobile has no `pause` stoppage type, so mobile Floor
  Mode action buttons are only Log Stop / End Stop / Skid Done (web also has Pause/Resume).

## Parity-sensitive details to keep aligned
- **Pace** is computed inline on both sides: expected cases = `ppm * elapsedAfterTunnel / pizzasPerCase`,
  delta = actual − expected, tolerance ±2 → on-pace/ahead/behind. Mobile uses
  `calc.netElapsedSec` (already subtracts ALL downtime) minus `freezerTime` — that
  stands in for web's pause-aware elapsed.
- **sauceBarrelBreakdown takes LBS on mobile** (`calc.sauceLbs`), batches on web — see
  the separate sauce-barrel-breakdown-signature note. Mobile Floor Mode passes `calc.sauceLbs`.
- Smart chips (the user-picked "smarter content"): pace, ETA, dough-short, allergen-sequence.

## Monitor hygiene (burn-in)
Both platforms drift the whole panel slowly and auto-dim to ~0.45 after ~90s of no
interaction, restoring instantly on touch/mouse/key. Web uses CSS `@keyframes floor-drift`
+ `floorDimmed` state; mobile uses Animated drift loop + Animated opacity.

## Mobile idle activation gotcha
Auto-open after 3 min idle MUST be gated on tab focus (`useFocusEffect`), not a plain
effect — expo-router keeps tabs mounted, so an ungated timer pops Floor Mode over
whatever OTHER tab the user is on, and touches there won't reset it.
**Why:** tabs don't unmount; the Run screen keeps running in the background.
