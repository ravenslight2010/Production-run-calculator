---
name: Delayed onboarding overlay
description: Browser sign-up helpers must account for the first-login onboarding dialog appearing after the main page mounts.
---

Wait for the first-login onboarding dialog before interacting with the underlying app; an immediate visibility check can miss a delayed overlay and leave pointer actions blocked.

**Why:** The dialog is mounted asynchronously after authentication, so a helper that checks only once can falsely report a ready Run tab while the overlay still intercepts clicks.

**How to apply:** Sign-up fixtures should wait briefly for the dialog, dismiss it when present, and then wait for the target control to be visible before continuing.