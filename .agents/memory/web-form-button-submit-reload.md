---
name: Web raw-button submit reload
description: Why raw <button> in web dialogs reloads the page, and the fix.
---

# Raw `<button>` inside the web form submits & reloads the page

The web app's `home.tsx` main UI is wrapped in a react-hook-form `<form>`. Any hand-written `<button>` without an explicit `type` defaults to `type="submit"`, so clicking it submits the form and does a full page reload (localStorage-backed state survives, but the reload looks like a crash/flicker and interrupts the flow).

**Why:** import dialogs (SpecImportDialog, PremixImportDialog, etc.) are rendered as overlays that are still inside the form's DOM subtree, not in a portal. Their raw `<button onClick={onConfirm}>` had no `type`, so "Apply import" reloaded the page instead of running its handler cleanly.

**How to apply:** every hand-written `<button>` in a web component that can render inside the form MUST set `type="button"` (only the one intentional submit button, if any, stays a submit). shadcn `<Button>` is generally safe, but raw `<button>` elements in custom dialogs are the usual culprits. Mobile (React Native) has no HTML forms, so this is web-only — no parity change needed.
