---
name: home.tsx render-time helpers can hit TDZ on later-declared refs
description: Calling a hoisted helper from a useMemo in home.tsx throws if it reads a const/ref declared further down; try/catch made it invisible.
---

# Render-time TDZ in home.tsx

**Rule:** Any helper function in `home.tsx` that is CALLED during render (from a `useMemo`/render body) must only read consts/refs declared ABOVE the call site. Function declarations hoist, but the `const`/`useRef` bindings they read do not — calling one early throws `ReferenceError: Cannot access 'X' before initialization`.

**Why:** The cheese merge tab's stale-name scan called `collectMergeSurfaces()` inside the `mergeUniverse` memo; it read `dayStateRef`, declared ~1300 lines later. A bare `try { … } catch {}` swallowed the error, so the feature silently no-oped in EVERY environment (tests passed — they exercised the pure helper, not the render path). Only a real-browser e2e exposed it.

**How to apply:**
- `dayStateRef` now lives directly under the `dayState` useState for this reason — don't move it back to the sync-ref block.
- When wiring a render-time call into an existing event-handler-era helper, check every binding it reads is declared earlier in the file.
- Never use an empty `catch {}` around such calls — at minimum `console.warn` the error, or the failure mode is "feature quietly missing".
- Verification that catches this class: drive the real UI (headless Chromium e2e), not just unit tests of the pure helpers.
