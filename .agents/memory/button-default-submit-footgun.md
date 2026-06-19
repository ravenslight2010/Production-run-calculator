---
name: Button default-submit footgun (web)
description: Why the shared web Button defaults to type="button" and the convention that depends on it.
---

# Web Button defaults to type="button"

The shared shadcn `Button` (`artifacts/run-calculator/src/components/ui/button.tsx`)
renders a native `<button>`. A native button with no `type` defaults to
`type="submit"`, so any `Button` placed inside a `<form>` will submit that form
on click.

**Rule:** the shared `Button` injects `type="button"` by default (skipped when
`asChild`). Any button that is *meant* to submit a form MUST pass an explicit
`type="submit"`, which overrides the default via the `{...props}` spread.

**Why:** The Setup screen in `home.tsx` wraps a huge amount of UI in a `<form>`
that has **no `onSubmit` handler**. Buttons like "Scan for missing data"
(FillMissingPanel) were defaulting to submit, so clicking them did a native GET
navigation to `/?<form-fields>` (e.g. `/?cartonsPerCase=0`) and blanked the app
/ bounced to home. Symptom reported as "tap scan → sets me back to home and
nothing happens." It produced NO incident row because it's a native navigation,
not a React render crash.

**How to apply:**
- Keep the `type="button"` default on the shared Button.
- When adding a real submit button, set `type="submit"` explicitly (the codebase
  already does this consistently: auth, StaffRolesCard, ChangePasswordCard).
- Mobile (React Native `Pressable`) has no form-submit concept, so this is a
  web-only concern; behavior parity is unaffected.
