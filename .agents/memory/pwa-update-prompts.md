---
name: PWA update prompts
description: Safe update prompting and stale-client recovery worker lifecycle.
---

Keep Vite PWA's `registerType: "prompt"` and never let update detection itself reload. Workbox workers may `skipWaiting`, but must never `clientsClaim`. Automatic reload is allowed only through the calculator's explicit safe-state contract after one uninterrupted minute of update-specific inactivity.

**Why:** A fully cached legacy error boundary cannot run newer React recovery code. A worker that activates without claiming lets that legacy screen's existing, user-chosen generic reload enter the fixed bundle. It must not reload or replace the open page because that page can hold a live run, form, or import.

**How to apply:** Keep the persistent reload toast even when the worker activates immediately: observe an installed update as well as `needRefresh`. Background checks may discover/install/activate but never navigate. The safety contract must be replayable because Home can publish from a descendant effect before the app-level update coordinator subscribes. Home-owned surfaces belong in one named blocker inventory; locally owned dialogs and operational prompts register unique blockers that aggregate with Home rather than publishing competing safe/unsafe values. Treat an unsolicited service-worker `controlling` event as no reload permission; only an explicit manual or safe-idle intent may navigate, and re-check that intent at the controlling event. Auto-handoff requires no started-unended run, no unpersisted form value, no blocking dialog/operation, and a dedicated one-minute idle window; interaction resets only that window. Validate unsafe preservation and safe auto-handoff in a real browser.

**Stale-client recovery:** Only the exact Safari `Can't find variable: Notification` reference error gets an "Update and reload" action. It may check and activate a waiting worker after the staff member clicks, otherwise it uses an ordinary reload.

**Why:** A cached iOS bundle can still evaluate the legacy free `Notification` global even though current code safely probes `window.Notification`. Broad error matching or automatic recovery could interrupt unrelated active production work.

**How to apply:** Keep this recovery opt-in and exact-message scoped. Embed a non-empty, deployment-specific web build ID in every web incident so stale-client reports can be distinguished from a current-code regression.