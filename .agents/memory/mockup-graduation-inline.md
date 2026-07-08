---
name: Canvas mockup graduation pattern
description: How approved canvas mockups get integrated into the web app's home.tsx tabs.
---

# Canvas mockup graduation pattern

Approved canvas mockups for existing tabs are graduated by **inlining into the tab's
TabsContent in `home.tsx`** (plus small module-scope presentational helpers next to
StepperField), NOT by importing the mockup component or creating a separate page component.

**Why:** the tab's real logic (form watch values, auto-track refs, sync-aware handlers,
draining IIFEs) lives in the Home component closure; a separate component would need a huge
prop surface and drift from the mockup anyway. Precedents: Dough tab, Packaging tab
(timeline pipeline, 2026-07-08).

**How to apply:**
- Keep every existing calc/guard/clamp/handler verbatim; only restyle the JSX around them.
- Mockup-only simplifications (dropped number-typing, hold-repeat, per-field suggestion
  chips) are acceptable ONLY when the user approved that mockup behavior — call them out.
- Verify with `typecheck` (not build), then an authenticated runTest e2e (create a throwaway
  account via /api/auth/sign-up with $STAFF_SIGNUP_CODE, delete the user row after; check
  daily_sync updated_at to confirm no test data leaked into the shared day-state).
- Ask the user before deleting the mockup/canvas shapes — don't auto-clean.
