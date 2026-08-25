---
name: Accessibility reload fixtures
description: Browser fixtures that seed local state must survive application-triggered reloads
---

Accessibility browser fixtures that seed localStorage should be idempotent across every navigation, not guarded by a one-shot session flag.

**Why:** Authenticated startup can trigger an additional reload (such as sandbox refresh), and a one-shot seed leaves the journey on the app's blank placeholder even though the original seed was valid.

**How to apply:** Seed only when the fixture's expected record is absent, and leave populated or user-created state untouched.