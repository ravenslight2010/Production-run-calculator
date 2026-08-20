---
name: PWA update prompts
description: The service-worker registration mode required for an in-app update prompt.
---

Use Vite PWA's `registerType: "prompt"` whenever the app surfaces a user-controlled update action through `useRegisterSW().needRefresh`.

**Why:** In the installed Vite PWA integration, `autoUpdate` activates updated workers and reloads browser contexts automatically. That bypasses the waiting-worker event and therefore never invokes the `needRefresh` callback that an in-app prompt depends on.

**How to apply:** Keep the existing Workbox caching rules unchanged, but use prompt registration for a deliberate reload flow. The update toast must be persistent and protected from the normal toast limit so another notification cannot hide its reload action. Validate a production build after changing this behavior, and do not switch back to `autoUpdate` unless the app intentionally returns to automatic reloads with no user prompt.